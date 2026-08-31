-- Rollback-only integration checks for atomic checkout and payment RPCs.
-- Run after every migration has been applied to an isolated database.
begin;

do $$
declare
  v_cod_product constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_prepaid_product constant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_cod_result jsonb;
  v_prepaid_result jsonb;
  v_finalized jsonb;
  v_cod_order_id uuid;
  v_prepaid_order_id uuid;
  v_stock integer;
  v_count integer;
  v_rejected boolean := false;
begin
  insert into public.products (id, name, slug, price, images, inventory_count)
  values
    (v_cod_product, 'COD Gummies', 'cod-gummies', 10000, array['https://example.com/cod.png'], 5),
    (v_prepaid_product, 'Prepaid Gummies', 'prepaid-gummies', 10000, array['https://example.com/prepaid.png'], 3);

  insert into public.coupon_leads (phone, coupon_code, discount_percent)
  values ('9876543299', 'LEAD10TEST', 10);

  v_cod_result := public.create_cod_order(jsonb_build_object(
    'customer_name', 'COD Test',
    'customer_email', 'cod-commerce@example.com',
    'customer_phone', '9876543299',
    'customer_whatsapp_opted_in', false,
    'shipping_address', jsonb_build_object(
      'line1', 'Test address', 'city', 'Delhi', 'state', 'Delhi', 'pincode', '110001'
    ),
    'items', jsonb_build_array(jsonb_build_object('productId', v_cod_product, 'quantity', 1)),
    'subtotal', 10000,
    'shipping_cost', 0,
    'discount', 1000,
    'cod_fee', 0,
    'total_amount', 9000,
    'coupon_code', 'LEAD10TEST',
    'lead_coupon_code', 'LEAD10TEST',
    'idempotency_key', 'checkout_cod_atomic_test_0001',
    'request_fingerprint', repeat('a', 64)
  ));
  if (v_cod_result->>'created')::boolean is not true then
    raise exception 'first COD checkout was not created';
  end if;
  v_cod_order_id := (v_cod_result->'order'->>'id')::uuid;

  select inventory_count into v_stock from public.products where id = v_cod_product;
  if v_stock <> 4 then raise exception 'COD inventory was not committed once: %', v_stock; end if;
  if (v_cod_result->'order'->'items'->0->>'price')::integer <> 10000 then
    raise exception 'COD stored price was not canonical';
  end if;

  v_cod_result := public.create_cod_order(jsonb_build_object(
    'customer_name', 'COD Test',
    'customer_email', 'cod-commerce@example.com',
    'customer_phone', '9876543299',
    'customer_whatsapp_opted_in', false,
    'shipping_address', jsonb_build_object(
      'line1', 'Test address', 'city', 'Delhi', 'state', 'Delhi', 'pincode', '110001'
    ),
    'items', jsonb_build_array(jsonb_build_object('productId', v_cod_product, 'quantity', 1)),
    'subtotal', 10000,
    'shipping_cost', 0,
    'discount', 1000,
    'cod_fee', 0,
    'total_amount', 9000,
    'coupon_code', 'LEAD10TEST',
    'lead_coupon_code', 'LEAD10TEST',
    'idempotency_key', 'checkout_cod_atomic_test_0001',
    'request_fingerprint', repeat('a', 64)
  ));
  if (v_cod_result->>'created')::boolean is not false
    or (v_cod_result->'order'->>'id')::uuid <> v_cod_order_id then
    raise exception 'COD idempotent replay changed the order';
  end if;
  select inventory_count into v_stock from public.products where id = v_cod_product;
  if v_stock <> 4 then raise exception 'COD replay decremented inventory twice: %', v_stock; end if;
  select count(*) into v_count from public.payment_outbox where order_id = v_cod_order_id;
  if v_count <> 1 then raise exception 'COD confirmation outbox was not exactly once: %', v_count; end if;
  select total_spent into v_stock
  from public.customers where email = 'cod-commerce@example.com';
  if v_stock <> 0 then raise exception 'uncollected COD was counted as customer spend: %', v_stock; end if;

  v_prepaid_result := public.reserve_prepaid_order(jsonb_build_object(
    'customer_name', 'Prepaid Test',
    'customer_email', 'prepaid-commerce@example.com',
    'customer_phone', '9876543288',
    'customer_whatsapp_opted_in', true,
    'shipping_address', jsonb_build_object(
      'line1', 'Test address', 'city', 'Mumbai', 'state', 'Maharashtra', 'pincode', '400001'
    ),
    'items', jsonb_build_array(jsonb_build_object('productId', v_prepaid_product, 'quantity', 2)),
    'subtotal', 20000,
    'shipping_cost', 0,
    'discount', 0,
    'total_amount', 20000,
    'razorpay_order_id', 'order_atomic12345',
    'idempotency_key', 'checkout_prepaid_atomic_0001',
    'request_fingerprint', repeat('b', 64)
  ));
  if (v_prepaid_result->>'created')::boolean is not true then
    raise exception 'prepaid reservation was not created';
  end if;
  v_prepaid_order_id := (v_prepaid_result->'order'->>'id')::uuid;
  select inventory_count into v_stock from public.products where id = v_prepaid_product;
  if v_stock <> 3 then raise exception 'reservation decremented physical inventory: %', v_stock; end if;
  select count(*) into v_count
  from public.inventory_reservations
  where order_id = v_prepaid_order_id and status = 'reserved' and quantity = 2;
  if v_count <> 1 then raise exception 'prepaid stock was not reserved'; end if;

  v_finalized := public.finalize_razorpay_payment(
    v_prepaid_order_id,
    'order_atomic12345',
    'pay_atomic123456',
    repeat('c', 64),
    20000,
    'INR'
  );
  if (v_finalized->>'newly_finalized')::boolean is not true
    or v_finalized->'order'->>'payment_status' <> 'paid' then
    raise exception 'prepaid payment was not finalized';
  end if;
  select inventory_count into v_stock from public.products where id = v_prepaid_product;
  if v_stock <> 1 then raise exception 'prepaid inventory was not committed once: %', v_stock; end if;

  v_finalized := public.finalize_razorpay_payment(
    v_prepaid_order_id,
    'order_atomic12345',
    'pay_atomic123456',
    repeat('c', 64),
    20000,
    'INR'
  );
  if (v_finalized->>'newly_finalized')::boolean is not false then
    raise exception 'prepaid replay was not idempotent';
  end if;
  select inventory_count into v_stock from public.products where id = v_prepaid_product;
  if v_stock <> 1 then raise exception 'prepaid replay decremented inventory twice: %', v_stock; end if;

  begin
    perform public.finalize_razorpay_payment(
      v_prepaid_order_id,
      'order_atomic12345',
      'pay_different1234',
      repeat('d', 64),
      20000,
      'INR'
    );
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'a second payment ID was accepted'; end if;

  select count(*) into v_count from public.payment_outbox where order_id = v_prepaid_order_id;
  if v_count <> 1 then raise exception 'prepaid confirmation outbox was not exactly once: %', v_count; end if;
end;
$$;

rollback;
