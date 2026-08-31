-- Atomic checkout/payment primitives.
--
-- All functions in this migration are service-role-only. Public clients must
-- continue to use the Next.js Route Handlers, which validate and canonicalize
-- requests before calling these functions.

alter table public.orders
  add column if not exists cod_fee integer not null default 0,
  add column if not exists payment_method text not null default 'prepaid',
  add column if not exists currency text not null default 'INR',
  add column if not exists coupon_code text,
  add column if not exists lead_coupon_code text,
  add column if not exists checkout_idempotency_key text,
  add column if not exists checkout_request_fingerprint text,
  add column if not exists inventory_committed_at timestamptz,
  add column if not exists inventory_released_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_method_check'
  ) then
    alter table public.orders
      add constraint orders_payment_method_check
      check (payment_method in ('prepaid', 'cod')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_currency_check'
  ) then
    alter table public.orders
      add constraint orders_currency_check check (currency = 'INR') not valid;
  end if;
end
$$;

create unique index if not exists orders_razorpay_order_id_uidx
  on public.orders (razorpay_order_id)
  where razorpay_order_id is not null;

create unique index if not exists orders_razorpay_payment_id_uidx
  on public.orders (razorpay_payment_id)
  where razorpay_payment_id is not null;

create unique index if not exists orders_checkout_idempotency_key_uidx
  on public.orders (checkout_idempotency_key)
  where checkout_idempotency_key is not null;

create table if not exists public.coupon_leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  coupon_code text not null unique,
  discount_percent integer not null,
  is_used boolean not null default false,
  whatsapp_sent boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.coupon_leads
  add column if not exists reserved_order_id uuid references public.orders(id) on delete set null,
  add column if not exists reserved_until timestamptz,
  add column if not exists used_order_id uuid references public.orders(id) on delete set null,
  add column if not exists used_at timestamptz;

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'consumed', 'released')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);

create index if not exists inventory_reservations_available_idx
  on public.inventory_reservations (product_id, expires_at)
  where status = 'reserved';

