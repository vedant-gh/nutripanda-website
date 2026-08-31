-- Blog CMS storage used by the dashboard and public journal.
-- Dashboard writes use the service role. Public visitors may only read posts
-- whose status is "published".

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  cover_image_url text,
  content jsonb not null default '[]'::jsonb,
  author text,
  tags text[] not null default '{}'::text[],
  category text,
  status text not null default 'draft',
  is_featured boolean not null default false,
  reading_time integer,
  seo_title text,
  seo_description text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Make the migration safe for projects where the table was initially created
-- through the Supabase UI rather than through version-controlled SQL.
alter table public.blog_posts
  add column if not exists excerpt text,
  add column if not exists cover_image_url text,
  add column if not exists content jsonb not null default '[]'::jsonb,
  add column if not exists author text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists category text,
  add column if not exists status text not null default 'draft',
  add column if not exists is_featured boolean not null default false,
  add column if not exists reading_time integer,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists published_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'blog_posts_status_check'
      and conrelid = 'public.blog_posts'::regclass
  ) then
    alter table public.blog_posts
      add constraint blog_posts_status_check
      check (status in ('draft', 'published'));
  end if;
end;
$$;

create index if not exists blog_posts_published_at_idx
  on public.blog_posts (published_at desc)
  where status = 'published';

create unique index if not exists blog_posts_slug_unique_idx
  on public.blog_posts (slug);

create index if not exists blog_posts_updated_at_idx
  on public.blog_posts (updated_at desc);

create or replace function public.set_blog_posts_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_blog_posts_updated_at on public.blog_posts;
create trigger set_blog_posts_updated_at
  before update on public.blog_posts
  for each row
  execute function public.set_blog_posts_updated_at();

alter table public.blog_posts enable row level security;

drop policy if exists "Anyone can view published blog posts" on public.blog_posts;
create policy "Anyone can view published blog posts"
  on public.blog_posts
  for select
  using (status = 'published');

grant select on public.blog_posts to anon, authenticated;
revoke insert, update, delete on public.blog_posts from anon, authenticated;
grant all on public.blog_posts to service_role;
