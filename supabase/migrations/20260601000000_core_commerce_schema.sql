-- Reproducible core NutriPanda schema.
--
-- Existing production projects may already have these tables from the
-- Supabase dashboard. `if not exists` keeps this migration safe there while a
-- fresh project receives every table required by the application.

create extension if not exists pgcrypto;

create or replace function public.generate_order_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'NP-'
    || pg_catalog.to_char(pg_catalog.now() at time zone 'Asia/Kolkata', 'YYYYMMDD')
    || '-'
    || pg_catalog.upper(
      pg_catalog.substr(
        pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        1,
        4
      )
    );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  short_description text,
  price integer not null check (price >= 0),
  compare_at_price integer check (compare_at_price is null or compare_at_price >= 0),
  images text[],
  color_theme text,
  ingredients jsonb,
  nutrition_facts jsonb,
  trust_badges text[],
  category text,
  is_active boolean not null default true,
  is_featured boolean not null default false,
  is_coming_soon boolean not null default false,
  inventory_count integer not null default 0 check (inventory_count >= 0),
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_location text,
  text text not null,
  rating integer check (rating between 1 and 5),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default public.generate_order_number(),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  customer_whatsapp_opted_in boolean not null default false,
  shipping_address jsonb not null,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  subtotal integer not null check (subtotal >= 0),
  shipping_cost integer not null default 0 check (shipping_cost >= 0),
  discount integer not null default 0 check (discount >= 0),
  cod_fee integer not null default 0 check (cod_fee >= 0),
  total_amount integer not null check (total_amount >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  payment_method text not null default 'prepaid'
    check (payment_method in ('prepaid', 'cod')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  order_status text not null default 'confirmed'
    check (order_status in ('confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_signature text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  phone text not null,
  whatsapp_opted_in boolean not null default false,
  order_count integer not null default 0 check (order_count >= 0),
  total_spent integer not null default 0 check (total_spent >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_log (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  change_type text not null
    check (change_type in ('sale', 'restock', 'adjustment', 'return')),
  quantity_change integer not null,
  previous_stock integer not null check (previous_stock >= 0),
  new_stock integer not null check (new_stock >= 0),
  order_id uuid references public.orders(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete restrict,
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  recipient text not null,
  template text not null,
  status text not null default 'sent'
    check (status in ('sent', 'delivered', 'failed')),
  error_message text,
  sent_at timestamptz not null default now()
);

create table if not exists public.coupon_leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  coupon_code text not null unique,
  discount_percent integer not null check (discount_percent between 1 and 100),
  is_used boolean not null default false,
  whatsapp_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value integer not null check (discount_value > 0),
  min_subtotal integer not null default 0 check (min_subtotal >= 0),
  max_discount integer check (max_discount is null or max_discount >= 0),
  is_active boolean not null default true,
  expires_at timestamptz,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists set_faqs_updated_at on public.faqs;
create trigger set_faqs_updated_at before update on public.faqs
for each row execute function public.set_updated_at();

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists set_coupons_updated_at on public.coupons;
create trigger set_coupons_updated_at before update on public.coupons
for each row execute function public.set_updated_at();

create index if not exists products_active_idx on public.products (is_active);
create index if not exists products_featured_idx on public.products (is_featured);
create index if not exists faqs_display_order_idx on public.faqs (display_order);
create index if not exists testimonials_active_idx on public.testimonials (is_active);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_customer_email_idx on public.orders (lower(customer_email));
create index if not exists inventory_log_product_idx on public.inventory_log (product_id, created_at desc);
create index if not exists notifications_log_order_idx on public.notifications_log (order_id, sent_at desc);
create index if not exists coupons_code_idx on public.coupons (upper(code));

alter table public.products enable row level security;
alter table public.faqs enable row level security;
alter table public.testimonials enable row level security;
alter table public.orders enable row level security;
alter table public.customers enable row level security;
alter table public.inventory_log enable row level security;
alter table public.notifications_log enable row level security;
alter table public.coupon_leads enable row level security;
alter table public.coupons enable row level security;

drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products" on public.products
for select to anon, authenticated
using (is_active = true or is_coming_soon = true);

drop policy if exists "Anyone can view active FAQs" on public.faqs;
create policy "Anyone can view active FAQs" on public.faqs
for select to anon, authenticated using (is_active = true);

drop policy if exists "Anyone can view active testimonials" on public.testimonials;
create policy "Anyone can view active testimonials" on public.testimonials
for select to anon, authenticated using (is_active = true);

grant select on public.products, public.faqs, public.testimonials to anon, authenticated;
revoke insert, update, delete on public.products, public.faqs, public.testimonials from anon, authenticated;
revoke all on public.orders, public.customers, public.inventory_log,
  public.notifications_log, public.coupon_leads, public.coupons from anon, authenticated;

grant all on public.products, public.faqs, public.testimonials, public.orders,
  public.customers, public.inventory_log, public.notifications_log,
  public.coupon_leads, public.coupons to service_role;

revoke all on function public.generate_order_number() from public, anon, authenticated;
grant execute on function public.generate_order_number() to service_role;
