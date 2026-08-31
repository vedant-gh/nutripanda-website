-- Close the remaining payment/cancellation and reservation races.
--
-- A captured Razorpay payment is money movement even when the local order was
-- cancelled or stock became unavailable. Such payments are durably recorded,
-- but the order is kept cancelled, inventory is not committed, and an explicit
-- full-refund review is required. Admin stock reductions also preserve active
-- prepaid reservations, and carrier-side cancellation cannot bypass refund
-- reconciliation for a locally paid order.

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  created_at timestamptz not null default now(),
  constraint waitlist_signups_contact_required check (email is not null or phone is not null)
);

create unique index if not exists waitlist_signups_email_unique_idx
  on public.waitlist_signups (lower(email)) where email is not null;
create unique index if not exists waitlist_signups_phone_unique_idx
  on public.waitlist_signups (phone) where phone is not null;
alter table public.waitlist_signups enable row level security;
revoke all on table public.waitlist_signups from anon, authenticated;

create table if not exists public.inventory_reconciliation_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  review_type text not null check (review_type in (
    'legacy_duplicate_sale_ledger',
    'legacy_sale_ledger_mismatch',
    'legacy_inventory_timestamp_conflict'
  )),
  expected_quantity integer not null check (expected_quantity > 0),
  logged_sale_quantity integer not null check (logged_sale_quantity >= 0),
  status text not null default 'open' check (status in ('open', 'resolved')),
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (order_id, product_id, review_type)
);
alter table public.inventory_reconciliation_reviews enable row level security;
revoke all on table public.inventory_reconciliation_reviews from anon, authenticated;

create table if not exists public.inventory_reclaim_shortfalls (
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('physical_return_offset', 'manual_reconciliation')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (order_id, product_id)
);
alter table public.inventory_reclaim_shortfalls enable row level security;
revoke all on table public.inventory_reclaim_shortfalls from anon, authenticated;

alter table public.inventory_reconciliation_reviews
  drop constraint if exists inventory_reconciliation_reviews_review_type_check,
  drop constraint if exists inventory_reconciliation_reviews_logged_sale_quantity_check;
alter table public.inventory_reconciliation_reviews
  add constraint inventory_reconciliation_reviews_review_type_check
    check (review_type in (
      'legacy_duplicate_sale_ledger',
      'legacy_sale_ledger_mismatch',
      'legacy_inventory_timestamp_conflict'
    )),
  add constraint inventory_reconciliation_reviews_logged_sale_quantity_check
    check (logged_sale_quantity >= 0);

alter table public.orders
  add column if not exists payment_review_required boolean not null default false,
  add column if not exists payment_review_reason text,
  add column if not exists fulfillment_review_required boolean not null default false,
  add column if not exists fulfillment_review_reason text,
  add column if not exists inventory_reclaimed_at timestamptz,
  add column if not exists inventory_reclaim_shortfall integer not null default 0,
  add column if not exists shipment_delivered_at timestamptz;

create index if not exists orders_checkout_phone_created_idx
  on public.orders (customer_phone, created_at desc)
  where checkout_idempotency_key is not null;
create index if not exists orders_checkout_email_created_idx
  on public.orders (lower(customer_email), created_at desc)
  where checkout_idempotency_key is not null;

create or replace function public.enforce_public_checkout_abuse_limits()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total_units integer;
  v_active_orders integer;
  v_phone_lock bigint;
  v_email_lock bigint;
begin
  if new.checkout_idempotency_key is null then return new; end if;
  if exists (
    select 1 from public.orders
    where checkout_idempotency_key = new.checkout_idempotency_key
  ) then
    return new;
  end if;

  select coalesce(sum(
    case
      when coalesce(item->>'quantity', '') ~ '^[1-9][0-9]*$'
        then least((item->>'quantity')::numeric, 1000)
      else 1000
    end
  ), 0)::integer
  into v_total_units
  from jsonb_array_elements(
    case when jsonb_typeof(new.items) = 'array' then new.items else '[]'::jsonb end
  ) as item;

  if (new.payment_method = 'cod' and v_total_units > 3)
    or (new.payment_method = 'prepaid' and v_total_units > 6) then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_UNIT_LIMIT';
  end if;

  v_phone_lock := hashtextextended('checkout-phone:' || new.customer_phone, 0);
  v_email_lock := hashtextextended('checkout-email:' || lower(new.customer_email), 0);
  perform pg_advisory_xact_lock(least(v_phone_lock, v_email_lock));
  if v_phone_lock <> v_email_lock then
    perform pg_advisory_xact_lock(greatest(v_phone_lock, v_email_lock));
  end if;

  if new.payment_method = 'cod' then
    select count(*)::integer into v_active_orders
    from public.orders as o
    where o.checkout_idempotency_key is not null
      and o.payment_method = 'cod'
      and o.created_at > now() - interval '24 hours'
      and o.order_status in ('confirmed', 'processing', 'shipped')
      and o.payment_status <> 'refunded'
      and (
        o.customer_phone = new.customer_phone
        or lower(o.customer_email) = lower(new.customer_email)
      );
    if v_active_orders >= 1 then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_ACTIVE_LIMIT';
    end if;
  else
    select count(*)::integer into v_active_orders
    from public.orders as o
    where o.checkout_idempotency_key is not null
      and o.payment_method = 'prepaid'
      and o.created_at > now() - interval '1 hour'
      and o.payment_status = 'pending'
      and o.order_status <> 'cancelled'
      and (
        o.customer_phone = new.customer_phone
        or lower(o.customer_email) = lower(new.customer_email)
      );
    if v_active_orders >= 2 then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_ACTIVE_LIMIT';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists enforce_public_checkout_abuse_limits on public.orders;
create trigger enforce_public_checkout_abuse_limits
before insert on public.orders
for each row execute function public.enforce_public_checkout_abuse_limits();
revoke all on function public.enforce_public_checkout_abuse_limits()
  from public, anon, authenticated;

update public.orders
set shipment_delivered_at = coalesce(shipment_delivered_at, shipped_at, updated_at, now())
where shipment_delivered_at is null
  and (
    order_status = 'delivered'
    or upper(regexp_replace(coalesce(shipment_status, ''), '[^A-Za-z0-9]+', '_', 'g'))
      in ('DELIVERED', 'DELIVERY_COMPLETE')
  );

-- Older checkout code wrote the inventory ledger before the explicit commit /
-- release timestamps existed. Reconstruct only facts proven by order-linked
-- ledger rows so a later cancellation neither misses nor doubles a restock.
update public.orders as o
set inventory_committed_at = (
  select min(l.created_at)
  from public.inventory_log as l
  where l.order_id = o.id and l.change_type = 'sale'
)
where o.inventory_committed_at is null
  and exists (
    select 1 from public.inventory_log as l
    where l.order_id = o.id and l.change_type = 'sale'
  );

update public.orders as o
set inventory_released_at = (
  select min(l.created_at)
  from public.inventory_log as l
  where l.order_id = o.id and l.change_type = 'return'
)
where o.inventory_released_at is null
  and exists (
    select 1 from public.inventory_log as l
    where l.order_id = o.id and l.change_type = 'return'
  );

-- A missing historic AWB is not proof that no carrier shipment exists: the old
-- flow could lose the DB write after Proship accepted creation. Quarantine the
-- order until an admin checks Proship by reference and explicitly confirms
-- there is no shipment; never manufacture sellable stock during migration.
update public.orders
set shipment_booking_state = 'cancel_uncertain',
    shipment_last_error = 'Historical shipment outcome is unknown; reconcile by order reference before restocking'
where order_status = 'cancelled'
  and awb_number is null
  and inventory_committed_at is not null
  and inventory_released_at is null;

-- The previous shipping migration inferred carrier cancellation solely from a
-- local cancelled status. A historic cancelled order with an AWB is uncertain
-- until Proship itself reports CANCELLED (or a new cancellation succeeds).
update public.orders
set shipment_booking_state = 'cancel_uncertain',
    shipment_last_error = 'Historical cancellation is not confirmed by carrier'
where order_status = 'cancelled'
  and awb_number is not null
  and shipment_cancelled_at is null;

update public.orders
set fulfillment_review_required = true,
    fulfillment_review_reason = 'return_inventory_pending',
    shipment_last_error = 'Carrier cancellation is confirmed; confirm the physical return before restocking'
where order_status = 'cancelled'
  and awb_number is not null
  and shipment_cancelled_at is not null
  and shipment_delivered_at is null
  and inventory_committed_at is not null
  and inventory_released_at is null;

update public.orders
set payment_review_required = true,
    payment_review_reason = coalesce(
      payment_review_reason,
      'late_capture_after_cancellation'
    )
where payment_method = 'prepaid'
  and payment_status = 'paid'
  and order_status = 'cancelled'
  and payment_refunded_at is null;

update public.orders
set payment_review_required = false,
    payment_review_reason = null
where payment_status = 'refunded';

alter table public.orders
  drop constraint if exists orders_payment_review_reason_check;
alter table public.orders
  add constraint orders_payment_review_reason_check
  check (
    (
      payment_review_required
      and payment_review_reason in (
        'late_capture_after_cancellation',
        'checkout_expired_before_capture',
        'inventory_shortfall_after_capture',
        'coupon_reservation_lost_after_capture',
        'capture_after_failed_attempt'
      )
    )
    or (not payment_review_required and payment_review_reason is null)
  );

-- Provider delivery evidence wins over a historic local cancellation marker.
-- Inventory that was already released is compensated below after the guarded
-- reclaim helper is defined; inventory that was never released needs no stock
-- mutation, but the payment/fulfillment incident must still be visible.
update public.orders
set fulfillment_review_required = true,
    fulfillment_review_reason = case
      when payment_status = 'refunded' then 'return_inventory_pending'
      else 'delivered_after_cancellation'
    end,
    shipment_booking_state = 'booked',
    shipment_last_error = case
      when order_status = 'cancelled'
        then 'Historical carrier delivery after local cancellation requires reconciliation'
      else 'Historical carrier delivery without settled prepaid payment requires reconciliation'
    end
where shipment_delivered_at is not null
  and (
    order_status = 'cancelled'
    or payment_review_required
    or (payment_method = 'prepaid' and payment_status <> 'paid')
  );

alter table public.orders
  drop constraint if exists orders_fulfillment_review_check;
alter table public.orders
  add constraint orders_fulfillment_review_check
  check (
    inventory_reclaim_shortfall >= 0
    and (
      (
        fulfillment_review_required
        and fulfillment_review_reason in (
          'delivered_after_cancellation',
          'return_inventory_pending',
          'legacy_inventory_ledger_mismatch',
          'shipment_while_ineligible'
        )
      )
      or (
        not fulfillment_review_required
        and fulfillment_review_reason is null
      )
    )
  );

-- A provider status proving physical dispatch is authoritative even when an
-- older application path never persisted the AWB/commit transition. Keep the
-- local order ineligible, quarantine the units below, and require an explicit
-- carrier stop or delivery reconciliation.
update public.orders as o
set fulfillment_review_required = true,
    fulfillment_review_reason = 'shipment_while_ineligible',
    shipment_booking_state = 'cancel_uncertain',
    shipped_at = coalesce(shipped_at, updated_at, now()),
    shipment_last_error = 'Historical live shipment exists for an ineligible order; cancel or reconcile it before fulfillment'
