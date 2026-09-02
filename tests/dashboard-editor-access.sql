-- Rollback-only integration checks for admin-managed blog editor access.
-- Apply migrations first, then run this only against an isolated test database.

begin;

do $$
declare
  v_editor_id uuid;
  v_version integer;
  v_rls_enabled boolean;
begin
  select relrowsecurity
  into v_rls_enabled
  from pg_class
  where oid = 'public.dashboard_blog_editors'::regclass;

  if not coalesce(v_rls_enabled, false) then
    raise exception 'dashboard_blog_editors must have RLS enabled';
  end if;

  if has_table_privilege('anon', 'public.dashboard_blog_editors', 'select')
    or has_table_privilege('authenticated', 'public.dashboard_blog_editors', 'select') then
    raise exception 'public roles must not read dashboard blog editors';
  end if;

  insert into public.dashboard_blog_editors (email, password_hash)
  values (
    'editor@example.com',
    'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  )
  returning id, session_version into v_editor_id, v_version;

  if v_version <> 1 then
    raise exception 'new editor session version must start at one';
  end if;

  update public.dashboard_blog_editors
  set password_hash =
    'scrypt$16384$8$1$BBBBBBBBBBBBBBBBBBBBBB$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
  where id = v_editor_id
  returning session_version into v_version;

  if v_version <> 2 then
    raise exception 'password change must increment session version';
  end if;

  update public.dashboard_blog_editors
  set last_login_at = now()
  where id = v_editor_id
  returning session_version into v_version;

  if v_version <> 2 then
    raise exception 'metadata update must not increment session version';
  end if;

  delete from public.dashboard_blog_editors where id = v_editor_id;
  if found and exists (
    select 1 from public.dashboard_blog_editors where id = v_editor_id
  ) then
    raise exception 'editor deletion must revoke the account';
  end if;
end
$$;

rollback;

