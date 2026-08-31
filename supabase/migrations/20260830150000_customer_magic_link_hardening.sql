-- One-time customer magic-link credentials.
--
-- The bearer credential and customer email are never stored here. The app
-- records only a SHA-256 token digest and an HMAC-keyed email identifier. All
-- mutation is restricted to service-role-only security-definer functions.

create table if not exists public.customer_magic_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  email_hash text not null check (email_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index if not exists customer_magic_tokens_email_active_idx
  on public.customer_magic_tokens (email_hash, expires_at)
  where consumed_at is null;

create index if not exists customer_magic_tokens_expiry_idx
  on public.customer_magic_tokens (expires_at);

alter table public.customer_magic_tokens enable row level security;

revoke all on table public.customer_magic_tokens from public, anon, authenticated;

create or replace function public.issue_customer_magic_token(
  p_token_hash text,
  p_email_hash text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_email_hash is null or p_email_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at is null
    or p_expires_at <= now()
    or p_expires_at > now() + interval '20 minutes' then
    raise exception using errcode = '22023', message = 'INVALID_CUSTOMER_MAGIC_TOKEN';
  end if;

  -- Serialize replacement issuance for one keyed identity so concurrent
  -- requests cannot leave two different links active.
  perform pg_advisory_xact_lock(hashtextextended(p_email_hash, 0));

  -- Issuing a replacement invalidates older outstanding links for the same
  -- keyed identity. The update and insert share this transaction.
  update public.customer_magic_tokens
  set consumed_at = now()
  where email_hash = p_email_hash
    and consumed_at is null;

  insert into public.customer_magic_tokens (token_hash, email_hash, expires_at)
  values (p_token_hash, p_email_hash, p_expires_at);
end
$$;

create or replace function public.consume_customer_magic_token(
  p_token_hash text,
  p_email_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consumed_hash text;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_email_hash is null or p_email_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  update public.customer_magic_tokens
  set consumed_at = now()
  where token_hash = p_token_hash
    and email_hash = p_email_hash
    and consumed_at is null
    and expires_at > now()
  returning token_hash into v_consumed_hash;

  return v_consumed_hash is not null;
end
$$;

revoke all on function public.issue_customer_magic_token(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.consume_customer_magic_token(text, text)
  from public, anon, authenticated;

grant execute on function public.issue_customer_magic_token(text, text, timestamptz)
  to service_role;
grant execute on function public.consume_customer_magic_token(text, text)
  to service_role;
