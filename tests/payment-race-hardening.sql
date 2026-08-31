-- Rollback-only checks for late captures, checkout expiry, coupon reuse, and
-- inventory reservations. Run only against an isolated migrated database.
begin;

do $$
declare
  v_guard_product constant uuid := 'c1111111-1111-4111-8111-111111111111';
  v_expired_product constant uuid := 'c2222222-2222-4222-8222-222222222222';
  v_coupon_product constant uuid := 'c3333333-3333-4333-8333-333333333333';
  v_cancel_token constant uuid := 'c4444444-4444-4444-8444-444444444444';
  v_result jsonb;
  v_second jsonb;
  v_claim jsonb;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_second_order_id uuid;
  v_stock integer;
  v_spent integer;
  v_count integer;
  v_rejected boolean;
begin
  insert into public.products (id, name, slug, price, images, inventory_count)
  values
    (v_guard_product, 'Guard Gummies', 'guard-gummies', 10000, array['https://example.com/guard.png'], 5),
    (v_expired_product, 'Expired Gummies', 'expired-gummies', 10000, array['https://example.com/expired.png'], 2),
    (v_coupon_product, 'Coupon Gummies', 'coupon-gummies', 10000, array['https://example.com/coupon.png'], 5);

  -- Active reservations are protected from an admin stock reduction.
  v_result := public.reserve_prepaid_order(jsonb_build_object(
    'customer_name', 'Race Guard',
    'customer_email', 'race-guard@example.com',
    'customer_phone', '9876500001',
    'customer_whatsapp_opted_in', false,
    'shipping_address', jsonb_build_object(
      'line1', 'Test', 'city', 'Delhi', 'state', 'Delhi', 'pincode', '110001'
    ),
    'items', jsonb_build_array(jsonb_build_object('productId', v_guard_product, 'quantity', 2)),
    'subtotal', 20000,
    'shipping_cost', 0,
    'discount', 0,
    'total_amount', 20000,
    'razorpay_order_id', 'order_raceguard1',
    'idempotency_key', 'checkout_race_guard_0001',
    'request_fingerprint', repeat('1', 64)
  ));
  v_order_id := (v_result->'order'->>'id')::uuid;

  v_rejected := false;
  begin
    perform public.admin_adjust_inventory(
      v_guard_product, -4, 'adjustment', 'Must not consume reserved stock'
    );
  exception when others then
    v_rejected := sqlerrm like '%ACTIVE_RESERVATIONS_EXCEED_NEW_STOCK%';
  end;
  if not v_rejected then raise exception 'active reservation did not block inventory reduction'; end if;
  select inventory_count into v_stock from public.products where id = v_guard_product;
  if v_stock <> 5 then raise exception 'rejected adjustment changed stock: %', v_stock; end if;

  -- Cancel first, then emulate a late provider capture. Money is recorded for
  -- refund review, while stock and confirmation notifications stay untouched.
  v_claim := public.shipping_claim_cancellation(v_order_id, v_cancel_token);
  if v_claim->>'status' <> 'claimed' then raise exception 'pending cancellation was not claimed'; end if;
  perform public.shipping_complete_cancellation(v_order_id, v_cancel_token, 'Race test');

  v_result := public.finalize_razorpay_payment(
    v_order_id,
    'order_raceguard1',
    'pay_raceguard12',
    repeat('a', 64),
    20000,
    'INR'
  );
  if (v_result->>'requires_refund')::boolean is not true
    or v_result->>'payment_review_reason' <> 'late_capture_after_cancellation'
    or v_result->'order'->>'payment_status' <> 'paid'
    or v_result->'order'->>'order_status' <> 'cancelled'
    or (v_result->'order'->>'payment_review_required')::boolean is not true
    or v_result->'order'->>'inventory_committed_at' is not null then
    raise exception 'late capture was not isolated for refund review: %', v_result;
  end if;
  select inventory_count into v_stock from public.products where id = v_guard_product;
  if v_stock <> 5 then raise exception 'late capture committed inventory: %', v_stock; end if;
  select count(*) into v_count
  from public.payment_outbox
  where order_id = v_order_id and event_type = 'order.confirmed';
  if v_count <> 0 then raise exception 'late capture emitted an order confirmation'; end if;

  select * into v_order from public.admin_record_prepaid_refund(
    v_order_id, 'order_raceguard1', 'pay_raceguard12', 20000, 'INR'
  );
  if v_order.payment_status <> 'refunded' or v_order.payment_review_required then
    raise exception 'late capture refund did not clear review';
  end if;
  select total_spent into v_spent
  from public.customers where email = 'race-guard@example.com';
  if v_spent <> 0 then raise exception 'late capture refund did not reconcile spend: %', v_spent; end if;

  -- Razorpay orders remain payable, but a capture after the local 30-minute
  -- reservation expires must never honor stale stock/price state.
  v_result := public.reserve_prepaid_order(jsonb_build_object(
    'customer_name', 'Expired Checkout',
    'customer_email', 'expired-checkout@example.com',
    'customer_phone', '9876500002',
    'customer_whatsapp_opted_in', false,
    'shipping_address', jsonb_build_object(
      'line1', 'Test', 'city', 'Mumbai', 'state', 'Maharashtra', 'pincode', '400001'
    ),
    'items', jsonb_build_array(jsonb_build_object('productId', v_expired_product, 'quantity', 2)),
    'subtotal', 20000,
    'shipping_cost', 0,
    'discount', 0,
    'total_amount', 20000,
    'razorpay_order_id', 'order_expired123',
    'idempotency_key', 'checkout_expired_race_0001',
    'request_fingerprint', repeat('2', 64)
  ));
  v_order_id := (v_result->'order'->>'id')::uuid;
  update public.inventory_reservations
  set expires_at = now() - interval '1 minute'
  where order_id = v_order_id;
  perform public.admin_adjust_inventory(v_expired_product, -1, 'adjustment', 'Expired hold');

  v_result := public.finalize_razorpay_payment(
    v_order_id,
    'order_expired123',
    'pay_expired1234',
    repeat('b', 64),
    20000,
    'INR'
  );
  if v_result->>'payment_review_reason' <> 'checkout_expired_before_capture'
    or (v_result->>'requires_refund')::boolean is not true then
    raise exception 'expired checkout was fulfilled: %', v_result;
  end if;
  select inventory_count into v_stock from public.products where id = v_expired_product;
  if v_stock <> 1 then raise exception 'expired checkout changed inventory: %', v_stock; end if;

  -- If an expired single-use coupon is claimed by checkout B, a later capture
  -- for checkout A must not roll back payment recording or steal B's coupon.
  insert into public.coupon_leads (phone, coupon_code, discount_percent)
  values ('9876500003', 'RACECOUPON10', 10);

  v_result := public.reserve_prepaid_order(jsonb_build_object(
    'customer_name', 'Coupon A',
    'customer_email', 'coupon-a@example.com',
    'customer_phone', '9876500003',
    'customer_whatsapp_opted_in', false,
    'shipping_address', jsonb_build_object(
      'line1', 'Test', 'city', 'Delhi', 'state', 'Delhi', 'pincode', '110001'
    ),
    'items', jsonb_build_array(jsonb_build_object('productId', v_coupon_product, 'quantity', 1)),
    'subtotal', 10000,
    'shipping_cost', 0,
    'discount', 1000,
    'total_amount', 9000,
    'coupon_code', 'RACECOUPON10',
    'lead_coupon_code', 'RACECOUPON10',
    'razorpay_order_id', 'order_couponrace1',
    'idempotency_key', 'checkout_coupon_race_a_0001',
    'request_fingerprint', repeat('3', 64)
  ));
  v_order_id := (v_result->'order'->>'id')::uuid;
  update public.inventory_reservations
  set expires_at = now() - interval '1 minute'
  where order_id = v_order_id;
  update public.coupon_leads
  set reserved_until = now() - interval '1 minute'
  where coupon_code = 'RACECOUPON10';

  v_second := public.reserve_prepaid_order(jsonb_build_object(
    'customer_name', 'Coupon B',
    'customer_email', 'coupon-b@example.com',
    'customer_phone', '9876500004',
    'customer_whatsapp_opted_in', false,
    'shipping_address', jsonb_build_object(
      'line1', 'Test', 'city', 'Delhi', 'state', 'Delhi', 'pincode', '110001'
    ),
    'items', jsonb_build_array(jsonb_build_object('productId', v_coupon_product, 'quantity', 1)),
    'subtotal', 10000,
    'shipping_cost', 0,
    'discount', 1000,
    'total_amount', 9000,
    'coupon_code', 'RACECOUPON10',
    'lead_coupon_code', 'RACECOUPON10',
    'razorpay_order_id', 'order_couponrace2',
    'idempotency_key', 'checkout_coupon_race_b_0001',
    'request_fingerprint', repeat('4', 64)
  ));
  v_second_order_id := (v_second->'order'->>'id')::uuid;

  v_result := public.finalize_razorpay_payment(
    v_order_id,
    'order_couponrace1',
    'pay_couponrace12',
    repeat('c', 64),
    9000,
    'INR'
  );
  if v_result->>'payment_review_reason' <> 'coupon_reservation_lost_after_capture'
    or (v_result->>'requires_refund')::boolean is not true then
    raise exception 'reused coupon capture was not isolated: %', v_result;
  end if;
  select count(*) into v_count
  from public.coupon_leads
  where coupon_code = 'RACECOUPON10'
    and reserved_order_id = v_second_order_id
    and not is_used;
  if v_count <> 1 then raise exception 'late capture stole the second checkout coupon'; end if;
  select inventory_count into v_stock from public.products where id = v_coupon_product;
  if v_stock <> 5 then raise exception 'coupon race changed physical inventory: %', v_stock; end if;
end;
$$;

rollback;
