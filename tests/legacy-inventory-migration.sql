-- Rollback-only migration/backfill checks for pre-hardening inventory ledgers.
-- This deliberately replays the final idempotent migration inside a transaction.
begin;

insert into public.products (id, name, slug, price, images, inventory_count)
values (
  '20000000-0000-4000-8000-000000000001', 'Legacy Gummies',
  'legacy-gummies-test', 10000, array['https://example.com/legacy.png'], 20
);

insert into public.orders (
  id, order_number, customer_name, customer_email, customer_phone,
  shipping_address, items, subtotal, total_amount, payment_method,
  payment_status, order_status
) values
  (
    '20000000-0000-4000-8000-000000000002', 'NP-LEGACY-ZERO', 'Legacy Zero',
    'legacy-zero@example.com', '9876510001',
    '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
    '[{"productId":"20000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
    20000, 20000, 'prepaid', 'paid', 'processing'
  ),
  (
    '20000000-0000-4000-8000-000000000003', 'NP-LEGACY-PART', 'Legacy Partial',
    'legacy-part@example.com', '9876510002',
    '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
    '[{"productId":"20000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
    20000, 20000, 'prepaid', 'paid', 'processing'
  ),
  (
    '20000000-0000-4000-8000-000000000004', 'NP-LEGACY-CLAMP', 'Legacy Clamp',
    'legacy-clamp@example.com', '9876510003',
    '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
    '[{"productId":"20000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
    20000, 20000, 'prepaid', 'paid', 'processing'
  ),
  (
    '20000000-0000-4000-8000-000000000005', 'NP-LEGACY-MISSING', 'Legacy Missing',
    'legacy-missing@example.com', '9876510004',
    '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
    '[{"productId":"20000000-0000-4000-8000-000000000099","quantity":1}]'::jsonb,
    10000, 10000, 'prepaid', 'paid', 'processing'
  );

insert into public.inventory_log (
  product_id, product_name, change_type, quantity_change,
  previous_stock, new_stock, order_id, notes
) values
  (
    '20000000-0000-4000-8000-000000000001', 'Legacy Gummies', 'sale', -1,
    20, 19, '20000000-0000-4000-8000-000000000003', 'Historic partial verifier write'
  ),
  (
    '20000000-0000-4000-8000-000000000001', 'Legacy Gummies', 'sale', -2,
    1, 0, '20000000-0000-4000-8000-000000000004', 'Historic clamped verifier write'
  );

\ir ../supabase/migrations/20260830170000_payment_cancellation_race_guards.sql

do $$
declare
  v_count integer;
  v_order public.orders%rowtype;
  v_rejected boolean := false;
begin
  select count(*) into v_count
  from public.inventory_reconciliation_reviews
  where review_type = 'legacy_sale_ledger_mismatch'
    and order_id in (
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000004'
    );
  if v_count <> 3 then
    raise exception 'legacy zero/partial/clamped ledgers were not all quarantined: %', v_count;
  end if;

  select * into v_order from public.orders
  where id = '20000000-0000-4000-8000-000000000005';
  if not v_order.fulfillment_review_required
    or v_order.fulfillment_review_reason <> 'legacy_inventory_ledger_mismatch' then
    raise exception 'missing legacy product was not quarantined';
  end if;

  select * into v_order from public.admin_resolve_inventory_reconciliation(
    '20000000-0000-4000-8000-000000000002',
    'Physical count and ledger reviewed in migration test'
  );
  if v_order.inventory_committed_at is null or v_order.fulfillment_review_required then
    raise exception 'reviewed zero-ledger order did not establish a safe baseline';
  end if;

  begin
    perform public.admin_resolve_inventory_reconciliation(
      '20000000-0000-4000-8000-000000000005',
      'This must stay blocked while its product is missing'
    );
  exception when others then
    v_rejected := sqlerrm like '%inventory_order_items_invalid%';
  end;
  if not v_rejected then
    raise exception 'missing-product inventory quarantine was manually bypassed';
  end if;
end;
$$;

rollback;
