-- Run after the base schema, shipping columns migration, and
-- 20260830123000_shipping_hardening.sql. Every mutation is rolled back.
begin;

do $$
declare
  v_order_id constant uuid := '22222222-2222-4222-8222-222222222222';
  v_product_id constant uuid := '11111111-1111-4111-8111-111111111111';
  v_first_token constant uuid := '33333333-3333-4333-8333-333333333333';
  v_second_token constant uuid := '44444444-4444-4444-8444-444444444444';
  v_cancel_token constant uuid := '55555555-5555-4555-8555-555555555555';
  v_claim jsonb;
  v_order public.orders%rowtype;
  v_stock integer;
  v_total_spent integer;
  v_rejected boolean := false;
begin
  insert into public.products (id, name, slug, price, inventory_count)
  values (v_product_id, 'Test Gummies', 'test-gummies', 10000, 9);

  insert into public.customers (
    name, email, phone, order_count, total_spent
  ) values (
    'Test Customer', 'test@example.com', '9876543210', 1, 10000
  );

  insert into public.orders (
    id, order_number, customer_name, customer_email, customer_phone,
    shipping_address, items, subtotal, total_amount, payment_method,
    payment_status, order_status, inventory_committed_at,
    razorpay_order_id, razorpay_payment_id
  ) values (
    v_order_id, 'NP-TEST-SHIP', 'Test Customer', 'test@example.com', '9876543210',
    '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
    '[{"productId":"11111111-1111-4111-8111-111111111111","quantity":1}]'::jsonb,
    10000, 10000, 'prepaid', 'paid', 'processing', now(),
    'order_test1234', 'pay_test1234'
  );

  v_claim := public.shipping_claim_booking(v_order_id, v_first_token);
  if v_claim->>'status' <> 'claimed' then
    raise exception 'first booking claim was not acquired: %', v_claim;
  end if;

  v_claim := public.shipping_claim_booking(v_order_id, v_second_token);
  if v_claim->>'status' <> 'in_progress' then
    raise exception 'concurrent booking claim was not blocked: %', v_claim;
  end if;

  select * into v_order from public.shipping_complete_booking(
    v_order_id,
    v_first_token,
    'NP-TEST-SHIP',
    'provider-order-1',
    'AWB-TEST-1',
    'Test Courier',
    'https://example.com/label',
    'https://example.com/track/AWB-TEST-1',
    'BOOKED'
  );
  if v_order.awb_number <> 'AWB-TEST-1' or v_order.shipment_booking_state <> 'booked' then
    raise exception 'booking was not persisted atomically';
  end if;

  v_claim := public.shipping_claim_booking(v_order_id, v_second_token);
  if v_claim->>'status' <> 'already_booked' then
    raise exception 'booked order was not idempotent: %', v_claim;
  end if;

  -- A refund/order mutation that races an external booking cannot turn the
  -- provider AWB into an untracked live parcel.
  insert into public.customers (name, email, phone, order_count, total_spent)
  values ('Booking Race', 'booking-race@example.com', '9876543212', 1, 10000);
  insert into public.orders (
    id, order_number, customer_name, customer_email, customer_phone,
    shipping_address, items, subtotal, total_amount, payment_method,
    payment_status, order_status, inventory_committed_at,
    razorpay_order_id, razorpay_payment_id
  ) values (
    '77777777-7777-4777-8777-777777777777', 'NP-BOOK-RACE', 'Booking Race',
    'booking-race@example.com', '9876543212',
    '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
    '[{"productId":"11111111-1111-4111-8111-111111111111","quantity":1}]'::jsonb,
    10000, 10000, 'prepaid', 'paid', 'processing', now(),
    'order_bookrace1', 'pay_bookrace123'
  );
  v_claim := public.shipping_claim_booking(
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888'
  );
  if v_claim->>'status' <> 'claimed' then raise exception 'booking race claim failed'; end if;

  v_rejected := false;
  begin
    perform public.admin_record_prepaid_refund(
      '77777777-7777-4777-8777-777777777777',
      'order_bookrace1',
      'pay_bookrace123',
      10000,
      'INR'
    );
  exception when others then
    v_rejected := sqlerrm like '%shipment_must_be_stopped_before_prepaid_refund%';
  end;
  if not v_rejected then raise exception 'refund was recorded while shipment booking was in flight'; end if;

  -- Simulate another privileged state change after the Proship POST began;
  -- completion must preserve the AWB but demand cancellation.
  update public.orders
  set payment_status = 'refunded', payment_refunded_at = now()
  where id = '77777777-7777-4777-8777-777777777777';
  select * into v_order from public.shipping_complete_booking(
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',
    'NP-BOOK-RACE',
    'provider-book-race',
    'AWB-BOOK-RACE',
    'Test Courier',
    null,
    'https://example.com/track/AWB-BOOK-RACE',
    'BOOKED'
  );
  if v_order.awb_number <> 'AWB-BOOK-RACE'
    or v_order.shipment_booking_state <> 'cancel_uncertain' then
    raise exception 'ineligible completed booking was silently accepted';
  end if;

  v_claim := public.shipping_claim_cancellation(v_order_id, v_cancel_token);
  if v_claim->>'status' <> 'refund_required' then
    raise exception 'paid cancellation was not blocked pending refund: %', v_claim;
  end if;

  -- A provider-side cancellation cannot bypass the paid-order refund gate.
  select * into v_order from public.shipping_sync_status(
    v_order_id,
    'NP-TEST-SHIP',
    'provider-order-1',
    'AWB-TEST-1',
    'Test Courier',
    'https://example.com/label',
    'https://example.com/track/AWB-TEST-1',
    'CANCELLED',
    'cancelled'
  );
  if v_order.order_status <> 'processing'
    or v_order.payment_status <> 'paid'
    or v_order.shipment_booking_state <> 'cancelled'
    or v_order.shipment_cancelled_at is null
    or v_order.inventory_released_at is not null then
    raise exception 'carrier sync bypassed paid refund reconciliation';
  end if;

  -- Phase one stops the carrier while payment and inventory remain committed.
  v_claim := public.shipping_claim_refund_hold(v_order_id, v_cancel_token);
  if v_claim->>'status' <> 'already_stopped' then
    raise exception 'provider-confirmed cancellation was not recognized: %', v_claim;
  end if;
  select * into v_order from public.orders where id = v_order_id;
  if v_order.shipment_booking_state <> 'cancelled'
    or v_order.payment_status <> 'paid'
    or v_order.inventory_released_at is not null then
    raise exception 'pre-refund hold changed financial/inventory state';
  end if;

  select * into v_order from public.admin_record_prepaid_refund(
    v_order_id,
    'order_test1234',
    'pay_test1234',
    10000,
    'INR'
  );
  if v_order.payment_status <> 'refunded' or v_order.payment_refunded_at is null then
    raise exception 'verified prepaid refund was not recorded';
  end if;
  select total_spent into v_total_spent
  from public.customers where email = 'test@example.com';
  if v_total_spent <> 0 then
    raise exception 'refunded prepaid spend was not reconciled: %', v_total_spent;
  end if;

  select * into v_order from public.shipping_finalize_refunded_cancellation(
    v_order_id,
    'Cancelled in isolated migration test'
  );
  if v_order.order_status <> 'cancelled'
    or v_order.inventory_released_at is not null
    or v_order.fulfillment_review_reason <> 'return_inventory_pending' then
    raise exception 'cancelled parcel inventory was not quarantined';
  end if;

  select inventory_count into v_stock from public.products where id = v_product_id;
  if v_stock <> 9 then raise exception 'parcel inventory became saleable before return: %', v_stock; end if;
  perform public.admin_confirm_return_inventory(v_order_id);
  select inventory_count into v_stock from public.products where id = v_product_id;
  if v_stock <> 10 then raise exception 'confirmed physical return was not restored once: %', v_stock; end if;

  -- If Proship later reports delivery despite cancellation, keep the financial
  -- history terminal but compensate restored stock once and flag review.
  select * into v_order from public.shipping_sync_status(
    v_order_id,
    'NP-TEST-SHIP',
    'provider-order-1',
    'AWB-TEST-1',
    'Test Courier',
    'https://example.com/label',
    'https://example.com/track/AWB-TEST-1',
    'DELIVERED',
    'delivered'
  );
  if v_order.order_status <> 'cancelled'
    or not v_order.fulfillment_review_required
    or v_order.fulfillment_review_reason <> 'delivered_after_cancellation'
    or v_order.inventory_reclaimed_at is null then
    raise exception 'delivery after cancellation was hidden: %', row_to_json(v_order);
  end if;
  select inventory_count into v_stock from public.products where id = v_product_id;
  if v_stock <> 9 then raise exception 'late delivery inventory was not compensated: %', v_stock; end if;
  perform public.shipping_sync_status(
    v_order_id,
    'NP-TEST-SHIP',
    'provider-order-1',
    'AWB-TEST-1',
    'Test Courier',
    'https://example.com/label',
    'https://example.com/track/AWB-TEST-1',
    'DELIVERED',
    'delivered'
  );
  select inventory_count into v_stock from public.products where id = v_product_id;
  if v_stock <> 9 then raise exception 'late delivery inventory was reclaimed twice: %', v_stock; end if;

  -- A same-state call is safe for notes, including terminal cancelled orders.
  select * into v_order from public.admin_transition_order_status(
    v_order_id,
    'cancelled',
    'Updated note'
  );
  if v_order.notes <> 'Updated note' then raise exception 'notes-only update failed'; end if;

  update public.products
  set inventory_count = inventory_count - 1
  where id = v_product_id;

  insert into public.orders (
    id, order_number, customer_name, customer_email, customer_phone,
    shipping_address, items, subtotal, total_amount, payment_method,
    payment_status, order_status, inventory_committed_at
  ) values (
    '66666666-6666-4666-8666-666666666666', 'NP-TEST-COD', 'COD Customer',
    'cod@example.com', '9876543211',
    '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
    '[{"productId":"11111111-1111-4111-8111-111111111111","quantity":1}]'::jsonb,
    10000, 10000, 'cod', 'pending', 'confirmed', now()
  );
  insert into public.customers (
    name, email, phone, order_count, total_spent
  ) values (
    'COD Customer', 'cod@example.com', '9876543211', 1, 0
  );

  v_rejected := false;
  begin
    perform public.admin_transition_cod_payment(
      '66666666-6666-4666-8666-666666666666', 'paid', null
    );
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'unshipped COD collection was accepted'; end if;

  update public.orders
  set order_status = 'shipped', awb_number = 'AWB-COD-1', shipment_booking_state = 'booked'
  where id = '66666666-6666-4666-8666-666666666666';
  select * into v_order from public.admin_transition_cod_payment(
    '66666666-6666-4666-8666-666666666666', 'paid', null
  );
  if v_order.payment_status <> 'paid' then raise exception 'COD collection was not recorded'; end if;
  select total_spent into v_total_spent from public.customers where email = 'cod@example.com';
  if v_total_spent <> 10000 then raise exception 'COD collection spend was not recorded: %', v_total_spent; end if;

  v_rejected := false;
  begin
    perform public.admin_transition_cod_payment(
      '66666666-6666-4666-8666-666666666666', 'refunded', null
    );
  exception when others then
    v_rejected := sqlerrm like '%shipment_must_be_stopped_before_cod_refund%';
  end;
  if not v_rejected then raise exception 'COD refund bypassed carrier stop'; end if;

  v_claim := public.shipping_claim_refund_hold(
    '66666666-6666-4666-8666-666666666666', v_second_token
  );
  if v_claim->>'status' <> 'claimed' then raise exception 'COD refund hold was not claimed'; end if;
  perform public.shipping_complete_refund_hold(
    '66666666-6666-4666-8666-666666666666', v_second_token
  );
  select * into v_order from public.admin_transition_cod_payment(
    '66666666-6666-4666-8666-666666666666', 'refunded', null
  );
  if v_order.payment_status <> 'refunded' then raise exception 'COD refund was not recorded'; end if;
  perform public.shipping_finalize_refunded_cancellation(
    '66666666-6666-4666-8666-666666666666', 'COD refund finalized'
  );
  select total_spent into v_total_spent from public.customers where email = 'cod@example.com';
  if v_total_spent <> 0 then raise exception 'COD refund spend was not reversed: %', v_total_spent; end if;
  select inventory_count into v_stock from public.products where id = v_product_id;
  if v_stock <> 8 then raise exception 'COD parcel inventory was not quarantined: %', v_stock; end if;
  perform public.admin_confirm_return_inventory('66666666-6666-4666-8666-666666666666');
  select inventory_count into v_stock from public.products where id = v_product_id;
  if v_stock <> 9 then raise exception 'COD physical return was not restored once: %', v_stock; end if;

  -- A COD parcel delivered after cancellation can still have its cash
  -- collection recorded while remaining explicitly flagged for reconciliation.
  update public.products
  set inventory_count = inventory_count - 1
  where id = v_product_id;
  insert into public.customers (name, email, phone, order_count, total_spent)
  values ('Late COD', 'late-cod@example.com', '9876543213', 1, 0);
  insert into public.orders (
    id, order_number, customer_name, customer_email, customer_phone,
    shipping_address, items, subtotal, total_amount, payment_method,
    payment_status, order_status, inventory_committed_at,
    awb_number, shipment_booking_state
  ) values (
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'NP-LATE-COD', 'Late COD',
    'late-cod@example.com', '9876543213',
    '{"line1":"Test","city":"Delhi","state":"Delhi","pincode":"110001"}'::jsonb,
    '[{"productId":"11111111-1111-4111-8111-111111111111","quantity":1}]'::jsonb,
    10000, 10000, 'cod', 'pending', 'shipped', now(),
    'AWB-LATE-COD', 'booked'
  );
  v_claim := public.shipping_claim_cancellation(
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  );
  if v_claim->>'status' <> 'claimed' then raise exception 'late COD cancellation was not claimed'; end if;
  perform public.shipping_complete_cancellation(
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    'Carrier cancellation accepted'
  );
  perform public.shipping_sync_status(
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'NP-LATE-COD',
    'provider-late-cod',
    'AWB-LATE-COD',
    'Test Courier',
    null,
    'https://example.com/track/AWB-LATE-COD',
    'DELIVERED',
    'delivered'
  );
  select * into v_order from public.admin_transition_cod_payment(
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'paid', 'Collected after late delivery'
  );
  if v_order.payment_status <> 'paid' or not v_order.fulfillment_review_required then
    raise exception 'late delivered COD collection could not be reconciled';
  end if;
  select total_spent into v_total_spent
  from public.customers where email = 'late-cod@example.com';
  if v_total_spent <> 10000 then raise exception 'late COD collection missing from ledger'; end if;
  select inventory_count into v_stock from public.products where id = v_product_id;
  if v_stock <> 8 then raise exception 'late COD delivery inventory compensation failed: %', v_stock; end if;
end;
$$;

rollback;
