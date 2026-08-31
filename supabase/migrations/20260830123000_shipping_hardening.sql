-- Shipping state machine and idempotency primitives.
-- All mutating functions are service-role only and lock the order row before
-- evaluating a transition. This prevents the webhook, dashboard and retries
-- from booking/cancelling the same parcel concurrently.

alter table public.orders
  add column if not exists inventory_committed_at timestamptz,
  add column if not exists inventory_released_at timestamptz,
  add column if not exists shipment_booking_state text not null default 'idle',
  add column if not exists shipment_booking_token uuid,
  add column if not exists shipment_booking_claimed_at timestamptz,
  add column if not exists shipment_booking_attempts integer not null default 0,
  add column if not exists shipment_last_error text,
  add column if not exists shipment_synced_at timestamptz,
  add column if not exists shipment_cancel_token uuid,
  add column if not exists shipment_cancel_claimed_at timestamptz,
  add column if not exists shipment_cancelled_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_shipment_booking_state_check'
  ) then
    alter table public.orders
      add constraint orders_shipment_booking_state_check
      check (shipment_booking_state in (
        'idle', 'booking', 'booked', 'failed', 'uncertain',
        'cancelling', 'cancel_uncertain', 'cancelled'
      ));
  end if;
end $$;

create unique index if not exists orders_awb_number_unique_idx
  on public.orders (awb_number)
  where awb_number is not null;

create unique index if not exists orders_proship_order_id_unique_idx
  on public.orders (proship_order_id)
  where proship_order_id is not null;

create index if not exists orders_shipment_booking_state_idx
  on public.orders (shipment_booking_state, shipment_booking_claimed_at);

update public.orders
set shipment_booking_state = case
  when order_status = 'cancelled' then 'cancelled'
  when awb_number is not null then 'booked'
  else shipment_booking_state
end
where order_status = 'cancelled' or awb_number is not null;