create table if not exists public.razorpay_webhook_events (
  event_id text primary key,
  event_type text not null,
  razorpay_order_id text,
  razorpay_payment_id text,
  payload_hash text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_key text not null unique,
  event_type text not null
    check (event_type in ('order.confirmed', 'payment.captured', 'payment.failed')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists payment_outbox_claim_idx
  on public.payment_outbox (available_at, created_at)
  where status in ('pending', 'failed', 'processing');

create table if not exists public.rate_limit_attempts (
  scope_key text not null,
  action text not null,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope_key, action)
);

alter table public.inventory_reservations enable row level security;
alter table public.razorpay_webhook_events enable row level security;
alter table public.payment_outbox enable row level security;
alter table public.rate_limit_attempts enable row level security;

create or replace function public.reserve_prepaid_order(p_checkout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_coupon public.coupon_leads%rowtype;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_reserved integer;
  v_subtotal bigint := 0;
  v_discount integer := coalesce((p_checkout->>'discount')::integer, 0);
  v_shipping integer := coalesce((p_checkout->>'shipping_cost')::integer, 0);
  v_total integer := (p_checkout->>'total_amount')::integer;
  v_idempotency_key text := nullif(p_checkout->>'idempotency_key', '');
  v_fingerprint text := p_checkout->>'request_fingerprint';
  v_lead_coupon text := nullif(p_checkout->>'lead_coupon_code', '');
  v_expected_discount integer;
begin
  if jsonb_typeof(p_checkout) <> 'object'
    or jsonb_typeof(p_checkout->'items') <> 'array'
    or jsonb_array_length(p_checkout->'items') not between 1 and 20 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKOUT';
  end if;
  if (
    select count(*) <> count(distinct value->>'productId')
    from jsonb_array_elements(p_checkout->'items')
  ) then
    raise exception using errcode = '22023', message = 'DUPLICATE_PRODUCTS';
  end if;
  if v_fingerprint is null or v_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_REQUEST_FINGERPRINT';
  end if;

  if v_idempotency_key is not null then
    select * into v_order
    from public.orders
    where checkout_idempotency_key = v_idempotency_key;

    if found then
      if v_order.checkout_request_fingerprint <> v_fingerprint
        or v_order.payment_method <> 'prepaid' then
        raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
      end if;
      return jsonb_build_object('order', to_jsonb(v_order), 'created', false);
    end if;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_checkout->'items') order by value->>'productId'
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity not between 1 and 10 then
      raise exception using errcode = '22023', message = 'INVALID_ITEM_QUANTITY';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
    for update;

    if not found or not v_product.is_active then
      raise exception using errcode = '22023', message = 'PRODUCT_UNAVAILABLE';
    end if;

    select coalesce(sum(quantity), 0)::integer into v_reserved
    from public.inventory_reservations
    where product_id = v_product_id
      and status = 'reserved'
      and expires_at > now();

    if v_product.inventory_count - v_reserved < v_quantity then
      raise exception using errcode = 'P0001', message = 'INSUFFICIENT_STOCK';
    end if;

    v_subtotal := v_subtotal + (v_product.price::bigint * v_quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'name', v_product.name,
      'slug', v_product.slug,
      'price', v_product.price,
      'image', coalesce(v_product.images[1], ''),
      'quantity', v_quantity
    ));
  end loop;

  if v_subtotal > 2147483647
    or v_subtotal <> (p_checkout->>'subtotal')::bigint
    or v_discount < 0
    or v_discount > v_subtotal
    or v_shipping < 0
    or v_total <> v_subtotal + v_shipping - v_discount
    or v_total <= 0 then
    raise exception using errcode = '22023', message = 'CHECKOUT_TOTAL_MISMATCH';
  end if;

  if v_lead_coupon is not null then
    select * into v_coupon
    from public.coupon_leads
    where coupon_code = v_lead_coupon
    for update;

    if not found or v_coupon.is_used
      or (v_coupon.reserved_until > now() and v_coupon.reserved_order_id is not null) then
      raise exception using errcode = 'P0001', message = 'COUPON_UNAVAILABLE';
    end if;

    v_expected_discount := round(v_subtotal::numeric * v_coupon.discount_percent / 100)::integer;
    if v_discount <> least(v_expected_discount, v_subtotal::integer) then
      raise exception using errcode = '22023', message = 'COUPON_DISCOUNT_MISMATCH';
    end if;
  end if;

  insert into public.orders (
    customer_name, customer_email, customer_phone, customer_whatsapp_opted_in,
    shipping_address, items, subtotal, shipping_cost, discount, cod_fee,
    total_amount, currency, payment_method, payment_status, order_status,
    razorpay_order_id, coupon_code, lead_coupon_code,
    checkout_idempotency_key, checkout_request_fingerprint
  ) values (
    p_checkout->>'customer_name', lower(p_checkout->>'customer_email'),
    p_checkout->>'customer_phone',
    coalesce((p_checkout->>'customer_whatsapp_opted_in')::boolean, false),
    p_checkout->'shipping_address', v_items, v_subtotal::integer, v_shipping,
    v_discount, 0, v_total, 'INR', 'prepaid', 'pending', 'confirmed',
    p_checkout->>'razorpay_order_id', nullif(p_checkout->>'coupon_code', ''),
    v_lead_coupon, v_idempotency_key, v_fingerprint
  )
  on conflict (checkout_idempotency_key) where checkout_idempotency_key is not null
  do nothing
  returning * into v_order;

  if v_order.id is null then
    select * into v_order from public.orders where checkout_idempotency_key = v_idempotency_key;
    if not found or v_order.checkout_request_fingerprint <> v_fingerprint
      or v_order.payment_method <> 'prepaid' then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object('order', to_jsonb(v_order), 'created', false);
  end if;

  insert into public.inventory_reservations (order_id, product_id, quantity, expires_at)
  select v_order.id, (value->>'productId')::uuid, (value->>'quantity')::integer,
         now() + interval '30 minutes'
  from jsonb_array_elements(v_items);

  if v_lead_coupon is not null then
    update public.coupon_leads
    set reserved_order_id = v_order.id,
        reserved_until = now() + interval '30 minutes'
    where id = v_coupon.id;
  end if;

  insert into public.customers (name, email, phone, whatsapp_opted_in)
  values (
    v_order.customer_name, v_order.customer_email, v_order.customer_phone,
    v_order.customer_whatsapp_opted_in
  )
  on conflict (email) do update
  set name = excluded.name,
      phone = excluded.phone,
      whatsapp_opted_in = excluded.whatsapp_opted_in;

  return jsonb_build_object('order', to_jsonb(v_order), 'created', true);
