-- Admin-managed blog editor credentials. The dashboard never reads this table
-- directly: only the website/API service-role client may access it.

create table if not exists public.dashboard_blog_editors (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  session_version integer not null default 1,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_blog_editors_email_normalized_check
    check (
      email = lower(btrim(email))
      and length(email) between 3 and 254
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint dashboard_blog_editors_password_hash_check
    check (
      length(password_hash) between 80 and 512
      and password_hash like 'scrypt$%'
    ),
  constraint dashboard_blog_editors_session_version_check
    check (session_version between 1 and 2147483647)
);

create unique index if not exists dashboard_blog_editors_email_unique_idx
  on public.dashboard_blog_editors (lower(email));

create index if not exists dashboard_blog_editors_created_at_idx
  on public.dashboard_blog_editors (created_at desc);

create or replace function public.set_dashboard_blog_editor_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.password_hash is distinct from old.password_hash then
    new.session_version = old.session_version + 1;
  else
    new.session_version = old.session_version;
  end if;

  new.email = lower(btrim(new.email));
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_dashboard_blog_editor_audit_fields
  on public.dashboard_blog_editors;
create trigger set_dashboard_blog_editor_audit_fields
  before update on public.dashboard_blog_editors
  for each row
  execute function public.set_dashboard_blog_editor_audit_fields();

alter table public.dashboard_blog_editors enable row level security;

-- There are deliberately no anon/authenticated policies. Authentication and
-- management happen only through role-checked API routes using service_role.
revoke all on table public.dashboard_blog_editors from public, anon, authenticated;
grant select, insert, update, delete on table public.dashboard_blog_editors to service_role;

