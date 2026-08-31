-- Record only refunds already verified against Razorpay by the server. The
-- function is service-role-only and never initiates money movement itself.

alter table public.orders
  add column if not exists payment_refunded_at timestamptz;

create or replace function public.admin_record_prepaid_refund(
  p_order_id uuid,
  p_razorpay_order_id text,
  p_razorpay_payment_id text,
  p_amount integer,
  p_currency text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'order_not_found'; end if;
  if v_order.payment_method <> 'prepaid'
    or v_order.razorpay_order_id is distinct from p_razorpay_order_id
    or v_order.razorpay_payment_id is distinct from p_razorpay_payment_id
    or v_order.total_amount <> p_amount
    or v_order.currency <> p_currency
    or p_currency <> 'INR' then
    raise exception 'refund_order_mismatch';
  end if;
  if v_order.payment_status = 'refunded' then return v_order; end if;
  if v_order.payment_status <> 'paid' then raise exception 'paid_order_required'; end if;

  update public.orders
  set payment_status = 'refunded', payment_refunded_at = now()
  where id = p_order_id
  returning * into v_order;

  update public.customers
  set total_spent = greatest(0, total_spent - v_order.total_amount)
  where email = v_order.customer_email;

  return v_order;
end
$$;

revoke all on function public.admin_record_prepaid_refund(uuid, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.admin_record_prepaid_refund(uuid, text, text, integer, text)
  to service_role;
