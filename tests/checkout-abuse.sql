-- Rollback-only checks for database-enforced public checkout abuse limits.
-- Run only against an isolated database after every migration is applied.
begin;

do $$
declare
  v_rejected boolean;
begin
  insert into public.orders (
    id, order_number, customer_name, customer_email, customer_phone,
    shipping_address, items, subtotal, total_amount, payment_method,
    payment_status, order_status, checkout_idempotency_key,
    checkout_request_fingerprint
  ) values (
    '10000000-0000-4000-8000-000000000001', 'NP-ABUSE-COD-1', 'COD Limit',
    'cod-limit@example.com', '9876500001',
    '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
    '[{"productId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","quantity":1}]'::jsonb,
    10000, 10000, 'cod', 'pending', 'confirmed',
    'checkout_abuse_cod_active_0001', repeat('a', 64)
  );

  v_rejected := false;
  begin
    insert into public.orders (
      id, order_number, customer_name, customer_email, customer_phone,
      shipping_address, items, subtotal, total_amount, payment_method,
      payment_status, order_status, checkout_idempotency_key,
      checkout_request_fingerprint
    ) values (
      '10000000-0000-4000-8000-000000000002', 'NP-ABUSE-COD-2', 'COD Limit',
      'other-cod@example.com', '9876500001',
      '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
      '[{"productId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","quantity":1}]'::jsonb,
      10000, 10000, 'cod', 'pending', 'confirmed',
      'checkout_abuse_cod_active_0002', repeat('b', 64)
    );
  exception when others then
    v_rejected := sqlerrm like '%CHECKOUT_ACTIVE_LIMIT%';
  end;
  if not v_rejected then raise exception 'a second active COD order was accepted'; end if;

  v_rejected := false;
  begin
    insert into public.orders (
      id, order_number, customer_name, customer_email, customer_phone,
      shipping_address, items, subtotal, total_amount, payment_method,
      payment_status, order_status, checkout_idempotency_key,
      checkout_request_fingerprint
    ) values (
      '10000000-0000-4000-8000-000000000003', 'NP-ABUSE-COD-3', 'COD Units',
      'cod-units@example.com', '9876500002',
      '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
      '[{"productId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","quantity":4}]'::jsonb,
      40000, 40000, 'cod', 'pending', 'confirmed',
      'checkout_abuse_cod_units_0001', repeat('c', 64)
    );
  exception when others then
    v_rejected := sqlerrm like '%CHECKOUT_UNIT_LIMIT%';
  end;
  if not v_rejected then raise exception 'a four-unit COD order was accepted'; end if;

  insert into public.orders (
    id, order_number, customer_name, customer_email, customer_phone,
    shipping_address, items, subtotal, total_amount, payment_method,
    payment_status, order_status, checkout_idempotency_key,
    checkout_request_fingerprint
  ) values
    (
      '10000000-0000-4000-8000-000000000004', 'NP-ABUSE-PRE-1', 'Prepaid Limit',
      'pre-limit@example.com', '9876500003',
      '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
      '[{"productId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
      10000, 10000, 'prepaid', 'pending', 'confirmed',
      'checkout_abuse_pre_active_0001', repeat('d', 64)
    ),
    (
      '10000000-0000-4000-8000-000000000005', 'NP-ABUSE-PRE-2', 'Prepaid Limit',
      'pre-limit@example.com', '9876500003',
      '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
      '[{"productId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
      10000, 10000, 'prepaid', 'pending', 'confirmed',
      'checkout_abuse_pre_active_0002', repeat('e', 64)
    );

  v_rejected := false;
  begin
    insert into public.orders (
      id, order_number, customer_name, customer_email, customer_phone,
      shipping_address, items, subtotal, total_amount, payment_method,
      payment_status, order_status, checkout_idempotency_key,
      checkout_request_fingerprint
    ) values (
      '10000000-0000-4000-8000-000000000006', 'NP-ABUSE-PRE-3', 'Prepaid Limit',
      'pre-limit@example.com', '9876500003',
      '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
      '[{"productId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
      10000, 10000, 'prepaid', 'pending', 'confirmed',
      'checkout_abuse_pre_active_0003', repeat('f', 64)
    );
  exception when others then
    v_rejected := sqlerrm like '%CHECKOUT_ACTIVE_LIMIT%';
  end;
  if not v_rejected then raise exception 'a third active prepaid order was accepted'; end if;

  v_rejected := false;
  begin
    insert into public.orders (
      id, order_number, customer_name, customer_email, customer_phone,
      shipping_address, items, subtotal, total_amount, payment_method,
      payment_status, order_status, checkout_idempotency_key,
      checkout_request_fingerprint
    ) values (
      '10000000-0000-4000-8000-000000000007', 'NP-ABUSE-PRE-4', 'Prepaid Units',
      'pre-units@example.com', '9876500004',
      '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
      '[{"productId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","quantity":7}]'::jsonb,
      70000, 70000, 'prepaid', 'pending', 'confirmed',
      'checkout_abuse_pre_units_0001', repeat('1', 64)
    );
  exception when others then
    v_rejected := sqlerrm like '%CHECKOUT_UNIT_LIMIT%';
  end;
  if not v_rejected then raise exception 'a seven-unit prepaid order was accepted'; end if;
end;
$$;

rollback;