-- Restore inventory at most once, and only when the payment/order transaction
-- previously marked inventory as committed. Malformed historic line items are
-- ignored rather than allowing a negative or non-integer stock adjustment.
create or replace function public.shipping_release_inventory_once(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_product_name text;
  v_new_stock integer;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found
    or v_order.inventory_committed_at is null
    or v_order.inventory_released_at is not null then
    return false;
  end if;

  for v_item in
    select
      coalesce(item->>'productId', item->>'product_id') as product_id,
      sum((item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(
      case when jsonb_typeof(v_order.items) = 'array' then v_order.items else '[]'::jsonb end
    ) item
    where coalesce(item->>'productId', item->>'product_id', '')
            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and coalesce(item->>'quantity', '') ~ '^[1-9][0-9]*$'
      and (item->>'quantity')::numeric <= 100
    group by coalesce(item->>'productId', item->>'product_id')
  loop
    update public.products
    set inventory_count = inventory_count + v_item.quantity
    where id = v_item.product_id::uuid
    returning name, inventory_count into v_product_name, v_new_stock;

    if found then
      insert into public.inventory_log (
        product_id,
        product_name,
        change_type,
        quantity_change,
        previous_stock,
        new_stock,
        order_id,
        notes
      ) values (
        v_item.product_id::uuid,
        v_product_name,
        'return',
        v_item.quantity,
        v_new_stock - v_item.quantity,
        v_new_stock,
        p_order_id,
        'Inventory released once after order cancellation'
      );
    end if;
  end loop;

  update public.orders
  set inventory_released_at = now()
  where id = p_order_id and inventory_released_at is null;

  return true;
end;
$$;

create or replace function public.shipping_claim_booking(
  p_order_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if v_order.awb_number is not null then
    update public.orders
    set shipment_booking_state = 'booked', shipment_last_error = null
    where id = p_order_id;
    select * into v_order from public.orders where id = p_order_id;
    return jsonb_build_object('status', 'already_booked', 'order', to_jsonb(v_order));
  end if;

  if v_order.order_status not in ('confirmed', 'processing')
    or v_order.payment_status in ('failed', 'refunded')
    or (v_order.payment_method = 'prepaid' and v_order.payment_status <> 'paid') then
    return jsonb_build_object('status', 'ineligible', 'order', to_jsonb(v_order));
  end if;

  if v_order.shipment_booking_state in ('cancelling', 'cancel_uncertain', 'cancelled') then
    return jsonb_build_object('status', 'ineligible', 'order', to_jsonb(v_order));
  end if;

  if v_order.shipment_booking_state = 'booking' then
    if v_order.shipment_booking_claimed_at > now() - interval '15 minutes' then
      return jsonb_build_object('status', 'in_progress', 'order', to_jsonb(v_order));
    end if;

    -- A stale creator may have reached Proship. It is never safe to issue a
    -- second create until reference reconciliation proves what happened.
    update public.orders
    set shipment_booking_state = 'uncertain',
        shipment_booking_token = p_claim_token,
        shipment_booking_claimed_at = now(),
        shipment_booking_attempts = shipment_booking_attempts + 1,
        shipment_last_error = 'Previous shipment booking did not complete; reconciliation required'
    where id = p_order_id;
    select * into v_order from public.orders where id = p_order_id;
    return jsonb_build_object('status', 'reconcile_only', 'order', to_jsonb(v_order));
  end if;

  if v_order.shipment_booking_state = 'uncertain' then
    update public.orders
    set shipment_booking_token = p_claim_token,
        shipment_booking_claimed_at = now(),
        shipment_booking_attempts = shipment_booking_attempts + 1
    where id = p_order_id;
    select * into v_order from public.orders where id = p_order_id;
    return jsonb_build_object('status', 'reconcile_only', 'order', to_jsonb(v_order));
  end if;

  update public.orders
  set shipment_booking_state = 'booking',
      shipment_booking_token = p_claim_token,
      shipment_booking_claimed_at = now(),
      shipment_booking_attempts = shipment_booking_attempts + 1,
      shipment_last_error = null
  where id = p_order_id;

  select * into v_order from public.orders where id = p_order_id;
  return jsonb_build_object('status', 'claimed', 'order', to_jsonb(v_order));
end;
$$;

create or replace function public.shipping_complete_booking(
  p_order_id uuid,
  p_claim_token uuid,
  p_reference text,
  p_proship_order_id text,
  p_awb_number text,
  p_courier_name text default null,
  p_label_url text default null,
  p_tracking_url text default null,
  p_shipment_status text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.order_number <> p_reference then raise exception 'shipment_reference_mismatch'; end if;
  if nullif(trim(p_awb_number), '') is null then raise exception 'shipment_awb_required'; end if;

  if v_order.awb_number is not null then
    if v_order.awb_number <> p_awb_number then raise exception 'shipment_awb_conflict'; end if;
    return v_order;
  end if;

  if v_order.shipment_booking_token is distinct from p_claim_token
    or v_order.shipment_booking_state not in ('booking', 'uncertain') then
    raise exception 'shipment_claim_lost';
  end if;

  update public.orders
  set proship_order_id = nullif(trim(p_proship_order_id), ''),
      awb_number = trim(p_awb_number),
      courier_name = nullif(trim(p_courier_name), ''),
      shipping_label_url = nullif(trim(p_label_url), ''),
      tracking_url = nullif(trim(p_tracking_url), ''),
      shipment_status = nullif(trim(p_shipment_status), ''),
      shipment_booking_state = 'booked',
      shipment_booking_token = null,
      shipment_booking_claimed_at = null,
      shipment_last_error = null,
      shipment_synced_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.shipping_fail_booking(
  p_order_id uuid,
  p_claim_token uuid,
  p_outcome_unknown boolean,
  p_safe_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
  set shipment_booking_state = case when p_outcome_unknown then 'uncertain' else 'failed' end,
      shipment_booking_token = null,
      shipment_booking_claimed_at = null,
      shipment_last_error = left(coalesce(p_safe_error, 'Shipment booking failed'), 500)
  where id = p_order_id and shipment_booking_token = p_claim_token;
end;
$$;

create or replace function public.shipping_sync_status(
  p_order_id uuid,
  p_reference text,
  p_proship_order_id text,
  p_awb_number text,
  p_courier_name text default null,
  p_label_url text default null,
  p_tracking_url text default null,
  p_shipment_status text default null,
  p_order_status text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.order_number <> p_reference then raise exception 'shipment_reference_mismatch'; end if;
  if v_order.awb_number is not null and v_order.awb_number <> p_awb_number then
    raise exception 'shipment_awb_conflict';
  end if;
  if v_order.shipment_booking_state = 'booking'
    and v_order.shipment_booking_claimed_at > now() - interval '15 minutes' then
    raise exception 'shipment_booking_in_progress';
  end if;

  if p_order_status = 'shipped' and v_order.order_status in ('confirmed', 'processing') then
    v_order.order_status := 'shipped';
  elsif p_order_status = 'delivered' and v_order.order_status <> 'cancelled' then
    v_order.order_status := 'delivered';
  elsif p_order_status = 'cancelled' and v_order.order_status <> 'delivered' then
    v_order.order_status := 'cancelled';
    perform public.shipping_release_inventory_once(p_order_id);
  elsif p_order_status is not null and p_order_status not in ('shipped', 'delivered', 'cancelled') then
    raise exception 'invalid_synchronized_order_status';
  end if;

  update public.orders
  set proship_order_id = coalesce(nullif(trim(p_proship_order_id), ''), proship_order_id),
      awb_number = coalesce(nullif(trim(p_awb_number), ''), awb_number),
      courier_name = coalesce(nullif(trim(p_courier_name), ''), courier_name),
      shipping_label_url = coalesce(nullif(trim(p_label_url), ''), shipping_label_url),
      tracking_url = coalesce(nullif(trim(p_tracking_url), ''), tracking_url),
      shipment_status = coalesce(nullif(trim(p_shipment_status), ''), shipment_status),
      shipment_booking_state = case
        when v_order.order_status = 'cancelled' then 'cancelled'
        else 'booked'
      end,
      order_status = v_order.order_status,
      shipped_at = case
        when v_order.order_status in ('shipped', 'delivered') then coalesce(shipped_at, now())
        else shipped_at
      end,
      shipment_cancelled_at = case
        when v_order.order_status = 'cancelled' then coalesce(shipment_cancelled_at, now())
        else shipment_cancelled_at
      end,
      shipment_booking_token = null,
      shipment_booking_claimed_at = null,
      shipment_cancel_token = null,
      shipment_cancel_claimed_at = null,
      shipment_last_error = null,
      shipment_synced_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.shipping_claim_cancellation(
  p_order_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_order.order_status = 'cancelled' then
    return jsonb_build_object('status', 'already_cancelled', 'order', to_jsonb(v_order));
  end if;
  if v_order.order_status = 'delivered' then
    return jsonb_build_object('status', 'ineligible', 'order', to_jsonb(v_order));
  end if;
  if v_order.payment_status = 'paid' then
    return jsonb_build_object('status', 'refund_required', 'order', to_jsonb(v_order));
  end if;
  if v_order.awb_number is null
    and v_order.shipment_booking_state in ('booking', 'uncertain', 'cancelling', 'cancel_uncertain') then
    return jsonb_build_object('status', 'reconciliation_required', 'order', to_jsonb(v_order));
  end if;
  if v_order.shipment_cancel_token is not null
    and v_order.shipment_cancel_claimed_at > now() - interval '15 minutes' then
    return jsonb_build_object('status', 'in_progress', 'order', to_jsonb(v_order));
  end if;

  update public.orders
  set shipment_booking_state = 'cancelling',
      shipment_cancel_token = p_claim_token,
      shipment_cancel_claimed_at = now(),
      shipment_last_error = null
  where id = p_order_id;
  select * into v_order from public.orders where id = p_order_id;
  return jsonb_build_object('status', 'claimed', 'order', to_jsonb(v_order));
end;
$$;

create or replace function public.shipping_complete_cancellation(
  p_order_id uuid,
  p_claim_token uuid,
  p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.order_status = 'delivered' then raise exception 'delivered_order_cannot_be_cancelled'; end if;
  if v_order.payment_status = 'paid' then raise exception 'paid_order_refund_required'; end if;
  if v_order.shipment_cancel_token is distinct from p_claim_token then
    raise exception 'shipment_cancellation_claim_lost';
  end if;

  perform public.shipping_release_inventory_once(p_order_id);

  -- A pending prepaid order has only reservations, not committed stock. Free
  -- those reservations and its single-use coupon immediately on cancellation.
  update public.inventory_reservations
  set status = 'released', released_at = now()
  where order_id = p_order_id and status = 'reserved';

  update public.coupon_leads
  set reserved_order_id = null, reserved_until = null
  where reserved_order_id = p_order_id and not is_used;

  update public.orders
  set order_status = 'cancelled',
      shipment_booking_state = 'cancelled',
      shipment_status = case when awb_number is not null then 'CANCELLED' else shipment_status end,
      shipment_cancelled_at = now(),
      shipment_cancel_token = null,
      shipment_cancel_claimed_at = null,
      shipment_booking_token = null,
      shipment_booking_claimed_at = null,
      shipment_last_error = null,
      notes = case when p_notes is null then notes else left(p_notes, 2000) end
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.shipping_fail_cancellation(
  p_order_id uuid,
  p_claim_token uuid,
  p_outcome_unknown boolean,
  p_safe_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
  set shipment_booking_state = case
        when p_outcome_unknown then 'cancel_uncertain'
        when awb_number is not null then 'booked'
        else 'failed'
      end,
      shipment_cancel_token = null,
      shipment_cancel_claimed_at = null,
      shipment_last_error = left(coalesce(p_safe_error, 'Shipment cancellation failed'), 500)
  where id = p_order_id and shipment_cancel_token = p_claim_token;
end;
$$;

create or replace function public.admin_transition_order_status(
  p_order_id uuid,
  p_new_status text,
  p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if p_new_status = v_order.order_status then
    update public.orders
    set notes = case when p_notes is null then notes else left(p_notes, 2000) end
    where id = p_order_id
    returning * into v_order;
    return v_order;
  end if;
  if p_new_status not in ('confirmed', 'processing', 'shipped', 'delivered') then
    raise exception 'invalid_order_status';
  end if;
  if v_order.order_status in ('cancelled', 'delivered') and v_order.order_status <> p_new_status then
    raise exception 'terminal_order_status';
  end if;
  if v_order.payment_status in ('failed', 'refunded') and p_new_status <> v_order.order_status then
    raise exception 'payment_status_blocks_fulfillment';
  end if;
  if v_order.payment_method = 'prepaid'
    and v_order.payment_status <> 'paid'
    and p_new_status in ('processing', 'shipped', 'delivered') then
    raise exception 'prepaid_order_not_paid';
  end if;
  if p_new_status = 'processing' and v_order.order_status <> 'confirmed' then
    raise exception 'invalid_order_transition';
  end if;
  if p_new_status = 'shipped'
    and (v_order.order_status not in ('confirmed', 'processing') or v_order.awb_number is null) then
    raise exception 'shipment_required';
  end if;
  if p_new_status = 'delivered'
    and (v_order.order_status <> 'shipped' or v_order.awb_number is null) then
    raise exception 'invalid_order_transition';
  end if;
  if p_new_status = 'confirmed' and v_order.order_status <> 'confirmed' then
    raise exception 'order_status_cannot_move_backwards';
  end if;

  update public.orders
  set order_status = p_new_status,
      notes = case when p_notes is null then notes else left(p_notes, 2000) end,
      shipped_at = case when p_new_status in ('shipped', 'delivered') then coalesce(shipped_at, now()) else shipped_at end
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.admin_transition_cod_payment(
  p_order_id uuid,
  p_new_payment_status text,
  p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.payment_method <> 'cod' then raise exception 'prepaid_payment_status_is_provider_managed'; end if;
  if p_new_payment_status not in ('paid', 'refunded') then raise exception 'invalid_cod_payment_status'; end if;
  if p_new_payment_status = v_order.payment_status then return v_order; end if;
  if p_new_payment_status = 'paid'
    and (v_order.payment_status <> 'pending' or v_order.order_status not in ('shipped', 'delivered')) then
    raise exception 'cod_collection_requires_shipped_order';
  end if;
  if p_new_payment_status = 'refunded' and v_order.payment_status <> 'paid' then
    raise exception 'only_collected_cod_can_be_refunded';
  end if;

  update public.orders
  set payment_status = p_new_payment_status,
      notes = case when p_notes is null then notes else left(p_notes, 2000) end
  where id = p_order_id
  returning * into v_order;

  if p_new_payment_status = 'paid' then
    update public.customers
    set total_spent = total_spent + v_order.total_amount
    where email = v_order.customer_email;
  else
    update public.customers
    set total_spent = greatest(0, total_spent - v_order.total_amount)
    where email = v_order.customer_email;
  end if;

  return v_order;
end;
$$;

revoke all on function public.shipping_release_inventory_once(uuid) from public, anon, authenticated;
revoke all on function public.shipping_claim_booking(uuid, uuid) from public, anon, authenticated;
revoke all on function public.shipping_complete_booking(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.shipping_fail_booking(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.shipping_sync_status(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.shipping_claim_cancellation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.shipping_complete_cancellation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.shipping_fail_cancellation(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_transition_order_status(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_transition_cod_payment(uuid, text, text) from public, anon, authenticated;

grant execute on function public.shipping_release_inventory_once(uuid) to service_role;
grant execute on function public.shipping_claim_booking(uuid, uuid) to service_role;
grant execute on function public.shipping_complete_booking(uuid, uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.shipping_fail_booking(uuid, uuid, boolean, text) to service_role;
grant execute on function public.shipping_sync_status(uuid, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.shipping_claim_cancellation(uuid, uuid) to service_role;
grant execute on function public.shipping_complete_cancellation(uuid, uuid, text) to service_role;
grant execute on function public.shipping_fail_cancellation(uuid, uuid, boolean, text) to service_role;
grant execute on function public.admin_transition_order_status(uuid, text, text) to service_role;
grant execute on function public.admin_transition_cod_payment(uuid, text, text) to service_role;