where o.shipment_delivered_at is null
  and upper(regexp_replace(coalesce(o.shipment_status, ''), '[^A-Za-z0-9]+', '_', 'g'))
    in ('SHIPPED', 'PICKED_UP', 'PICKUP_COMPLETE', 'IN_TRANSIT', 'OUT_FOR_DELIVERY')
  and (
    o.order_status = 'cancelled'
    or o.payment_review_required
    or o.payment_status in ('failed', 'refunded')
    or (o.payment_method = 'prepaid' and o.payment_status <> 'paid')
  )
  and not exists (
    select 1 from public.inventory_reconciliation_reviews as r
    where r.order_id = o.id and r.status = 'open'
  );

-- Duplicate historic sale ledger rows are ambiguous: concurrent old handlers
-- could log twice while only one absolute stock write won, or could truly
-- decrement twice. Never guess and manufacture stock. Persist a durable review
-- record and surface the affected order for an explicit ledger/physical count.
with expected as (
  select
    o.id as order_id,
    p.id as product_id,
    sum((item->>'quantity')::integer)::integer as expected_quantity
  from public.orders as o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end
  ) as item
  join public.products as p
    on p.id::text = coalesce(item->>'productId', item->>'product_id')
  where coalesce(item->>'productId', item->>'product_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(item->>'quantity', '') ~ '^[1-9][0-9]*$'
    and (item->>'quantity')::numeric <= 100
  group by o.id, p.id
), actual as (
  select l.order_id, l.product_id, sum(-l.quantity_change)::integer as sold_quantity
  from public.inventory_log as l
  where l.order_id is not null
    and l.change_type = 'sale'
    and l.quantity_change < 0
    and l.notes is distinct from 'Inventory re-applied after carrier delivered a cancelled order'
    and l.notes is distinct from 'Inventory re-applied after an ineligible carrier shipment was dispatched'
  group by l.order_id, l.product_id
)
insert into public.inventory_reconciliation_reviews (
  order_id, product_id, review_type, expected_quantity,
  logged_sale_quantity, status, notes
)
select
  e.order_id, e.product_id, 'legacy_duplicate_sale_ledger',
  e.expected_quantity, a.sold_quantity, 'open',
  'Do not auto-adjust: compare ledger transitions with a physical stock count.'
from expected as e
join actual as a using (order_id, product_id)
where a.sold_quantity > e.expected_quantity
on conflict (order_id, product_id, review_type) do update
set expected_quantity = excluded.expected_quantity,
    logged_sale_quantity = excluded.logged_sale_quantity,
    notes = excluded.notes;

-- The old JavaScript verifier wrote products and inventory_log one item at a
-- time, after the payment had already been marked paid. A process failure could
-- therefore leave zero/partial sale rows, while its stock clamp could also log
-- a larger quantity_change than the stock transition actually applied. Treat
-- every such ledger as unknown until a physical-stock reconciliation approves
-- a baseline; shipping or automatic restocking must not guess which write won.
with expected as (
  select
    o.id as order_id,
    p.id as product_id,
    least(sum((item->>'quantity')::numeric), 2147483647)::integer as expected_quantity
  from public.orders as o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end
  ) as item
  join public.products as p
    on p.id::text = coalesce(item->>'productId', item->>'product_id')
  where (
      o.payment_status = 'paid'
      or o.payment_method = 'cod'
      or o.order_status in ('processing', 'shipped', 'delivered')
      or o.inventory_committed_at is not null
    )
    and coalesce(item->>'productId', item->>'product_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(item->>'quantity', '') ~ '^[1-9][0-9]*$'
    and (item->>'quantity')::numeric <= 100
  group by o.id, p.id
), actual as (
  select
    l.order_id,
    l.product_id,
    least(sum(-l.quantity_change::numeric), 2147483647)::integer as logged_sale_quantity,
    least(sum((l.previous_stock - l.new_stock)::numeric), 2147483647)::integer
      as applied_sale_quantity,
    bool_or(
      l.new_stock > l.previous_stock
      or l.previous_stock - l.new_stock <> -l.quantity_change
    ) as transition_inconsistent
  from public.inventory_log as l
  where l.order_id is not null
    and l.change_type = 'sale'
    and l.quantity_change < 0
    and l.notes is distinct from 'Inventory re-applied after carrier delivered a cancelled order'
    and l.notes is distinct from 'Inventory re-applied after an ineligible carrier shipment was dispatched'
  group by l.order_id, l.product_id
)
insert into public.inventory_reconciliation_reviews (
  order_id, product_id, review_type, expected_quantity,
  logged_sale_quantity, status, notes
)
select
  e.order_id,
  e.product_id,
  'legacy_sale_ledger_mismatch',
  e.expected_quantity,
  coalesce(a.logged_sale_quantity, 0),
  'open',
  concat(
    'Expected ', e.expected_quantity,
    ' sold unit(s); ledger reports ', coalesce(a.logged_sale_quantity, 0),
    ' and stock transitions applied ', coalesce(a.applied_sale_quantity, 0),
    '. Reconcile against physical stock before fulfillment.'
  )
from expected as e
left join actual as a using (order_id, product_id)
where coalesce(a.logged_sale_quantity, 0) <> e.expected_quantity
   or coalesce(a.applied_sale_quantity, 0) <> e.expected_quantity
   or coalesce(a.transition_inconsistent, false)
on conflict (order_id, product_id, review_type) do update
set expected_quantity = excluded.expected_quantity,
    logged_sale_quantity = excluded.logged_sale_quantity,
    notes = excluded.notes;

with expected as (
  select
    o.id as order_id,
    p.id as product_id,
    sum((item->>'quantity')::integer)::integer as expected_quantity
  from public.orders as o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end
  ) as item
  join public.products as p
    on p.id::text = coalesce(item->>'productId', item->>'product_id')
  where o.inventory_committed_at is null
    and o.inventory_released_at is not null
    and coalesce(item->>'productId', item->>'product_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(item->>'quantity', '') ~ '^[1-9][0-9]*$'
    and (item->>'quantity')::numeric <= 100
  group by o.id, p.id
)
insert into public.inventory_reconciliation_reviews (
  order_id, product_id, review_type, expected_quantity,
  logged_sale_quantity, status, notes
)
select
  e.order_id, e.product_id, 'legacy_inventory_timestamp_conflict',
  e.expected_quantity, 0, 'open',
  'Do not auto-adjust: inventory was marked released without a proven prior commit.'
from expected as e
on conflict (order_id, product_id, review_type) do update
set expected_quantity = excluded.expected_quantity,
    notes = excluded.notes;

update public.orders as o
set fulfillment_review_required = true,
    fulfillment_review_reason = 'legacy_inventory_ledger_mismatch',
    notes = left(concat_ws(
      E'\n', nullif(o.notes, ''),
      'Legacy sale ledger is missing, partial, duplicated, or inconsistent; reconcile against physical stock before fulfillment or inventory adjustment.'
    ), 2000)
where exists (
    select 1 from public.inventory_reconciliation_reviews as r
    where r.order_id = o.id and r.status = 'open'
  );

-- Missing products and malformed historic line items cannot be represented by
-- the per-product review table (whose FK intentionally requires a real
-- product). Quarantine the whole order so an invalid item cannot disappear
-- from the expected-items join and leave the order shippable.
update public.orders as o
set fulfillment_review_required = true,
    fulfillment_review_reason = 'legacy_inventory_ledger_mismatch',
    notes = left(concat_ws(
      E'\n', nullif(o.notes, ''),
      'Historic order items are empty, malformed, or reference a missing product; manually reconcile the order before fulfillment.'
    ), 2000)
where (
    o.payment_status = 'paid'
    or o.payment_method = 'cod'
    or o.order_status in ('processing', 'shipped', 'delivered')
    or o.inventory_committed_at is not null
  )
  and (
    case when jsonb_typeof(o.items) = 'array' then jsonb_array_length(o.items) else 0 end = 0
    or exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end
      ) as item
      left join public.products as p
        on p.id::text = coalesce(item->>'productId', item->>'product_id')
      where coalesce(item->>'productId', item->>'product_id', '')
              !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or coalesce(item->>'quantity', '') !~ '^[1-9][0-9]*$'
         or case
              when coalesce(item->>'quantity', '') ~ '^[1-9][0-9]*$'
                then (item->>'quantity')::numeric > 100
              else false
            end
         or p.id is null
    )
  );

update public.orders as o
set fulfillment_review_required = true,
    fulfillment_review_reason = 'legacy_inventory_ledger_mismatch',
    notes = left(concat_ws(
      E'\n', nullif(o.notes, ''),
      'Inventory release timestamp has no proven prior commit; reconcile against physical stock.'
    ), 2000)
where o.inventory_committed_at is null
  and o.inventory_released_at is not null;

-- All inventory releases go through this function. An open historical ledger
-- review makes the correct stock baseline unknowable, so no automatic return
-- adjustment is permitted until an admin resolves that review explicitly.
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
  v_shortfall_quantity integer;
  v_restock_quantity integer;
  v_remaining_shortfall integer;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found
    or v_order.inventory_committed_at is null
    or v_order.inventory_released_at is not null
    or exists (
      select 1
      from public.inventory_reconciliation_reviews as r
      where r.order_id = p_order_id and r.status = 'open'
    ) then
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
    select quantity into v_shortfall_quantity
    from public.inventory_reclaim_shortfalls
    where order_id = p_order_id
      and product_id = v_item.product_id::uuid
      and status = 'open'
    for update;
    v_shortfall_quantity := coalesce(v_shortfall_quantity, 0);
    if v_shortfall_quantity > v_item.quantity then
      raise exception 'inventory_reclaim_shortfall_exceeds_return';
    end if;
    v_restock_quantity := v_item.quantity - v_shortfall_quantity;

    if v_restock_quantity > 0 then
      update public.products
      set inventory_count = inventory_count + v_restock_quantity
      where id = v_item.product_id::uuid
      returning name, inventory_count into v_product_name, v_new_stock;
      if not found then raise exception 'inventory_product_missing'; end if;

      insert into public.inventory_log (
        product_id, product_name, change_type, quantity_change,
        previous_stock, new_stock, order_id, notes
      ) values (
        v_item.product_id::uuid, v_product_name, 'return', v_restock_quantity,
        v_new_stock - v_restock_quantity, v_new_stock, p_order_id,
        'Inventory released once after confirmed physical return/cancellation'
      );
    end if;

    if v_shortfall_quantity > 0 then
      update public.inventory_reclaim_shortfalls
      set status = 'resolved',
          resolution = 'physical_return_offset',
          resolved_at = now()
      where order_id = p_order_id
        and product_id = v_item.product_id::uuid
        and status = 'open';
    end if;
  end loop;

  select coalesce(sum(quantity), 0)::integer into v_remaining_shortfall
  from public.inventory_reclaim_shortfalls
  where order_id = p_order_id and status = 'open';
  if v_remaining_shortfall > 0 then
    raise exception 'inventory_reclaim_shortfall_unmatched';
  end if;

  update public.orders
  set inventory_released_at = now(),
      inventory_reclaim_shortfall = 0
  where id = p_order_id and inventory_released_at is null;

  return true;
