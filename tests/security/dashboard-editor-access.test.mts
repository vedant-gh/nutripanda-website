import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  hashDashboardEditorPassword,
  verifyDashboardEditorPassword,
} from '../../lib/dashboard-auth/editor-password.ts'
import {
  parseDashboardEditorCreateInput,
  parseDashboardEditorPasswordInput,
} from '../../lib/dashboard-auth/editor-input.ts'

test('dashboard editor input normalizes email and requires a strong bounded password', () => {
  assert.deepEqual(
    parseDashboardEditorCreateInput({
      email: ' Writer@Example.COM ',
      password: 'Correct Horse Battery Staple 42',
    }),
    {
      ok: true,
      value: {
        email: 'writer@example.com',
        password: 'Correct Horse Battery Staple 42',
      },
    }
  )

  assert.equal(parseDashboardEditorCreateInput({
    email: 'not-an-email',
    password: 'Correct Horse Battery Staple 42',
  }).ok, false)
  assert.equal(parseDashboardEditorCreateInput({
    email: 'writer@example.com',
    password: 'too-short',
  }).ok, false)
  assert.equal(parseDashboardEditorCreateInput({
    email: 'writer@example.com',
    password: 'writer@example.com-password',
  }).ok, false)
  assert.equal(parseDashboardEditorCreateInput({
    email: 'writer@example.com',
    password: 'Correct Horse Battery Staple 42',
    role: 'admin',
  }).ok, false)
  assert.equal(parseDashboardEditorPasswordInput({
    password: 'Correct Horse Battery Staple 42',
    email: 'change@example.com',
  }).ok, false)
})

test('dashboard editor passwords use unique salted scrypt hashes', async () => {
  const password = 'Correct Horse Battery Staple 42'
  const first = await hashDashboardEditorPassword(password)
  const second = await hashDashboardEditorPassword(password)

  assert.notEqual(first, second)
  assert.match(first, /^scrypt\$16384\$8\$1\$/)
  assert.equal(first.includes(password), false)
  assert.equal(await verifyDashboardEditorPassword(password, first), true)
  assert.equal(await verifyDashboardEditorPassword('wrong password value', first), false)
  assert.equal(await verifyDashboardEditorPassword(password, `${first}tampered`), false)
  assert.equal(await verifyDashboardEditorPassword(password, 'not-a-valid-hash'), false)
})

test('blog editor table is service-role only and password changes revoke sessions', () => {
  const migration = readFileSync(
    new URL(
      '../../supabase/migrations/20260831110000_dashboard_blog_editors.sql',
      import.meta.url
    ),
    'utf8'
  )

  assert.match(migration, /create table if not exists public\.dashboard_blog_editors/)
  assert.match(migration, /password_hash text not null/)
  assert.match(migration, /session_version integer not null default 1/)
  assert.match(migration, /new\.session_version = old\.session_version \+ 1/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all on table public\.dashboard_blog_editors from public, anon, authenticated/)
  assert.match(migration, /grant select, insert, update, delete on table public\.dashboard_blog_editors to service_role/)
  assert.doesNotMatch(migration, /create policy/i)
})

test('admin-only editor routes never rely on sidebar hiding', () => {
  const collectionRoute = readFileSync(
    new URL('../../app/api/admin/blog-editors/route.ts', import.meta.url),
    'utf8'
  )
  const memberRoute = readFileSync(
    new URL('../../app/api/admin/blog-editors/[id]/route.ts', import.meta.url),
    'utf8'
  )
  const authModule = readFileSync(
    new URL('../../lib/utils/admin-auth.ts', import.meta.url),
    'utf8'
  )

  assert.match(collectionRoute, /requireDashboardRole\(\['admin'\]\)/)
  assert.match(memberRoute, /requireDashboardRole\(\['admin'\]\)/)
  assert.match(memberRoute, /isUuid\(id\)/)
  assert.match(authModule, /findDashboardBlogEditorByEmail/)
  assert.match(authModule, /editor\.session_version === session\.ver/)
  assert.doesNotMatch(authModule, /BLOG_EDITOR_[12]_/)
})

