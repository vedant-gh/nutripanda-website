-- Durable, idempotent notification delivery and coupon-send abuse controls.
-- Depends on 20260830120000_payment_checkout_hardening.sql for payment_outbox.

-- notifications_log remains the audit table, but pending rows now also form a
-- small delivery queue. The unique idempotency key prevents duplicate logical
-- messages when payment callbacks or admin requests are retried.
alter table public.notifications_log
  add column if not exists idempotency_key text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists provider_message_id text,
  add column if not exists attempts integer not null default 0,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.notifications_log
  alter column status set default 'pending',
  alter column sent_at drop default,
  alter column sent_at drop not null;

-- Remove the original sent/delivered/failed-only check even if its generated
-- name differs between environments.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'notifications_log'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format(
      'alter table public.notifications_log drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

-- A partially applied/replayed migration may already have installed the two
-- non-status checks. Drop them by their stable names before recreating all
-- queue constraints together.
alter table public.notifications_log
  drop constraint if exists notifications_log_attempts_check,
  drop constraint if exists notifications_log_payload_object_check;

alter table public.notifications_log
  add constraint notifications_log_delivery_status_check
  check (status in ('pending', 'processing', 'sent', 'delivered', 'failed', 'skipped')),
  add constraint notifications_log_attempts_check
  check (attempts >= 0 and attempts <= 100),
  add constraint notifications_log_payload_object_check
  check (jsonb_typeof(payload) = 'object');

create unique index if not exists notifications_log_idempotency_key_uidx
  on public.notifications_log (idempotency_key)
  where idempotency_key is not null;

create index if not exists notifications_log_delivery_queue_idx
  on public.notifications_log (available_at, id)
  where status in ('pending', 'failed', 'processing') and attempts < 5;

create or replace function public.touch_notification_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notifications_log_touch_updated_at on public.notifications_log;
create trigger notifications_log_touch_updated_at
before update on public.notifications_log
for each row execute function public.touch_notification_updated_at();

-- Atomically claim a bounded batch. Failed rows use available_at for
-- exponential backoff; processing rows abandoned by a dead worker become
-- eligible again after ten minutes.
create or replace function public.claim_notification_deliveries(p_limit integer default 10)
returns setof public.notifications_log
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with claimable as (
    select notification.id
      from public.notifications_log notification
     where notification.attempts < 5
       and (
         (
           notification.status in ('pending', 'failed')
           and notification.available_at <= now()
         )
         or (
           notification.status = 'processing'
           and notification.locked_at < now() - interval '10 minutes'
         )
       )
     order by notification.available_at, notification.id
     for update skip locked
     limit least(greatest(coalesce(p_limit, 10), 1), 25)
  ), claimed as (
    update public.notifications_log notification
       set status = 'processing',
           attempts = notification.attempts + 1,
           locked_at = now(),
           error_message = null
      from claimable
     where notification.id = claimable.id
     returning notification.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_notification_deliveries(integer) from public;
revoke all on function public.claim_notification_deliveries(integer) from anon;
revoke all on function public.claim_notification_deliveries(integer) from authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;

alter table public.notifications_log enable row level security;

-- Durable public-endpoint throttling without storing raw IPs in the database.
-- The route inserts only keyed HMAC digests generated with
-- COUPON_RATE_LIMIT_SECRET.
create table if not exists public.coupon_send_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.coupon_send_rate_limits enable row level security;

create or replace function public.claim_coupon_send_request(
  p_phone_key text,
  p_ip_key text
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_key text;
  current_row public.coupon_send_rate_limits%rowtype;
  window_size interval;
  request_limit integer;
  candidate_retry integer;
  final_retry integer := 0;
  request_allowed boolean := true;
  key_index integer;
begin
  if p_phone_key is null or length(p_phone_key) < 16
     or p_ip_key is null or length(p_ip_key) < 16 then
    raise exception 'Invalid rate-limit keys';
  end if;

  -- Always lock/update in phone-then-IP order to avoid deadlocks.
  for key_index in 1..2 loop
    if key_index = 1 then
      current_key := 'phone:' || p_phone_key;
      window_size := interval '24 hours';
      request_limit := 2;
    else
      current_key := 'ip:' || p_ip_key;
      window_size := interval '1 hour';
      request_limit := 5;
    end if;

    insert into public.coupon_send_rate_limits (key_hash, request_count)
    values (current_key, 0)
    on conflict (key_hash) do nothing;

    select * into current_row
      from public.coupon_send_rate_limits
     where key_hash = current_key
     for update;

    if current_row.blocked_until is not null and current_row.blocked_until > now() then
      request_allowed := false;
      candidate_retry := greatest(
        1,
        ceil(extract(epoch from current_row.blocked_until - now()))::integer
      );
      final_retry := greatest(final_retry, candidate_retry);
    elsif current_row.window_started_at + window_size <= now() then
      update public.coupon_send_rate_limits
         set window_started_at = now(),
             request_count = 1,
             blocked_until = null,
             updated_at = now()
       where key_hash = current_key;
    elsif current_row.request_count >= request_limit then
      request_allowed := false;
      candidate_retry := greatest(
        1,
        ceil(extract(epoch from current_row.window_started_at + window_size - now()))::integer
      );
      final_retry := greatest(final_retry, candidate_retry);

      update public.coupon_send_rate_limits
         set blocked_until = current_row.window_started_at + window_size,
             updated_at = now()
       where key_hash = current_key;
    else
      update public.coupon_send_rate_limits
         set request_count = current_row.request_count + 1,
             blocked_until = null,
             updated_at = now()
       where key_hash = current_key;
    end if;
  end loop;

  return query select request_allowed, final_retry;
end;
$$;

revoke all on function public.claim_coupon_send_request(text, text) from public;
revoke all on function public.claim_coupon_send_request(text, text) from anon;
revoke all on function public.claim_coupon_send_request(text, text) from authenticated;
grant execute on function public.claim_coupon_send_request(text, text) to service_role;

alter table public.coupon_leads
  add column if not exists whatsapp_sent_at timestamptz,
  add column if not exists whatsapp_send_count integer not null default 0;

create or replace function public.mark_coupon_whatsapp_sent(p_phone text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.coupon_leads
     set whatsapp_sent = true,
         whatsapp_sent_at = now(),
         whatsapp_send_count = whatsapp_send_count + 1
   where phone = p_phone;
$$;

revoke all on function public.mark_coupon_whatsapp_sent(text) from public;
revoke all on function public.mark_coupon_whatsapp_sent(text) from anon;
revoke all on function public.mark_coupon_whatsapp_sent(text) from authenticated;
grant execute on function public.mark_coupon_whatsapp_sent(text) to service_role;