end;
$$;

-- Reuse the original Razorpay order after a customer abandons or fails Checkout.
-- This atomically renews the soft stock/coupon reservation, avoiding both a
-- permanently stuck browser and a second provider order that could double-pay.
create or replace function public.renew_prepaid_checkout_reservation(
  p_order_id uuid,
  p_fingerprint text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_coupon public.coupon_leads%rowtype;
  v_other_reserved integer;
begin
  if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_REQUEST_FINGERPRINT';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'order_not_found'; end if;
  if v_order.checkout_request_fingerprint is distinct from p_fingerprint then
    raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
  end if;
  if v_order.payment_method <> 'prepaid'
    or v_order.payment_status <> 'pending'
    or v_order.order_status <> 'confirmed'
    or v_order.razorpay_order_id is null
    or v_order.inventory_committed_at is not null
    or v_order.payment_review_required
    or v_order.fulfillment_review_required
    or v_order.created_at < now() - interval '24 hours' then
    raise exception 'checkout_cannot_be_renewed';
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
    order by coalesce(item->>'productId', item->>'product_id')
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id::uuid
    for update;

    if not found or not v_product.is_active then
      raise exception using errcode = '22023', message = 'PRODUCT_UNAVAILABLE';
    end if;

    select coalesce(sum(quantity), 0)::integer into v_other_reserved
    from public.inventory_reservations
    where product_id = v_product.id
      and order_id <> v_order.id
      and status = 'reserved'
      and expires_at > now();

    if v_product.inventory_count - v_other_reserved < v_item.quantity then
      raise exception using errcode = 'P0001', message = 'INSUFFICIENT_STOCK';
    end if;
  end loop;

  if v_order.lead_coupon_code is not null then
    select * into v_coupon
    from public.coupon_leads
    where coupon_code = v_order.lead_coupon_code
    for update;

    if not found
      or v_coupon.is_used
      or (
        v_coupon.reserved_order_id is distinct from v_order.id
        and v_coupon.reserved_order_id is not null
        and v_coupon.reserved_until > now()
      ) then
      raise exception using errcode = 'P0001', message = 'COUPON_UNAVAILABLE';
    end if;
  end if;

  insert into public.inventory_reservations (
    order_id, product_id, quantity, status, expires_at, consumed_at, released_at
  )
  select
    v_order.id,
    coalesce(item->>'productId', item->>'product_id')::uuid,
    sum((item->>'quantity')::integer)::integer,
    'reserved',
    now() + interval '30 minutes',
    null,
    null
  from jsonb_array_elements(v_order.items) item
  group by coalesce(item->>'productId', item->>'product_id')
  on conflict (order_id, product_id) do update
  set quantity = excluded.quantity,
      status = 'reserved',
      expires_at = excluded.expires_at,
      consumed_at = null,
      released_at = null;

  if v_order.lead_coupon_code is not null then
    update public.coupon_leads
    set reserved_order_id = v_order.id,
        reserved_until = now() + interval '30 minutes'
    where id = v_coupon.id;
  end if;

  return v_order;
end;
$$;

create index if not exists orders_payment_review_required_idx
  on public.orders (created_at desc)
  where payment_review_required;

create index if not exists orders_fulfillment_review_required_idx
  on public.orders (created_at desc)
  where fulfillment_review_required;

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
  v_coupon public.coupon_leads%rowtype;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_other_reserved integer;
  v_inventory_shortfall boolean := false;
  v_checkout_expired boolean := false;
  v_coupon_reservation_lost boolean := false;
  v_payment_was_failed boolean := false;
  v_requires_refund boolean := false;
  v_inventory_review_open boolean := false;
  v_inventory_state_unsafe boolean := false;
  v_review_reason text;
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
  v_inventory_review_open := exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = v_order.id and r.status = 'open'
  );
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
        return jsonb_build_object(
          'order', to_jsonb(v_order),
          'newly_finalized', false,
          'requires_refund', v_order.payment_review_required,
          'payment_review_reason', v_order.payment_review_reason
        );
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
    return jsonb_build_object(
      'order', to_jsonb(v_order),
      'newly_finalized', false,
      'requires_refund', v_order.payment_review_required,
      'payment_review_reason', v_order.payment_review_reason
    );
  end if;

  -- A carrier can deliver an orphan/unpaid prepaid parcel before the capture
  -- webhook arrives. shipping_sync_status has already committed the physical
  -- units once. Settle only the financial side here; never deduct them again.
  if v_order.payment_status in ('pending', 'failed')
    and v_order.inventory_committed_at is not null
    and (
      v_order.shipment_delivered_at is not null
      or v_order.fulfillment_review_reason = 'shipment_while_ineligible'
    ) then
    if v_order.lead_coupon_code is not null then
      select * into v_coupon
      from public.coupon_leads
      where coupon_code = v_order.lead_coupon_code
      for update;
      v_coupon_reservation_lost :=
        not found
        or (v_coupon.is_used and v_coupon.used_order_id is distinct from v_order.id)
        or (
          not v_coupon.is_used
          and v_coupon.reserved_order_id is distinct from v_order.id
          and v_coupon.reserved_order_id is not null
          and v_coupon.reserved_until > now()
        );
    end if;
    v_requires_refund :=
      v_order.order_status = 'cancelled'
      or v_order.inventory_released_at is not null
      or v_order.payment_review_required
      or v_order.fulfillment_review_required
      or v_inventory_review_open
      or v_order.payment_status = 'failed'
      or v_coupon_reservation_lost;
    v_review_reason := case
      when v_coupon_reservation_lost then 'coupon_reservation_lost_after_capture'
      when v_order.payment_review_required
        then coalesce(v_order.payment_review_reason, 'late_capture_after_cancellation')
      when v_order.fulfillment_review_required or v_inventory_review_open
        then 'inventory_shortfall_after_capture'
      when v_order.inventory_released_at is not null then 'late_capture_after_cancellation'
      when v_order.payment_status = 'failed' then 'capture_after_failed_attempt'
      else 'late_capture_after_cancellation'
    end;

    update public.inventory_reservations
    set status = case when v_requires_refund then 'released' else 'consumed' end,
        consumed_at = case when v_requires_refund then consumed_at else coalesce(consumed_at, now()) end,
        released_at = case when v_requires_refund then coalesce(released_at, now()) else released_at end
    where order_id = v_order.id and status = 'reserved';

    if v_order.lead_coupon_code is not null then
      if v_requires_refund then
        update public.coupon_leads
        set reserved_order_id = null, reserved_until = null
        where coupon_code = v_order.lead_coupon_code
          and reserved_order_id = v_order.id
          and not is_used;
      elsif not v_coupon_reservation_lost then
        update public.coupon_leads
        set is_used = true,
            used_order_id = v_order.id,
            used_at = now(),
            reserved_order_id = null,
            reserved_until = null
        where coupon_code = v_order.lead_coupon_code
          and not is_used
          and (
            reserved_order_id is null
            or reserved_order_id = v_order.id
            or reserved_until <= now()
          );
      end if;
    end if;

    update public.orders
    set payment_status = 'paid',
        razorpay_payment_id = p_razorpay_payment_id,
        razorpay_signature = coalesce(p_razorpay_signature, razorpay_signature),
        payment_review_required = v_requires_refund,
        payment_review_reason = case when v_requires_refund then v_review_reason else null end,
        order_status = case
          when not v_requires_refund
            and not v_inventory_review_open
            and upper(regexp_replace(coalesce(shipment_status, ''), '[^A-Za-z0-9]+', '_', 'g'))
              in ('SHIPPED', 'PICKED_UP', 'PICKUP_COMPLETE', 'IN_TRANSIT', 'OUT_FOR_DELIVERY')
            then 'shipped'
          else order_status
        end,
        shipment_booking_state = case
          when not v_requires_refund
            and not v_inventory_review_open
            and fulfillment_review_reason = 'shipment_while_ineligible'
            then 'booked'
          else shipment_booking_state
        end,
        shipped_at = case
          when not v_requires_refund
            and upper(regexp_replace(coalesce(shipment_status, ''), '[^A-Za-z0-9]+', '_', 'g'))
              in ('SHIPPED', 'PICKED_UP', 'PICKUP_COMPLETE', 'IN_TRANSIT', 'OUT_FOR_DELIVERY')
            then coalesce(shipped_at, now())
          else shipped_at
        end,
        fulfillment_review_required = case
          when v_inventory_review_open then true
          when v_requires_refund and shipment_delivered_at is null then true
          when v_requires_refund
            and inventory_released_at is null then true
          when not v_requires_refund and inventory_reclaim_shortfall > 0 then true
          else false
        end,
        fulfillment_review_reason = case
          when v_inventory_review_open then 'legacy_inventory_ledger_mismatch'
          when v_requires_refund and shipment_delivered_at is null
            then 'shipment_while_ineligible'
          when v_requires_refund
            and inventory_released_at is null
            then 'delivered_after_cancellation'
          when not v_requires_refund and inventory_reclaim_shortfall > 0
            then 'delivered_after_cancellation'
          else null
        end,
        shipment_last_error = case
          when v_inventory_review_open
            then 'Payment captured, but the historical inventory ledger still requires reconciliation'
          when v_requires_refund and shipment_delivered_at is null
            then 'Payment captured for an ineligible live shipment; stop the carrier before verifying the full refund'
          when v_requires_refund
            then 'Payment captured after cancellation/physical return; full refund verification required'
          when inventory_reclaim_shortfall > 0
            then 'Delivered inventory could not be fully committed; reconcile the physical stock deficit'
          else null
        end
    where id = v_order.id
    returning * into v_order;

    update public.customers
    set order_count = order_count + 1,
        total_spent = total_spent + v_order.total_amount
    where email = v_order.customer_email;

    insert into public.payment_outbox (order_id, event_key, event_type, payload)
    values (
      v_order.id,
      case when v_requires_refund
        then 'payment.review:' || v_order.id
        else 'order.confirmed:' || v_order.id
      end,
      case when v_requires_refund then 'payment.captured' else 'order.confirmed' end,
      jsonb_build_object(
        'payment_method', 'prepaid',
        'requires_refund', v_requires_refund,
        'reason', case when v_requires_refund then v_review_reason else null end
      )
    )
    on conflict (event_key) do nothing;

    if p_webhook_event_id is not null then
      update public.razorpay_webhook_events
      set processed_at = now()
      where event_id = p_webhook_event_id;
    end if;

    return jsonb_build_object(
      'order', to_jsonb(v_order),
      'newly_finalized', true,
      'requires_refund', v_requires_refund,
      'payment_review_reason', case when v_requires_refund then v_review_reason else null end
    );
  end if;

  v_payment_was_failed := v_order.payment_status = 'failed';
  if v_order.payment_status not in ('pending', 'failed') then
    raise exception using errcode = '55000', message = 'ORDER_NOT_PENDING';
  end if;
  v_inventory_state_unsafe :=
    v_inventory_review_open
    or v_order.inventory_committed_at is not null
    or v_order.inventory_released_at is not null
    or v_order.fulfillment_review_required
    or v_order.payment_review_required;

  -- The lead coupon can expire and be claimed by another checkout while the
  -- Razorpay order is still payable. Lock it before any inventory mutation;
  -- a captured payment whose discount can no longer be honored must be
  -- recorded for refund review instead of rolling the entire transaction back.
  if not v_inventory_state_unsafe and v_order.lead_coupon_code is not null then
    select * into v_coupon
    from public.coupon_leads
    where coupon_code = v_order.lead_coupon_code
      and reserved_order_id = v_order.id
      and not is_used
    for update;
    if not found then
      v_coupon_reservation_lost := true;
    elsif v_coupon.reserved_until is null or v_coupon.reserved_until <= now() then
      v_checkout_expired := true;
    end if;
  end if;

  -- Lock and validate every product before changing any stock. This prevents a
  -- multi-item payment from observing half-applied inventory and lets a
  -- captured payment with an expired reservation enter refund review cleanly.
  if not v_inventory_state_unsafe then
    for v_item in
      select value
      from jsonb_array_elements(v_order.items)
      order by value->>'productId'
    loop
      v_product_id := (v_item->>'productId')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
      if v_quantity not between 1 and 10 then
        raise exception using errcode = '22023', message = 'INVALID_STORED_ITEM';
      end if;

      perform 1
      from public.inventory_reservations
      where order_id = v_order.id
        and product_id = v_product_id
        and quantity = v_quantity
        and status = 'reserved'
        and expires_at > now()
      for update;
      if not found then
        v_checkout_expired := true;
      end if;

      select * into v_product
      from public.products
      where id = v_product_id
      for update;

      if not found then
        v_inventory_shortfall := true;
        continue;
      end if;

      select coalesce(sum(quantity), 0)::integer into v_other_reserved
      from public.inventory_reservations
      where product_id = v_product_id
        and order_id <> v_order.id
        and status = 'reserved'
        and expires_at > now();

      if v_product.inventory_count - v_other_reserved < v_quantity then
        v_inventory_shortfall := true;
      end if;
    end loop;
  end if;

  if v_order.order_status = 'cancelled'
    or v_payment_was_failed
    or v_inventory_state_unsafe
    or v_checkout_expired
    or v_inventory_shortfall
    or v_coupon_reservation_lost then
    v_review_reason := case
      when v_order.order_status = 'cancelled' then 'late_capture_after_cancellation'
      when v_payment_was_failed then 'capture_after_failed_attempt'
      when v_order.payment_review_required then v_order.payment_review_reason
      when v_inventory_state_unsafe then 'inventory_shortfall_after_capture'
      when v_coupon_reservation_lost then 'coupon_reservation_lost_after_capture'
      when v_checkout_expired then 'checkout_expired_before_capture'
      else 'inventory_shortfall_after_capture'
    end;

    update public.inventory_reservations
    set status = 'released', released_at = coalesce(released_at, now())
    where order_id = v_order.id and status = 'reserved';

    update public.coupon_leads
    set reserved_order_id = null, reserved_until = null
    where reserved_order_id = v_order.id and not is_used;

    update public.orders
    set payment_status = 'paid',
        razorpay_payment_id = p_razorpay_payment_id,
        razorpay_signature = coalesce(p_razorpay_signature, razorpay_signature),
        order_status = 'cancelled',
        shipment_booking_state = case
          when awb_number is null
            and shipment_booking_state in (
              'booking', 'uncertain', 'cancelling', 'cancel_uncertain'
            ) then 'cancel_uncertain'
          when awb_number is null then 'cancelled'
          when shipment_booking_state = 'cancelled' and shipment_cancelled_at is not null
            then 'cancelled'
          else 'cancel_uncertain'
        end,
        shipment_cancelled_at = case
          when awb_number is null
            and shipment_booking_state not in (
              'booking', 'uncertain', 'cancelling', 'cancel_uncertain'
            ) then coalesce(shipment_cancelled_at, now())
          else shipment_cancelled_at
        end,
        shipment_last_error = case
          when awb_number is not null
            and not (
              shipment_booking_state = 'cancelled'
              and shipment_cancelled_at is not null
            ) then 'Captured payment is under refund review and carrier cancellation is unconfirmed'
          else shipment_last_error
        end,
        payment_review_required = true,
        payment_review_reason = v_review_reason,
        notes = left(
          concat_ws(
            E'\n',
            nullif(notes, ''),
            case v_review_reason
              when 'late_capture_after_cancellation'
                then 'Payment captured after cancellation; full Razorpay refund verification required.'
              when 'coupon_reservation_lost_after_capture'
                then 'Payment captured after its coupon reservation was lost; full Razorpay refund verification required.'
              when 'checkout_expired_before_capture'
                then 'Payment captured after the checkout reservation expired; full Razorpay refund verification required.'
              when 'capture_after_failed_attempt'
                then 'Payment captured after a prior attempt was marked failed; full Razorpay refund verification required.'
              else 'Payment captured without fulfillable inventory; full Razorpay refund verification required.'
            end
          ),
          2000
        )
    where id = v_order.id
    returning * into v_order;

    update public.customers
    set order_count = order_count + 1,
        total_spent = total_spent + v_order.total_amount
    where email = v_order.customer_email;

    insert into public.payment_outbox (order_id, event_key, event_type, payload)
    values (
      v_order.id,
      'payment.review:' || v_order.id,
      'payment.captured',
      jsonb_build_object(
        'payment_method', 'prepaid',
        'requires_refund', true,
        'reason', v_review_reason
      )
    )
    on conflict (event_key) do nothing;

    if p_webhook_event_id is not null then
      update public.razorpay_webhook_events
      set processed_at = now()
      where event_id = p_webhook_event_id;
    end if;

    return jsonb_build_object(
      'order', to_jsonb(v_order),
      'newly_finalized', true,
      'requires_refund', true,
      'payment_review_reason', v_review_reason
    );
  end if;

  for v_item in select value from jsonb_array_elements(v_order.items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    select * into v_product
    from public.products
    where id = v_product_id
    for update;

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
      inventory_committed_at = now(),
      payment_review_required = false,
      payment_review_reason = null
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
      and reserved_until > now()
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

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'newly_finalized', true,
    'requires_refund', false,
    'payment_review_reason', null
  );
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
  v_reserved integer;
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

  -- reserve_prepaid_order takes the same product lock before creating a
  -- reservation, so the count cannot change underneath this adjustment.
  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND';
  end if;

  select coalesce(sum(quantity), 0)::integer into v_reserved
  from public.inventory_reservations
  where product_id = p_product_id
    and status = 'reserved'
    and expires_at > now();

  v_new_stock := v_product.inventory_count + p_quantity_change;
  if v_new_stock < 0 then
    raise exception using errcode = '22003', message = 'INSUFFICIENT_STOCK';
  end if;
  if v_new_stock < v_reserved then
    raise exception using errcode = '55000', message = 'ACTIVE_RESERVATIONS_EXCEED_NEW_STOCK';
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
    'reserved_quantity', v_reserved,
    'quantity_change', p_quantity_change,
    'log', to_jsonb(v_log)
  );