end
$$;

create or replace function public.create_cod_order(p_checkout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_coupon public.coupon_leads%rowtype;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_reserved integer;
  v_subtotal bigint := 0;
  v_discount integer := coalesce((p_checkout->>'discount')::integer, 0);
  v_shipping integer := coalesce((p_checkout->>'shipping_cost')::integer, 0);
  v_cod_fee integer := coalesce((p_checkout->>'cod_fee')::integer, 0);
  v_total integer := (p_checkout->>'total_amount')::integer;
  v_idempotency_key text := nullif(p_checkout->>'idempotency_key', '');
  v_fingerprint text := p_checkout->>'request_fingerprint';
  v_lead_coupon text := nullif(p_checkout->>'lead_coupon_code', '');
  v_expected_discount integer;
begin
  if v_idempotency_key is null or v_fingerprint is null
    or v_fingerprint !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_checkout->'items') <> 'array'
    or jsonb_array_length(p_checkout->'items') not between 1 and 20 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKOUT';
  end if;
  if (
    select count(*) <> count(distinct value->>'productId')
    from jsonb_array_elements(p_checkout->'items')
  ) then
    raise exception using errcode = '22023', message = 'DUPLICATE_PRODUCTS';
  end if;

  select * into v_order
  from public.orders
  where checkout_idempotency_key = v_idempotency_key;

  if found then
    if v_order.checkout_request_fingerprint <> v_fingerprint
      or v_order.payment_method <> 'cod' then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object('order', to_jsonb(v_order), 'created', false);
  end if;

  for v_item in
    select value from jsonb_array_elements(p_checkout->'items') order by value->>'productId'
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity not between 1 and 10 then
      raise exception using errcode = '22023', message = 'INVALID_ITEM_QUANTITY';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
    for update;

    if not found or not v_product.is_active then
      raise exception using errcode = '22023', message = 'PRODUCT_UNAVAILABLE';
    end if;

    select coalesce(sum(quantity), 0)::integer into v_reserved
    from public.inventory_reservations
    where product_id = v_product_id
      and status = 'reserved'
      and expires_at > now();

    if v_product.inventory_count - v_reserved < v_quantity then
      raise exception using errcode = 'P0001', message = 'INSUFFICIENT_STOCK';
    end if;

    v_subtotal := v_subtotal + (v_product.price::bigint * v_quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'name', v_product.name,
      'slug', v_product.slug,
      'price', v_product.price,
      'image', coalesce(v_product.images[1], ''),
      'quantity', v_quantity
    ));
  end loop;

  if v_subtotal > 2147483647
    or v_subtotal <> (p_checkout->>'subtotal')::bigint
    or v_discount < 0
    or v_discount > v_subtotal
    or v_cod_fee < 0
    or v_shipping < 0
    or v_total <> v_subtotal + v_shipping + v_cod_fee - v_discount
    or v_total <= 0 then
    raise exception using errcode = '22023', message = 'CHECKOUT_TOTAL_MISMATCH';
  end if;

  if v_lead_coupon is not null then
    select * into v_coupon
    from public.coupon_leads
    where coupon_code = v_lead_coupon
    for update;

    if not found or v_coupon.is_used
      or (v_coupon.reserved_until > now() and v_coupon.reserved_order_id is not null) then
      raise exception using errcode = 'P0001', message = 'COUPON_UNAVAILABLE';
    end if;
    v_expected_discount := round(v_subtotal::numeric * v_coupon.discount_percent / 100)::integer;
    if v_discount <> least(v_expected_discount, v_subtotal::integer) then
      raise exception using errcode = '22023', message = 'COUPON_DISCOUNT_MISMATCH';
    end if;
  end if;

  insert into public.orders (
    customer_name, customer_email, customer_phone, customer_whatsapp_opted_in,
    shipping_address, items, subtotal, shipping_cost, discount, cod_fee,
    total_amount, currency, payment_method, payment_status, order_status,
    coupon_code, lead_coupon_code, checkout_idempotency_key,
    checkout_request_fingerprint, inventory_committed_at
  ) values (
    p_checkout->>'customer_name', lower(p_checkout->>'customer_email'),
    p_checkout->>'customer_phone',
    coalesce((p_checkout->>'customer_whatsapp_opted_in')::boolean, false),
    p_checkout->'shipping_address', v_items, v_subtotal::integer, v_shipping,
    v_discount, v_cod_fee, v_total, 'INR', 'cod', 'pending', 'confirmed',
    nullif(p_checkout->>'coupon_code', ''), v_lead_coupon, v_idempotency_key,
    v_fingerprint, now()
  )
  on conflict (checkout_idempotency_key) where checkout_idempotency_key is not null
  do nothing
  returning * into v_order;

  if v_order.id is null then
    select * into v_order from public.orders where checkout_idempotency_key = v_idempotency_key;
    if not found or v_order.checkout_request_fingerprint <> v_fingerprint
      or v_order.payment_method <> 'cod' then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object('order', to_jsonb(v_order), 'created', false);
  end if;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id = v_product_id for update;

    update public.products
    set inventory_count = inventory_count - v_quantity
    where id = v_product_id;

    insert into public.inventory_log (
      product_id, product_name, change_type, quantity_change,
      previous_stock, new_stock, order_id, notes
    ) values (
      v_product_id, v_product.name, 'sale', -v_quantity,
      v_product.inventory_count, v_product.inventory_count - v_quantity,
      v_order.id, 'COD inventory committed atomically'
    );
  end loop;

  if v_lead_coupon is not null then
    update public.coupon_leads
    set is_used = true,
        used_order_id = v_order.id,
        used_at = now(),
        reserved_order_id = null,
        reserved_until = null
    where id = v_coupon.id;
  end if;

  insert into public.customers (
    name, email, phone, whatsapp_opted_in, order_count, total_spent
  ) values (
    v_order.customer_name, v_order.customer_email, v_order.customer_phone,
    v_order.customer_whatsapp_opted_in, 1, 0
  )
  on conflict (email) do update
  set name = excluded.name,
      phone = excluded.phone,
      whatsapp_opted_in = excluded.whatsapp_opted_in,
      order_count = public.customers.order_count + 1,
      total_spent = public.customers.total_spent;

  insert into public.payment_outbox (order_id, event_key, event_type, payload)
  values (
    v_order.id, 'order.confirmed:' || v_order.id, 'order.confirmed',
    jsonb_build_object('payment_method', 'cod')
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object('order', to_jsonb(v_order), 'created', true);
end
$$;

create or replace function public.finalize_razorpay_payment(
  p_order_id uuid,
  p_razorpay_order_id text,
  p_razorpay_payment_id text,
  p_razorpay_signature text,
  p_amount integer,
  p_currency text,
  p_webhook_event_id text default null,
  p_webhook_event_type text default null,
  p_webhook_payload_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_existing_event public.razorpay_webhook_events%rowtype;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_other_reserved integer;
begin
  if p_razorpay_order_id !~ '^order_[A-Za-z0-9]{8,64}$'
    or p_razorpay_payment_id !~ '^pay_[A-Za-z0-9]{8,64}$'
    or p_amount is null or p_amount <= 0 or p_currency <> 'INR' then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_DETAILS';
  end if;

  select * into v_order
  from public.orders
  where razorpay_order_id = p_razorpay_order_id
    and (p_order_id is null or id = p_order_id)
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ORDER_NOT_FOUND';
  end if;
  if v_order.payment_method <> 'prepaid'
    or v_order.total_amount <> p_amount
    or v_order.currency <> p_currency
    or p_currency <> 'INR' then
    raise exception using errcode = '22023', message = 'PAYMENT_ORDER_MISMATCH';
  end if;

  if p_webhook_event_id is not null then
    select * into v_existing_event
    from public.razorpay_webhook_events
    where event_id = p_webhook_event_id
    for update;

    if found then
      if v_existing_event.payload_hash <> p_webhook_payload_hash
        or v_existing_event.razorpay_order_id <> p_razorpay_order_id then
        raise exception using errcode = '22023', message = 'WEBHOOK_EVENT_MISMATCH';
      end if;
      if v_existing_event.processed_at is not null then
        return jsonb_build_object('order', to_jsonb(v_order), 'newly_finalized', false);
      end if;
    else
      insert into public.razorpay_webhook_events (
        event_id, event_type, razorpay_order_id, razorpay_payment_id, payload_hash
      ) values (
        p_webhook_event_id, coalesce(p_webhook_event_type, 'payment.captured'),
        p_razorpay_order_id, p_razorpay_payment_id, p_webhook_payload_hash
      );
    end if;
  end if;

  if v_order.payment_status = 'paid' then
    if v_order.razorpay_payment_id <> p_razorpay_payment_id then
      raise exception using errcode = '23505', message = 'ORDER_ALREADY_PAID_WITH_DIFFERENT_PAYMENT';
    end if;
    if p_webhook_event_id is not null then
      update public.razorpay_webhook_events
      set processed_at = now()
      where event_id = p_webhook_event_id;
    end if;
    return jsonb_build_object('order', to_jsonb(v_order), 'newly_finalized', false);
  end if;

  if v_order.payment_status <> 'pending' or v_order.inventory_committed_at is not null then
    raise exception using errcode = '55000', message = 'ORDER_NOT_PENDING';
  end if;

  for v_item in select value from jsonb_array_elements(v_order.items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity not between 1 and 10 then
      raise exception using errcode = '22023', message = 'INVALID_STORED_ITEM';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND';
    end if;

    select coalesce(sum(quantity), 0)::integer into v_other_reserved
    from public.inventory_reservations
    where product_id = v_product_id
      and order_id <> v_order.id
      and status = 'reserved'
      and expires_at > now();

    if v_product.inventory_count - v_other_reserved < v_quantity then
      raise exception using errcode = 'P0001', message = 'INSUFFICIENT_STOCK_FOR_CAPTURED_PAYMENT';
    end if;

    update public.products
    set inventory_count = inventory_count - v_quantity
    where id = v_product_id;

    insert into public.inventory_log (
      product_id, product_name, change_type, quantity_change,
      previous_stock, new_stock, order_id, notes
    ) values (
      v_product_id, v_product.name, 'sale', -v_quantity,
      v_product.inventory_count, v_product.inventory_count - v_quantity,
      v_order.id, 'Prepaid inventory committed atomically'
    );

    update public.inventory_reservations
    set status = 'consumed', consumed_at = now()
    where order_id = v_order.id and product_id = v_product_id and status = 'reserved';
  end loop;

  update public.orders
  set payment_status = 'paid',
      razorpay_payment_id = p_razorpay_payment_id,
      razorpay_signature = coalesce(p_razorpay_signature, razorpay_signature),
      inventory_committed_at = now()
  where id = v_order.id
  returning * into v_order;

  if v_order.lead_coupon_code is not null then
    update public.coupon_leads
    set is_used = true,
        used_order_id = v_order.id,
        used_at = now(),
        reserved_order_id = null,
        reserved_until = null
    where coupon_code = v_order.lead_coupon_code
      and reserved_order_id = v_order.id
      and not is_used;

    if not found then
      raise exception using errcode = 'P0001', message = 'COUPON_RESERVATION_LOST';
    end if;
  end if;

  update public.customers
  set order_count = order_count + 1,
      total_spent = total_spent + v_order.total_amount
  where email = v_order.customer_email;

  insert into public.payment_outbox (order_id, event_key, event_type, payload)
  values (
    v_order.id, 'order.confirmed:' || v_order.id, 'order.confirmed',
    jsonb_build_object('payment_method', 'prepaid')
  )
  on conflict (event_key) do nothing;

  if p_webhook_event_id is not null then
    update public.razorpay_webhook_events
    set processed_at = now()
    where event_id = p_webhook_event_id;
  end if;

  return jsonb_build_object('order', to_jsonb(v_order), 'newly_finalized', true);
end
$$;

create or replace function public.record_razorpay_payment_failure(
  p_razorpay_order_id text,
  p_razorpay_payment_id text,
  p_webhook_event_id text,
  p_webhook_event_type text,
  p_webhook_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.razorpay_webhook_events%rowtype;
begin
  if p_razorpay_order_id !~ '^order_[A-Za-z0-9]{8,64}$'
    or p_razorpay_payment_id !~ '^pay_[A-Za-z0-9]{8,64}$'
    or p_webhook_event_id is null or length(p_webhook_event_id) > 128
    or p_webhook_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_FAILURE_EVENT';
  end if;

  if not exists (
    select 1 from public.orders
    where razorpay_order_id = p_razorpay_order_id and payment_method = 'prepaid'
  ) then
    raise exception using errcode = 'P0002', message = 'ORDER_NOT_FOUND';
  end if;

  select * into v_event
  from public.razorpay_webhook_events
  where event_id = p_webhook_event_id
  for update;

  if found then
    if v_event.payload_hash <> p_webhook_payload_hash
      or v_event.razorpay_order_id <> p_razorpay_order_id then
      raise exception using errcode = '22023', message = 'WEBHOOK_EVENT_MISMATCH';
    end if;
    return jsonb_build_object('duplicate', true);
  end if;

  insert into public.razorpay_webhook_events (
    event_id, event_type, razorpay_order_id, razorpay_payment_id,
    payload_hash, processed_at
  ) values (
    p_webhook_event_id, p_webhook_event_type, p_razorpay_order_id,
    p_razorpay_payment_id, p_webhook_payload_hash, now()
  );

  -- A failed payment attempt does not fail the merchant order: Razorpay permits
  -- another payment attempt against the same order.
  return jsonb_build_object('duplicate', false);
end
$$;

create or replace function public.consume_rate_limit(
  p_scope_key text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  if p_scope_key is null or length(p_scope_key) < 16
    or p_action is null or p_action !~ '^[a-z][a-z0-9_.-]{2,63}$'
    or p_limit not between 1 and 100
    or p_window_seconds not between 60 and 86400 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT';
  end if;

  insert into public.rate_limit_attempts (
    scope_key, action, window_started_at, attempts, updated_at
  ) values (p_scope_key, p_action, now(), 1, now())
  on conflict (scope_key, action) do update
  set attempts = case
        when public.rate_limit_attempts.window_started_at
          <= now() - make_interval(secs => p_window_seconds)
          then 1
        else public.rate_limit_attempts.attempts + 1
      end,
      window_started_at = case
        when public.rate_limit_attempts.window_started_at
          <= now() - make_interval(secs => p_window_seconds)
          then now()
        else public.rate_limit_attempts.window_started_at
      end,
      updated_at = now()
  returning attempts into v_attempts;

  return v_attempts <= p_limit;
end
$$;

create or replace function public.admin_adjust_inventory(
  p_product_id uuid,
  p_quantity_change integer,
  p_change_type text default 'adjustment',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_new_stock integer;
  v_log public.inventory_log%rowtype;
begin
  if p_quantity_change is null or p_quantity_change = 0
    or abs(p_quantity_change::bigint) > 100000 then
    raise exception using errcode = '22023', message = 'INVALID_INVENTORY_DELTA';
  end if;
  if p_change_type is null or p_change_type not in ('restock', 'adjustment', 'return') then
    raise exception using errcode = '22023', message = 'INVALID_INVENTORY_CHANGE_TYPE';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    raise exception using errcode = '22023', message = 'INVENTORY_NOTES_TOO_LONG';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND';
  end if;

  v_new_stock := v_product.inventory_count + p_quantity_change;
  if v_new_stock < 0 then
    raise exception using errcode = '22003', message = 'INSUFFICIENT_STOCK';
  end if;

  update public.products
  set inventory_count = v_new_stock
  where id = v_product.id;

  insert into public.inventory_log (
    product_id, product_name, change_type, quantity_change,
    previous_stock, new_stock, notes
  ) values (
    v_product.id, v_product.name, p_change_type, p_quantity_change,
    v_product.inventory_count, v_new_stock, nullif(trim(p_notes), '')
  )
  returning * into v_log;

  return jsonb_build_object(
    'product_id', v_product.id,
    'previous_stock', v_product.inventory_count,
    'new_stock', v_new_stock,
    'quantity_change', p_quantity_change,
    'log', to_jsonb(v_log)
  );
end
$$;

create or replace function public.claim_payment_outbox_events(p_limit integer default 10)
returns setof public.payment_outbox
language sql
security definer
set search_path = public
as $$
  with claimable as (
    select id
    from public.payment_outbox
    where attempts < 5
      and available_at <= now()
      and (
        status in ('pending', 'failed')
        or (status = 'processing' and locked_at < now() - interval '10 minutes')
      )
    order by available_at, created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  )
  update public.payment_outbox o
  set status = 'processing',
      locked_at = now(),
      attempts = o.attempts + 1,
      last_error = null
  from claimable c
  where o.id = c.id
  returning o.*;
$$;

create or replace function public.complete_payment_outbox_event(p_event_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.payment_outbox
  set status = 'completed', processed_at = now(), locked_at = null, last_error = null
  where id = p_event_id and status = 'processing';
$$;

create or replace function public.fail_payment_outbox_event(
  p_event_id uuid,
  p_error text,
  p_retry_delay_seconds integer default 60
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.payment_outbox
  set status = 'failed',
      available_at = now() + make_interval(secs => least(greatest(p_retry_delay_seconds, 10), 3600)),
      locked_at = null,
      last_error = left(p_error, 1000)
  where id = p_event_id and status = 'processing';
$$;

revoke all on function public.reserve_prepaid_order(jsonb) from public, anon, authenticated;
revoke all on function public.create_cod_order(jsonb) from public, anon, authenticated;
revoke all on function public.finalize_razorpay_payment(uuid, text, text, text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_razorpay_payment_failure(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_adjust_inventory(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.claim_payment_outbox_events(integer) from public, anon, authenticated;
revoke all on function public.complete_payment_outbox_event(uuid) from public, anon, authenticated;
revoke all on function public.fail_payment_outbox_event(uuid, text, integer) from public, anon, authenticated;

grant execute on function public.reserve_prepaid_order(jsonb) to service_role;
grant execute on function public.create_cod_order(jsonb) to service_role;
grant execute on function public.finalize_razorpay_payment(uuid, text, text, text, integer, text, text, text, text) to service_role;
grant execute on function public.record_razorpay_payment_failure(text, text, text, text, text) to service_role;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.admin_adjust_inventory(uuid, integer, text, text) to service_role;
grant execute on function public.claim_payment_outbox_events(integer) to service_role;
grant execute on function public.complete_payment_outbox_event(uuid) to service_role;
grant execute on function public.fail_payment_outbox_event(uuid, text, integer) to service_role;
