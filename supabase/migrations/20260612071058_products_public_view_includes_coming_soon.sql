-- Allow the public (anon) to view coming-soon products as teasers, in addition
-- to active products. Inactive (and not coming-soon) products stay hidden.
--
-- This broadens the existing public SELECT policy on products so the storefront
-- can show "coming soon" cards and open their detail pages. Without this, the
-- anon client could only read is_active = true rows, so coming-soon products
-- were invisible (missing from Best Sellers, 404 on their pages).

drop policy if exists "Anyone can view active products" on public.products;

create policy "Anyone can view active products"
  on public.products
  for select
  using (is_active = true or is_coming_soon = true);