end
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

  if v_order.order_status not in ('confirmed', 'processing')
    or v_order.payment_status in ('failed', 'refunded')
    or v_order.payment_review_required
    or v_order.fulfillment_review_required
    or (v_order.payment_method = 'prepaid' and v_order.payment_status <> 'paid') then
    return jsonb_build_object('status', 'ineligible', 'order', to_jsonb(v_order));
  end if;

  if v_order.shipment_booking_state in ('cancelling', 'cancel_uncertain', 'cancelled') then
    return jsonb_build_object('status', 'ineligible', 'order', to_jsonb(v_order));
  end if;

  if v_order.awb_number is not null then
    update public.orders
    set shipment_booking_state = 'booked', shipment_last_error = null
    where id = p_order_id
    returning * into v_order;
    return jsonb_build_object('status', 'already_booked', 'order', to_jsonb(v_order));
  end if;

  if v_order.shipment_booking_state = 'booking' then
    if v_order.shipment_booking_claimed_at > now() - interval '15 minutes' then
      return jsonb_build_object('status', 'in_progress', 'order', to_jsonb(v_order));
    end if;

    update public.orders
    set shipment_booking_state = 'uncertain',
        shipment_booking_token = p_claim_token,
        shipment_booking_claimed_at = now(),
        shipment_booking_attempts = shipment_booking_attempts + 1,
        shipment_last_error = 'Previous shipment booking did not complete; reconciliation required'
    where id = p_order_id
    returning * into v_order;
    return jsonb_build_object('status', 'reconcile_only', 'order', to_jsonb(v_order));
  end if;

  if v_order.shipment_booking_state = 'uncertain' then
    update public.orders
    set shipment_booking_token = p_claim_token,
        shipment_booking_claimed_at = now(),
        shipment_booking_attempts = shipment_booking_attempts + 1
    where id = p_order_id
    returning * into v_order;
    return jsonb_build_object('status', 'reconcile_only', 'order', to_jsonb(v_order));
  end if;

  update public.orders
  set shipment_booking_state = 'booking',
      shipment_booking_token = p_claim_token,
      shipment_booking_claimed_at = now(),
      shipment_booking_attempts = shipment_booking_attempts + 1,
      shipment_last_error = null
  where id = p_order_id
  returning * into v_order;

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
  v_became_ineligible boolean;
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

  -- Payment/refund/order state can change while the external Proship request is
  -- in flight. Always persist the returned AWB so it cannot become an orphan,
  -- but flag it for immediate cancellation instead of accepting a live parcel
  -- for an order that is no longer fulfillable.
  v_became_ineligible :=
    v_order.order_status not in ('confirmed', 'processing')
    or v_order.payment_status in ('failed', 'refunded')
    or v_order.payment_review_required
    or v_order.fulfillment_review_required
    or (v_order.payment_method = 'prepaid' and v_order.payment_status <> 'paid');

  update public.orders
  set proship_order_id = nullif(trim(p_proship_order_id), ''),
      awb_number = trim(p_awb_number),
      courier_name = nullif(trim(p_courier_name), ''),
      shipping_label_url = nullif(trim(p_label_url), ''),
      tracking_url = nullif(trim(p_tracking_url), ''),
      shipment_status = nullif(trim(p_shipment_status), ''),
      shipment_booking_state = case
        when v_became_ineligible then 'cancel_uncertain'
        else 'booked'
      end,
      shipment_booking_token = null,
      shipment_booking_claimed_at = null,
      shipment_last_error = case
        when v_became_ineligible
          then 'Shipment was created after the order became ineligible; carrier cancellation required'
        else null
      end,
      shipment_synced_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

