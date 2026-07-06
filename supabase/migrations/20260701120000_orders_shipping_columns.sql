-- Add Proship (Prozo) shipment tracking columns to orders.
--
-- Populated when an admin creates a shipment from the dashboard
-- (POST /api/admin/orders/[id]/ship). All nullable — an order has no shipment
-- until one is explicitly created. Written by the service_role only; no RLS
-- policy change is needed (anon never reads these).

alter table public.orders
  add column if not exists proship_order_id    text,
  add column if not exists awb_number          text,
  add column if not exists courier_name        text,
  add column if not exists shipping_label_url  text,
  add column if not exists tracking_url        text,
  add column if not exists shipment_status     text,
  add column if not exists shipped_at          timestamptz;

-- Look up an order by its AWB quickly (e.g. from a tracking webhook).
create index if not exists orders_awb_number_idx
  on public.orders (awb_number)
  where awb_number is not null;
