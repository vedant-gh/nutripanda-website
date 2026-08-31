-- Durable dashboard-login lockout helpers. These build on the generic
-- rate_limit_attempts table introduced by payment checkout hardening.

create or replace function public.rate_limit_allowed(
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
  v_window_started_at timestamptz;
begin
  if p_scope_key is null or length(p_scope_key) < 16
    or p_action is null or p_action !~ '^[a-z][a-z0-9_.-]{2,63}$'
    or p_limit not between 1 and 100
    or p_window_seconds not between 60 and 86400 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT';
  end if;

  select attempts, window_started_at
  into v_attempts, v_window_started_at
  from public.rate_limit_attempts
  where scope_key = p_scope_key and action = p_action;

  if not found or v_window_started_at <= now() - make_interval(secs => p_window_seconds) then
    return true;
  end if;

  return v_attempts < p_limit;
end
$$;

create or replace function public.clear_rate_limit(
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

  delete from public.rate_limit_attempts
  where scope_key = p_scope_key and action = p_action;
end
$$;

revoke all on function public.rate_limit_allowed(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.clear_rate_limit(text, text)
  from public, anon, authenticated;

grant execute on function public.rate_limit_allowed(text, text, integer, integer)
  to service_role;
grant execute on function public.clear_rate_limit(text, text)
  to service_role;