-- If a carrier proves physical dispatch before the order ever committed stock,
-- immediately consume the physical units once. This keeps sellable inventory
-- conservative while payment, cancellation, or return reconciliation is pending.
create or replace function public.shipping_commit_untracked_delivery_once(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_deduct integer;
  v_missing integer;
  v_shortfall integer := 0;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found
    or v_order.inventory_committed_at is not null
    or v_order.inventory_released_at is not null
    or exists (
      select 1
      from public.inventory_reconciliation_reviews as r
      where r.order_id = p_order_id and r.status = 'open'
    ) then
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
    select * into v_product
    from public.products
    where id = v_item.product_id::uuid
    for update;

    if not found then
      raise exception 'inventory_product_missing';
    end if;

    v_deduct := least(v_product.inventory_count, v_item.quantity);
    if v_deduct > 0 then
      update public.products
      set inventory_count = inventory_count - v_deduct
      where id = v_product.id;

      insert into public.inventory_log (
        product_id, product_name, change_type, quantity_change,
        previous_stock, new_stock, order_id, notes
      ) values (
        v_product.id, v_product.name, 'sale', -v_deduct,
        v_product.inventory_count, v_product.inventory_count - v_deduct,
        p_order_id, 'Inventory committed after an ineligible carrier shipment was dispatched'
      );
    end if;
    v_missing := v_item.quantity - v_deduct;
    if v_missing > 0 then
      insert into public.inventory_reclaim_shortfalls (
        order_id, product_id, quantity, status, resolution, resolved_at
      ) values (
        p_order_id, v_product.id, v_missing, 'open', null, null
      )
      on conflict (order_id, product_id) do update
      set quantity = excluded.quantity,
          status = 'open',
          resolution = null,
          resolved_at = null;
    end if;
    v_shortfall := v_shortfall + v_missing;
  end loop;

  update public.inventory_reservations
  set status = 'consumed', consumed_at = coalesce(consumed_at, now())
  where order_id = p_order_id and status = 'reserved';

  update public.orders
  set inventory_committed_at = now(),
      inventory_reclaim_shortfall = v_shortfall,
      fulfillment_review_required = true,
      fulfillment_review_reason = case
        when payment_status = 'refunded' then 'return_inventory_pending'
        when shipment_delivered_at is null then 'shipment_while_ineligible'
        else 'delivered_after_cancellation'
      end
  where id = p_order_id;

  return true;
end;
$$;

create or replace function public.shipping_reclaim_released_inventory_once(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_deduct integer;
  v_missing integer;
  v_shortfall integer := 0;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found
    or v_order.inventory_committed_at is null
    or v_order.inventory_released_at is null
    or v_order.inventory_reclaimed_at is not null
    or exists (
      select 1
      from public.inventory_reconciliation_reviews as r
      where r.order_id = p_order_id and r.status = 'open'
    ) then
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
    select * into v_product
    from public.products
    where id = v_item.product_id::uuid
    for update;

    if not found then
      raise exception 'inventory_product_missing';
    end if;

    v_deduct := least(v_product.inventory_count, v_item.quantity);
    if v_deduct > 0 then
      update public.products
      set inventory_count = inventory_count - v_deduct
      where id = v_product.id;

      insert into public.inventory_log (
        product_id, product_name, change_type, quantity_change,
        previous_stock, new_stock, order_id, notes
      ) values (
        v_product.id, v_product.name, 'sale', -v_deduct,
        v_product.inventory_count, v_product.inventory_count - v_deduct,
        p_order_id, 'Inventory re-applied after an ineligible carrier shipment was dispatched'
      );
    end if;
    v_missing := v_item.quantity - v_deduct;
    if v_missing > 0 then
      insert into public.inventory_reclaim_shortfalls (
        order_id, product_id, quantity, status, resolution, resolved_at
      ) values (
        p_order_id, v_product.id, v_missing, 'open', null, null
      )
      on conflict (order_id, product_id) do update
      set quantity = excluded.quantity,
          status = 'open',
          resolution = null,
          resolved_at = null;
    end if;
    v_shortfall := v_shortfall + v_missing;
  end loop;

  update public.orders
  set inventory_reclaimed_at = now(),
      inventory_released_at = null,
      inventory_reclaim_shortfall = v_shortfall,
      fulfillment_review_required = true,
      fulfillment_review_reason = case
        when shipment_delivered_at is null then 'shipment_while_ineligible'
        when payment_status = 'refunded' then 'return_inventory_pending'
        else 'delivered_after_cancellation'
      end
  where id = p_order_id;

  return true;
end;
$$;

-- Repair only historical delivery incidents whose stock release and carrier
-- delivery are both proven. The helper refuses ambiguous ledger reviews and is
-- idempotent through inventory_reclaimed_at.
do $$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select o.id
    from public.orders as o
    where o.inventory_committed_at is null
      and o.fulfillment_review_required
      and (
        (
          o.shipment_delivered_at is not null
          and o.fulfillment_review_reason in (
            'delivered_after_cancellation', 'return_inventory_pending'
          )
        )
        or (
          o.shipment_delivered_at is null
          and o.fulfillment_review_reason = 'shipment_while_ineligible'
        )
      )
      and not exists (
        select 1
        from public.inventory_reconciliation_reviews as r
        where r.order_id = o.id and r.status = 'open'
      )
      and jsonb_typeof(o.items) = 'array'
      and jsonb_array_length(o.items) > 0
      and not exists (
        select 1
        from jsonb_array_elements(o.items) as item
        left join public.products as p
          on p.id::text = coalesce(item->>'productId', item->>'product_id')
        where p.id is null
          or coalesce(item->>'quantity', '') !~ '^[1-9][0-9]*$'
          or case
            when coalesce(item->>'quantity', '') ~ '^[1-9][0-9]*$'
              then (item->>'quantity')::numeric > 100
            else false
          end
      )
  loop
    perform public.shipping_commit_untracked_delivery_once(v_order_id);
  end loop;

  for v_order_id in
    select o.id
    from public.orders as o
    where o.inventory_released_at is not null
      and o.inventory_reclaimed_at is null
      and (
        o.shipment_delivered_at is not null
        or o.fulfillment_review_reason = 'shipment_while_ineligible'
      )
      and not exists (
        select 1
        from public.inventory_reconciliation_reviews as r
        where r.order_id = o.id and r.status = 'open'
      )
      and jsonb_typeof(o.items) = 'array'
      and jsonb_array_length(o.items) > 0
      and not exists (
        select 1
        from jsonb_array_elements(o.items) as item
        left join public.products as p
          on p.id::text = coalesce(item->>'productId', item->>'product_id')
        where p.id is null
          or coalesce(item->>'quantity', '') !~ '^[1-9][0-9]*$'
          or case
            when coalesce(item->>'quantity', '') ~ '^[1-9][0-9]*$'
              then (item->>'quantity')::numeric > 100
            else false
          end
      )
  loop
    perform public.shipping_reclaim_released_inventory_once(v_order_id);
  end loop;
end
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
  if v_order.order_status = 'cancelled'
    and (
      (
        v_order.awb_number is null
        and v_order.shipment_booking_state not in (
          'booking', 'uncertain', 'cancelling', 'cancel_uncertain'
        )
      )
      or (
        v_order.shipment_booking_state = 'cancelled'
        and v_order.shipment_cancelled_at is not null
      )
    ) then
    return jsonb_build_object('status', 'already_cancelled', 'order', to_jsonb(v_order));
  end if;
  if v_order.order_status = 'delivered' or v_order.shipment_delivered_at is not null then
    return jsonb_build_object('status', 'ineligible', 'order', to_jsonb(v_order));
  end if;
  if v_order.fulfillment_review_required
    and v_order.fulfillment_review_reason not in (
      'return_inventory_pending',
      'shipment_while_ineligible',
      'legacy_inventory_ledger_mismatch',
      'delivered_after_cancellation'
    ) then
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
  where id = p_order_id
  returning * into v_order;

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
  v_return_inventory_pending boolean := false;
  v_inventory_review_open boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.order_status = 'delivered' then raise exception 'delivered_order_cannot_be_cancelled'; end if;
  if v_order.payment_status = 'paid' then raise exception 'paid_order_refund_required'; end if;
  if v_order.shipment_cancel_token is distinct from p_claim_token then
    raise exception 'shipment_cancellation_claim_lost';
  end if;

  v_inventory_review_open := exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = p_order_id and r.status = 'open'
  );
  v_return_inventory_pending :=
    not v_inventory_review_open
    and
    v_order.inventory_committed_at is not null
    and v_order.inventory_released_at is null
    and (v_order.order_status = 'shipped' or v_order.awb_number is not null);

  if not v_return_inventory_pending then
    perform public.shipping_release_inventory_once(p_order_id);
  end if;

  update public.inventory_reservations
  set status = 'released', released_at = coalesce(released_at, now())
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
      shipment_last_error = case
        when v_inventory_review_open
          then 'Carrier cancellation accepted; historical inventory ledger reconciliation is still required'
        when v_return_inventory_pending
          then 'Carrier cancellation accepted; confirm the physical return before restocking'
        else null
      end,
      fulfillment_review_required = case
        when v_inventory_review_open then true
        when v_return_inventory_pending then true
        when v_order.fulfillment_review_reason = 'shipment_while_ineligible' then false
        else fulfillment_review_required
      end,
      fulfillment_review_reason = case
        when v_inventory_review_open then 'legacy_inventory_ledger_mismatch'
        when v_return_inventory_pending then 'return_inventory_pending'
        when v_order.fulfillment_review_reason = 'shipment_while_ineligible' then null
        else fulfillment_review_reason
      end,
      notes = case when p_notes is null then notes else left(p_notes, 2000) end
  where id = p_order_id
  returning * into v_order;

  return v_order;
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
  v_paid_provider_cancellation boolean := false;
  v_delivered_after_cancellation boolean := false;
  v_provider_cancellation_confirmed boolean := false;
  v_unconfirmed_local_cancellation boolean := false;
  v_return_inventory_pending boolean := false;
  v_inventory_review_open boolean := false;
  v_delivery_already_recorded boolean := false;
  v_delivery_after_cancellation_evidence boolean := false;
  v_shipment_ineligible boolean := false;
  v_physical_dispatch_evidence boolean := false;
  v_was_shipped boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  v_was_shipped := v_order.order_status = 'shipped';
  v_inventory_review_open := exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = p_order_id and r.status = 'open'
  );
  if v_order.order_number <> p_reference then raise exception 'shipment_reference_mismatch'; end if;
  if v_order.awb_number is not null and v_order.awb_number <> p_awb_number then
    raise exception 'shipment_awb_conflict';
  end if;
  if v_order.shipment_booking_state = 'booking'
    and v_order.shipment_booking_claimed_at > now() - interval '15 minutes' then
    raise exception 'shipment_booking_in_progress';
  end if;

  v_shipment_ineligible :=
    p_order_status is distinct from 'delivered'
    and p_order_status is distinct from 'cancelled'
    and (
      v_order.order_status = 'cancelled'
      or v_order.payment_status in ('failed', 'refunded')
      or v_order.payment_review_required
      or v_order.fulfillment_review_required
      or (v_order.payment_method = 'prepaid' and v_order.payment_status <> 'paid')
    );
  v_physical_dispatch_evidence :=
    upper(regexp_replace(coalesce(p_shipment_status, ''), '[^A-Za-z0-9]+', '_', 'g'))
      in ('SHIPPED', 'PICKED_UP', 'PICKUP_COMPLETE', 'IN_TRANSIT', 'OUT_FOR_DELIVERY');

  -- A released timestamp without a proven commit is not a basis for another
  -- automatic stock mutation. Persist a manual reconciliation incident first.
  if v_shipment_ineligible
    and v_physical_dispatch_evidence
    and not v_inventory_review_open
    and v_order.inventory_committed_at is null
    and v_order.inventory_released_at is not null then
    insert into public.inventory_reconciliation_reviews (
      order_id, product_id, review_type, expected_quantity,
      logged_sale_quantity, status, notes
    )
    select
      v_order.id,
      p.id,
      'legacy_inventory_timestamp_conflict',
      sum((item->>'quantity')::integer)::integer,
      0,
      'open',
      'A live carrier shipment was found after inventory had been marked released without a proven commit.'
    from jsonb_array_elements(
      case when jsonb_typeof(v_order.items) = 'array' then v_order.items else '[]'::jsonb end
    ) as item
    join public.products as p
      on p.id::text = coalesce(item->>'productId', item->>'product_id')
    where coalesce(item->>'quantity', '') ~ '^[1-9][0-9]*$'
      and (item->>'quantity')::numeric <= 100
    group by p.id
    on conflict (order_id, product_id, review_type) do update
    set expected_quantity = excluded.expected_quantity,
        status = 'open',
        resolved_at = null,
        notes = excluded.notes;

    v_inventory_review_open := true;
  end if;

  if v_shipment_ineligible
    and v_physical_dispatch_evidence
    and not v_inventory_review_open then
    if v_order.inventory_committed_at is null then
      perform public.shipping_commit_untracked_delivery_once(p_order_id);
    elsif v_order.inventory_released_at is not null
      and v_order.inventory_reclaimed_at is null then
      perform public.shipping_reclaim_released_inventory_once(p_order_id);
    end if;
  end if;

  if p_order_status = 'shipped' and v_order.order_status in ('confirmed', 'processing') then
    if not v_shipment_ineligible then
      v_order.order_status := 'shipped';
    end if;
  elsif p_order_status = 'delivered' then
    v_delivery_already_recorded := v_order.shipment_delivered_at is not null;
    v_delivery_after_cancellation_evidence :=
      v_order.order_status = 'cancelled'
      or v_order.shipment_booking_state = 'cancelled'
      or v_order.shipment_booking_state = 'cancel_uncertain'
      or v_order.shipment_cancelled_at is not null
      or v_order.fulfillment_review_reason = 'delivered_after_cancellation'
      or v_order.fulfillment_review_reason = 'shipment_while_ineligible'
      or v_order.payment_review_required
      or (
        v_order.payment_method = 'prepaid'
        and v_order.payment_status <> 'paid'
      );

    if v_delivery_after_cancellation_evidence and not v_delivery_already_recorded then
      v_delivered_after_cancellation := true;
      if not v_inventory_review_open then
        if v_order.inventory_committed_at is null then
          perform public.shipping_commit_untracked_delivery_once(p_order_id);
        elsif v_order.inventory_released_at is not null then
          perform public.shipping_reclaim_released_inventory_once(p_order_id);
        end if;
      end if;
      if v_order.order_status <> 'cancelled' then
        v_order.order_status := 'delivered';
      end if;
      if v_order.payment_status = 'refunded' then
        v_return_inventory_pending := true;
      end if;
    elsif not v_delivery_after_cancellation_evidence then
      v_order.order_status := 'delivered';
    end if;
  elsif p_order_status = 'cancelled' then
    v_provider_cancellation_confirmed := true;
    v_return_inventory_pending :=
      not v_inventory_review_open
      and v_order.inventory_committed_at is not null
      and v_order.inventory_released_at is null
      and (
        v_was_shipped
        or v_order.awb_number is not null
        or nullif(trim(p_awb_number), '') is not null
      );
    if v_order.order_status not in ('delivered', 'cancelled') then
      if v_order.payment_status = 'paid' then
        -- Persist the provider fact, but do not cancel the paid local order or
        -- restore stock until its prepaid/COD refund is recorded.
        v_paid_provider_cancellation := true;
      else
        -- Once a parcel has an AWB (and especially after dispatch), carrier
        -- cancellation does not prove the physical stock is back in hand.
        v_order.order_status := 'cancelled';
        if not v_return_inventory_pending then
          perform public.shipping_release_inventory_once(p_order_id);
        end if;
      end if;
    end if;
  elsif p_order_status is not null and p_order_status not in ('shipped', 'delivered', 'cancelled') then
    raise exception 'invalid_synchronized_order_status';
  end if;

  v_unconfirmed_local_cancellation :=
    v_order.order_status = 'cancelled'
    and coalesce(v_order.awb_number, nullif(trim(p_awb_number), '')) is not null
    and v_order.shipment_cancelled_at is null
    and not v_provider_cancellation_confirmed;

  update public.orders
  set proship_order_id = coalesce(nullif(trim(p_proship_order_id), ''), proship_order_id),
      awb_number = coalesce(nullif(trim(p_awb_number), ''), awb_number),
      courier_name = coalesce(nullif(trim(p_courier_name), ''), courier_name),
      shipping_label_url = coalesce(nullif(trim(p_label_url), ''), shipping_label_url),
      tracking_url = coalesce(nullif(trim(p_tracking_url), ''), tracking_url),
      shipment_status = coalesce(nullif(trim(p_shipment_status), ''), shipment_status),
      shipment_booking_state = case
        when v_delivered_after_cancellation then 'booked'
        when p_order_status = 'delivered'
          and v_delivery_after_cancellation_evidence
          and v_delivery_already_recorded then shipment_booking_state
        when v_provider_cancellation_confirmed then 'cancelled'
        when v_shipment_ineligible then 'cancel_uncertain'
        when v_unconfirmed_local_cancellation then 'cancel_uncertain'
        when v_order.order_status = 'cancelled'
          and v_order.shipment_cancelled_at is not null then 'cancelled'
        when v_order.order_status = 'cancelled' and coalesce(
          v_order.awb_number,
          nullif(trim(p_awb_number), '')
        ) is null then 'cancelled'
        else 'booked'
      end,
      order_status = v_order.order_status,
      shipped_at = case
        when v_delivered_after_cancellation
          or p_order_status = 'shipped'
          or v_order.order_status in ('shipped', 'delivered') then coalesce(shipped_at, now())
        else shipped_at
      end,
      shipment_delivered_at = case
        when p_order_status = 'delivered' then coalesce(shipment_delivered_at, now())
        else shipment_delivered_at
      end,
      shipment_cancelled_at = case
        when v_provider_cancellation_confirmed
          or (
            v_order.order_status = 'cancelled'
            and coalesce(v_order.awb_number, nullif(trim(p_awb_number), '')) is null
          ) then coalesce(shipment_cancelled_at, now())
        else shipment_cancelled_at
      end,
      shipment_booking_token = null,
      shipment_booking_claimed_at = null,
      shipment_cancel_token = null,
      shipment_cancel_claimed_at = null,
      shipment_last_error = case
        when v_inventory_review_open
          then 'Historical inventory ledger requires reconciliation before fulfillment or restocking'
        when v_shipment_ineligible
          then 'A live carrier shipment exists for an ineligible order; cancel or reconcile it before fulfillment'
        when v_delivered_after_cancellation
          then 'Carrier delivered after local cancellation; payment and inventory reconciliation required'
        when v_return_inventory_pending and v_paid_provider_cancellation
          then 'Carrier cancellation is confirmed; record the refund and confirm the physical return before restocking'
        when v_return_inventory_pending
          then 'Carrier cancellation is confirmed; confirm the physical return before restocking'
        when v_paid_provider_cancellation
          then 'Carrier reports cancellation; record the refund before cancelling the local paid order'
        when v_unconfirmed_local_cancellation
          then 'Local cancellation is not confirmed by carrier'
        when v_provider_cancellation_confirmed
          and fulfillment_review_reason = 'shipment_while_ineligible' then null
        when fulfillment_review_required then shipment_last_error
        else null
      end,
      fulfillment_review_required = case
        when v_inventory_review_open then true
        when v_shipment_ineligible then true
        when v_delivered_after_cancellation then true
        when v_return_inventory_pending then true
        when v_provider_cancellation_confirmed
          and fulfillment_review_reason = 'shipment_while_ineligible' then false
        else fulfillment_review_required
      end,
      fulfillment_review_reason = case
        when v_inventory_review_open then 'legacy_inventory_ledger_mismatch'
        when v_shipment_ineligible then 'shipment_while_ineligible'
        when v_delivered_after_cancellation then 'delivered_after_cancellation'
        when v_return_inventory_pending then 'return_inventory_pending'
        when v_provider_cancellation_confirmed
          and fulfillment_review_reason = 'shipment_while_ineligible' then null
        else fulfillment_review_reason
      end,
      shipment_synced_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.shipping_claim_refund_hold(
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
  if v_order.payment_status <> 'paid' then
    return jsonb_build_object('status', 'ineligible', 'order', to_jsonb(v_order));
  end if;
  if v_order.fulfillment_review_required
    and v_order.fulfillment_review_reason not in (
      'return_inventory_pending',
      'shipment_while_ineligible',
      'legacy_inventory_ledger_mismatch',
      'delivered_after_cancellation'
    ) then
    return jsonb_build_object('status', 'ineligible', 'order', to_jsonb(v_order));
  end if;
  if v_order.order_status = 'delivered' or v_order.shipment_delivered_at is not null then
    return jsonb_build_object('status', 'ineligible', 'order', to_jsonb(v_order));
  end if;
  if (
    v_order.awb_number is null
    and v_order.order_status = 'cancelled'
  ) or (
    v_order.shipment_booking_state = 'cancelled'
    and (
      v_order.awb_number is null
      or v_order.shipment_cancelled_at is not null
    )
  ) then
    return jsonb_build_object('status', 'already_stopped', 'order', to_jsonb(v_order));
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
  where id = p_order_id
  returning * into v_order;

  return jsonb_build_object('status', 'claimed', 'order', to_jsonb(v_order));
end;
$$;

create or replace function public.shipping_complete_refund_hold(
  p_order_id uuid,
  p_claim_token uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_return_inventory_pending boolean := false;
  v_inventory_review_open boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.order_status = 'delivered' then raise exception 'delivered_order_cannot_be_stopped'; end if;
  if v_order.payment_status <> 'paid' then raise exception 'paid_order_required'; end if;
  if v_order.shipment_cancel_token is distinct from p_claim_token then
    raise exception 'shipment_refund_hold_claim_lost';
  end if;

  v_inventory_review_open := exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = p_order_id and r.status = 'open'
  );
  v_return_inventory_pending :=
    not v_inventory_review_open
    and v_order.inventory_committed_at is not null
    and v_order.inventory_released_at is null
    and (v_order.order_status = 'shipped' or v_order.awb_number is not null);

  update public.orders
  set shipment_booking_state = 'cancelled',
      shipment_status = case when awb_number is not null then 'CANCELLED' else shipment_status end,
      shipment_cancelled_at = now(),
      shipment_cancel_token = null,
      shipment_cancel_claimed_at = null,
      shipment_booking_token = null,
      shipment_booking_claimed_at = null,
      shipment_last_error = case
        when v_inventory_review_open
          then 'Carrier/booking stopped; refund verification and historical inventory reconciliation are required'
        when v_return_inventory_pending
          then 'Carrier/booking stopped; verify the refund and confirm the physical return before restocking'
        else 'Carrier/booking stopped; refund verification required before local cancellation'
      end,
      fulfillment_review_required = case
        when v_inventory_review_open then true
        when v_return_inventory_pending then true
        when v_order.fulfillment_review_reason = 'shipment_while_ineligible' then false
        else fulfillment_review_required
      end,
      fulfillment_review_reason = case
        when v_inventory_review_open then 'legacy_inventory_ledger_mismatch'
        when v_return_inventory_pending then 'return_inventory_pending'
        when v_order.fulfillment_review_reason = 'shipment_while_ineligible' then null
        else fulfillment_review_reason
      end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.shipping_finalize_refunded_cancellation(
  p_order_id uuid,
  p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_return_inventory_pending boolean := false;
  v_inventory_review_open boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.order_status = 'delivered' then raise exception 'delivered_order_cannot_be_cancelled'; end if;
  if v_order.payment_status <> 'refunded' then raise exception 'refunded_order_required'; end if;
  if v_order.shipment_booking_state <> 'cancelled' then
    raise exception 'shipment_must_be_stopped_before_refund_finalization';
  end if;

  v_inventory_review_open := exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = p_order_id and r.status = 'open'
  );
  v_return_inventory_pending :=
    not v_inventory_review_open
    and
    v_order.inventory_committed_at is not null
    and v_order.inventory_released_at is null
    and (v_order.order_status = 'shipped' or v_order.awb_number is not null);

  if not v_return_inventory_pending then
    perform public.shipping_release_inventory_once(p_order_id);
  end if;

  update public.inventory_reservations
  set status = 'released', released_at = coalesce(released_at, now())
  where order_id = p_order_id and status = 'reserved';

  update public.coupon_leads
  set reserved_order_id = null, reserved_until = null
  where reserved_order_id = p_order_id and not is_used;

  update public.orders
  set order_status = 'cancelled',
      shipment_booking_state = 'cancelled',
      shipment_cancelled_at = coalesce(shipment_cancelled_at, now()),
      shipment_cancel_token = null,
      shipment_cancel_claimed_at = null,
      shipment_booking_token = null,
      shipment_booking_claimed_at = null,
      shipment_last_error = case
        when v_inventory_review_open
          then 'Refund recorded; historical inventory ledger reconciliation is still required'
        when v_return_inventory_pending
          then 'Refund recorded; confirm the physical return before restocking'
        else null
      end,
      fulfillment_review_required = case
        when v_inventory_review_open then true
        when v_return_inventory_pending then true
        when v_order.fulfillment_review_reason = 'shipment_while_ineligible' then false
        else fulfillment_review_required
      end,
      fulfillment_review_reason = case
        when v_inventory_review_open then 'legacy_inventory_ledger_mismatch'
        when v_return_inventory_pending then 'return_inventory_pending'
        when v_order.fulfillment_review_reason = 'shipment_while_ineligible' then null
        else fulfillment_review_reason
      end,
      notes = case when p_notes is null then notes else left(p_notes, 2000) end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.admin_confirm_return_inventory(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_released boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if (v_order.order_status <> 'cancelled'
    and v_order.order_status <> 'delivered')
    or not v_order.fulfillment_review_required
    or (
      v_order.fulfillment_review_reason <> 'return_inventory_pending'
      and not (
        v_order.fulfillment_review_reason = 'delivered_after_cancellation'
        and v_order.payment_status <> 'paid'
      )
    ) then
    raise exception 'return_inventory_confirmation_not_required';
  end if;
  if exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = p_order_id and r.status = 'open'
  ) then
    raise exception 'inventory_reconciliation_required';
  end if;
  if v_order.order_status = 'cancelled'
    and v_order.shipment_delivered_at is null
    and (
      v_order.shipment_booking_state <> 'cancelled'
      or (v_order.awb_number is not null and v_order.shipment_cancelled_at is null)
    ) then
    raise exception 'carrier_cancellation_not_confirmed';
  end if;

  -- If fulfillment escaped before inventory was ever committed, the database
  -- already counts these units as available. A verified physical return closes
  -- the incident without adding stock a second time.
  if v_order.inventory_committed_at is null then
    update public.orders
    set fulfillment_review_required = false,
        fulfillment_review_reason = null,
        shipment_last_error = null
    where id = p_order_id
    returning * into v_order;
    return v_order;
  end if;

  v_released := public.shipping_release_inventory_once(p_order_id);
  if not v_released and v_order.inventory_released_at is null then
    raise exception 'inventory_return_could_not_be_recorded';
  end if;

  update public.orders
  set fulfillment_review_required = false,
      fulfillment_review_reason = null,
      shipment_last_error = null
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.admin_confirm_no_legacy_shipment(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_inventory_review_open boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  v_inventory_review_open := exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = p_order_id and r.status = 'open'
  );
  if v_order.order_status <> 'cancelled'
    or v_order.awb_number is not null
    or v_order.shipment_booking_state not in ('uncertain', 'cancel_uncertain', 'failed') then
    raise exception 'legacy_no_shipment_confirmation_not_allowed';
  end if;
  if v_order.shipment_booking_token is not null
    and v_order.shipment_booking_claimed_at > now() - interval '15 minutes' then
    raise exception 'shipment_reconciliation_in_progress';
  end if;

  update public.orders
  set shipment_booking_state = 'cancelled',
      shipment_cancelled_at = coalesce(shipment_cancelled_at, now()),
      shipment_booking_token = null,
      shipment_booking_claimed_at = null,
      shipment_cancel_token = null,
      shipment_cancel_claimed_at = null,
      fulfillment_review_required = case
        when v_inventory_review_open then true
        when inventory_committed_at is not null and inventory_released_at is null then true
        else fulfillment_review_required
      end,
      fulfillment_review_reason = case
        when v_inventory_review_open then 'legacy_inventory_ledger_mismatch'
        when inventory_committed_at is not null and inventory_released_at is null
          then 'return_inventory_pending'
        else fulfillment_review_reason
      end,
      shipment_last_error = case
        when v_inventory_review_open
          then 'No carrier shipment exists, but the historical inventory ledger must be reconciled before restocking'
        when inventory_committed_at is not null and inventory_released_at is null
          then 'No carrier shipment confirmed; verify physical stock before restocking'
        else null
      end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.admin_resolve_inventory_reconciliation(
  p_order_id uuid,
  p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_has_open_review boolean;
  v_has_sale_ledger_mismatch boolean;
  v_has_delivery_shortfall boolean;
  v_had_timestamp_conflict boolean;
  v_items_valid boolean;
  v_next_reason text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  v_items_valid := case
    when jsonb_typeof(v_order.items) = 'array' then
      jsonb_array_length(v_order.items) > 0
      and not exists (
        select 1
        from jsonb_array_elements(v_order.items) as item
        left join public.products as p
          on p.id::text = coalesce(item->>'productId', item->>'product_id')
        where p.id is null
           or coalesce(item->>'productId', item->>'product_id', '')
                !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           or coalesce(item->>'quantity', '') !~ '^[1-9][0-9]*$'
           or case
                when coalesce(item->>'quantity', '') ~ '^[1-9][0-9]*$'
                  then (item->>'quantity')::numeric > 100
                else false
              end
      )
    else false
  end;
  if not v_items_valid then
    raise exception 'inventory_order_items_invalid';
  end if;

  select exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = p_order_id and r.status = 'open'
  ) into v_has_open_review;
  select exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = p_order_id
      and r.status = 'open'
      and r.review_type in (
        'legacy_duplicate_sale_ledger',
        'legacy_sale_ledger_mismatch'
      )
  ) into v_has_sale_ledger_mismatch;
  v_has_delivery_shortfall := v_order.inventory_reclaim_shortfall > 0;
  v_had_timestamp_conflict :=
    v_order.inventory_committed_at is null
    and v_order.inventory_released_at is not null;
  if not v_has_open_review
    and not v_has_delivery_shortfall
    and v_order.fulfillment_review_reason <> 'legacy_inventory_ledger_mismatch' then
    raise exception 'inventory_reconciliation_not_required';
  end if;

  update public.inventory_reconciliation_reviews
  set status = 'resolved',
      resolved_at = now(),
      notes = left(concat_ws(
        E'\n', nullif(notes, ''), nullif(trim(p_notes), ''),
        'Resolved by an administrator after ledger and physical-stock reconciliation.'
      ), 2000)
  where order_id = p_order_id and status = 'open';

  if v_has_delivery_shortfall then
    update public.inventory_reclaim_shortfalls
    set status = 'resolved',
        resolution = 'manual_reconciliation',
        resolved_at = now()
    where order_id = p_order_id and status = 'open';
  end if;

  if v_has_delivery_shortfall then
    v_order.inventory_reclaim_shortfall := 0;
  end if;

  -- Resolving the contradictory legacy timestamps establishes a reviewed
  -- commit→release baseline. A later live/delivered carrier fact can then
  -- safely reclaim that released stock once instead of reopening the incident.
  if v_had_timestamp_conflict then
    update public.orders
    set inventory_committed_at = inventory_released_at
    where id = p_order_id
    returning * into v_order;
  elsif v_has_sale_ledger_mismatch and v_order.inventory_committed_at is null then
    -- The administrator's ledger/physical count establishes the reviewed
    -- baseline. Mark it committed without manufacturing another stock delta.
    update public.orders
    set inventory_committed_at = now()
    where id = p_order_id
    returning * into v_order;
  end if;

  if (v_has_open_review or v_had_timestamp_conflict)
    and (
      v_order.shipment_delivered_at is not null
      or upper(regexp_replace(coalesce(v_order.shipment_status, ''), '[^A-Za-z0-9]+', '_', 'g'))
        in ('SHIPPED', 'PICKED_UP', 'PICKUP_COMPLETE', 'IN_TRANSIT', 'OUT_FOR_DELIVERY')
    ) then
    if v_order.inventory_committed_at is null then
      perform public.shipping_commit_untracked_delivery_once(p_order_id);
    elsif v_order.inventory_released_at is not null
      and v_order.inventory_reclaimed_at is null then
      perform public.shipping_reclaim_released_inventory_once(p_order_id);
    end if;
    select * into v_order from public.orders where id = p_order_id;
    -- Preserve any new deficit produced by the now-unblocked compensation;
    -- only the deficit that existed when this review began was resolved.
    v_has_delivery_shortfall := false;
  end if;

  v_next_reason := case
    when v_order.shipment_delivered_at is null
      and v_order.shipment_booking_state in ('cancelling', 'cancel_uncertain')
      and (
        v_order.awb_number is not null
        or upper(regexp_replace(coalesce(v_order.shipment_status, ''), '[^A-Za-z0-9]+', '_', 'g'))
          in ('SHIPPED', 'PICKED_UP', 'PICKUP_COMPLETE', 'IN_TRANSIT', 'OUT_FOR_DELIVERY')
      ) then 'shipment_while_ineligible'
    when v_order.payment_status = 'refunded'
      and v_order.inventory_committed_at is not null
      and v_order.inventory_released_at is null
      then 'return_inventory_pending'
    when v_order.order_status = 'cancelled'
      and v_order.shipment_delivered_at is not null
      then 'delivered_after_cancellation'
    when v_order.shipment_delivered_at is not null
      and (
        v_order.payment_status <> 'paid'
        or v_order.payment_review_required
        or v_order.inventory_reclaim_shortfall > 0
      ) then 'delivered_after_cancellation'
    when v_order.order_status = 'cancelled'
      and v_order.shipment_booking_state = 'cancelled'
      and v_order.inventory_committed_at is not null
      and v_order.inventory_released_at is null
      then 'return_inventory_pending'
    else null
  end;

  update public.orders
  set inventory_reclaim_shortfall = case
        when v_has_delivery_shortfall then 0
        else inventory_reclaim_shortfall
      end,
      fulfillment_review_required = v_next_reason is not null,
      fulfillment_review_reason = v_next_reason,
      shipment_last_error = case
        when v_next_reason = 'shipment_while_ineligible'
          then 'Inventory ledger reconciled; the live carrier shipment still must be stopped or reconciled'
        when v_next_reason = 'return_inventory_pending'
          then 'Inventory ledger reconciled; confirm physical stock receipt before restocking this order'
        when v_next_reason = 'delivered_after_cancellation'
          then 'Inventory ledger reconciled; carrier delivery after cancellation still requires payment/return review'
        else null
      end,
      notes = left(concat_ws(E'\n', nullif(notes, ''), nullif(trim(p_notes), '')), 2000)
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.release_rate_limit_attempt(
  p_scope_key text,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_scope_key is null or length(p_scope_key) < 16
    or p_action is null or p_action !~ '^[a-z][a-z0-9_.-]{2,63}$' then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT';
  end if;

  update public.rate_limit_attempts
  set attempts = greatest(0, attempts - 1),
      updated_at = now()
  where scope_key = p_scope_key and action = p_action;

  delete from public.rate_limit_attempts
  where scope_key = p_scope_key and action = p_action and attempts = 0;
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
  if v_order.payment_review_required then
    raise exception 'payment_review_blocks_fulfillment';
  end if;
  if v_order.fulfillment_review_required then
    raise exception 'fulfillment_review_blocks_fulfillment';
  end if;
  if p_new_status not in ('confirmed', 'processing', 'shipped', 'delivered') then
    raise exception 'invalid_order_status';
  end if;
  if v_order.order_status in ('cancelled', 'delivered') then
    raise exception 'terminal_order_status';
  end if;
  if v_order.payment_status in ('failed', 'refunded') then
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
  if p_new_status = 'confirmed' then
    raise exception 'order_status_cannot_move_backwards';
  end if;

  update public.orders
  set order_status = p_new_status,
      notes = case when p_notes is null then notes else left(p_notes, 2000) end,
      shipped_at = case
        when p_new_status in ('shipped', 'delivered') then coalesce(shipped_at, now())
        else shipped_at
      end,
      shipment_delivered_at = case
        when p_new_status = 'delivered' then coalesce(shipment_delivered_at, now())
        else shipment_delivered_at
      end
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
  v_inventory_review_open boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  v_inventory_review_open := exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = p_order_id and r.status = 'open'
  );
  if v_order.payment_method <> 'cod' then raise exception 'prepaid_payment_status_is_provider_managed'; end if;
  if p_new_payment_status not in ('paid', 'refunded') then raise exception 'invalid_cod_payment_status'; end if;
  if p_new_payment_status = v_order.payment_status then return v_order; end if;
  if p_new_payment_status = 'paid'
    and (
      v_order.payment_status <> 'pending'
      or (
        v_order.order_status not in ('shipped', 'delivered')
        and v_order.shipment_delivered_at is null
      )
    ) then
    raise exception 'cod_collection_requires_shipped_order';
  end if;
  if p_new_payment_status = 'refunded' and v_order.payment_status <> 'paid' then
    raise exception 'only_collected_cod_can_be_refunded';
  end if;
  if p_new_payment_status = 'refunded'
    and v_order.order_status <> 'delivered'
    and v_order.shipment_delivered_at is null
    and v_order.shipment_booking_state <> 'cancelled' then
    raise exception 'shipment_must_be_stopped_before_cod_refund';
  end if;

  update public.orders
  set payment_status = p_new_payment_status,
      payment_refunded_at = case
        when p_new_payment_status = 'refunded' then now()
        else null
      end,
      fulfillment_review_required = case
        when v_inventory_review_open then true
        when p_new_payment_status = 'paid'
          and order_status = 'delivered'
          and shipment_delivered_at is not null
          and inventory_reclaim_shortfall = 0
          then false
        when p_new_payment_status = 'refunded'
          and (
            order_status = 'delivered'
            or shipment_delivered_at is not null
          )
          and inventory_released_at is null
          then true
        else fulfillment_review_required
      end,
      fulfillment_review_reason = case
        when v_inventory_review_open then 'legacy_inventory_ledger_mismatch'
        when p_new_payment_status = 'paid'
          and order_status = 'delivered'
          and shipment_delivered_at is not null
          and inventory_reclaim_shortfall = 0
          then null
        when p_new_payment_status = 'refunded'
          and (
            order_status = 'delivered'
            or shipment_delivered_at is not null
          )
          and inventory_released_at is null
          then 'return_inventory_pending'
        else fulfillment_review_reason
      end,
      shipment_last_error = case
        when p_new_payment_status = 'paid'
          and order_status = 'delivered'
          and shipment_delivered_at is not null
          and inventory_reclaim_shortfall = 0
          then null
        else shipment_last_error
      end,
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
  v_inventory_review_open boolean := false;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'order_not_found'; end if;
  v_inventory_review_open := exists (
    select 1
    from public.inventory_reconciliation_reviews as r
    where r.order_id = p_order_id and r.status = 'open'
  );
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
  if v_order.order_status <> 'delivered'
    and v_order.shipment_delivered_at is null
    and v_order.shipment_booking_state <> 'cancelled' then
    raise exception 'shipment_must_be_stopped_before_prepaid_refund';
  end if;

  update public.orders
  set payment_status = 'refunded',
      payment_refunded_at = now(),
      payment_review_required = false,
      payment_review_reason = null,
      fulfillment_review_required = case
        when v_inventory_review_open then true
        when (order_status = 'delivered'
          or shipment_delivered_at is not null)
          and inventory_released_at is null
          then true
        else fulfillment_review_required
      end,
      fulfillment_review_reason = case
        when v_inventory_review_open then 'legacy_inventory_ledger_mismatch'
        when (order_status = 'delivered'
          or shipment_delivered_at is not null)
          and inventory_released_at is null
          then 'return_inventory_pending'
        else fulfillment_review_reason
      end,
      shipment_last_error = case
        when v_inventory_review_open
          then 'Refund recorded; historical inventory ledger reconciliation is still required'
        when (order_status = 'delivered'
          or shipment_delivered_at is not null)
          and inventory_released_at is null
          then 'Refund recorded; confirm a physical customer return before restocking'
        else shipment_last_error
      end
  where id = p_order_id
  returning * into v_order;

  update public.customers
  set total_spent = greatest(0, total_spent - v_order.total_amount)
  where email = v_order.customer_email;

  return v_order;
end
$$;

revoke all on function public.finalize_razorpay_payment(
  uuid, text, text, text, integer, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.admin_adjust_inventory(uuid, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.shipping_release_inventory_once(uuid)
  from public, anon, authenticated;
revoke all on function public.renew_prepaid_checkout_reservation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.shipping_commit_untracked_delivery_once(uuid)
  from public, anon, authenticated;
revoke all on function public.shipping_claim_booking(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.shipping_complete_booking(
  uuid, uuid, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.shipping_reclaim_released_inventory_once(uuid)
  from public, anon, authenticated;
revoke all on function public.shipping_claim_cancellation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.shipping_complete_cancellation(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.shipping_sync_status(
  uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.shipping_claim_refund_hold(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.shipping_complete_refund_hold(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.shipping_finalize_refunded_cancellation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_confirm_return_inventory(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_confirm_no_legacy_shipment(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_resolve_inventory_reconciliation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.release_rate_limit_attempt(text, text)
  from public, anon, authenticated;
revoke all on function public.admin_transition_order_status(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_transition_cod_payment(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_record_prepaid_refund(uuid, text, text, integer, text)
  from public, anon, authenticated;

grant execute on function public.finalize_razorpay_payment(
  uuid, text, text, text, integer, text, text, text, text
) to service_role;
grant execute on function public.admin_adjust_inventory(uuid, integer, text, text)
  to service_role;
grant execute on function public.shipping_release_inventory_once(uuid)
  to service_role;
grant execute on function public.renew_prepaid_checkout_reservation(uuid, text)
  to service_role;
grant execute on function public.shipping_commit_untracked_delivery_once(uuid)
  to service_role;
grant execute on function public.shipping_claim_booking(uuid, uuid)
  to service_role;
grant execute on function public.shipping_complete_booking(
  uuid, uuid, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.shipping_reclaim_released_inventory_once(uuid)
  to service_role;
grant execute on function public.shipping_claim_cancellation(uuid, uuid)
  to service_role;
grant execute on function public.shipping_complete_cancellation(uuid, uuid, text)
  to service_role;
grant execute on function public.shipping_sync_status(
  uuid, text, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.shipping_claim_refund_hold(uuid, uuid)
  to service_role;
grant execute on function public.shipping_complete_refund_hold(uuid, uuid)
  to service_role;
grant execute on function public.shipping_finalize_refunded_cancellation(uuid, text)
  to service_role;
grant execute on function public.admin_confirm_return_inventory(uuid)
  to service_role;
grant execute on function public.admin_confirm_no_legacy_shipment(uuid)
  to service_role;
grant execute on function public.admin_resolve_inventory_reconciliation(uuid, text)
  to service_role;
grant execute on function public.release_rate_limit_attempt(text, text)
  to service_role;
grant execute on function public.admin_transition_order_status(uuid, text, text)
  to service_role;
grant execute on function public.admin_transition_cod_payment(uuid, text, text)
  to service_role;
grant execute on function public.admin_record_prepaid_refund(uuid, text, text, integer, text)
  to service_role;

grant select, insert, update on table public.inventory_reconciliation_reviews
  to service_role;
grant select, insert, update on table public.inventory_reclaim_shortfalls
  to service_role;
