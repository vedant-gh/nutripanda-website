import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CUSTOMER_MAGIC_TTL_SECONDS,
  createMagicTokenWithSecret,
  createSessionTokenWithSecret,
  hashCustomerEmail,
  verifyMagicTokenWithSecret,
  verifySessionTokenWithSecret,
} from '../../lib/customer-auth-core.ts'

const SECRET = 'customer-auth-test-secret-at-least-32-characters'
const EMAIL = 'customer@example.com'
const NOW_SECONDS = 10_000

test('magic credentials are unique, purpose-bound, normalized, and expiring', () => {
  const first = createMagicTokenWithSecret(' Customer@Example.com ', SECRET, {
    nowSeconds: NOW_SECONDS,
  })
  const second = createMagicTokenWithSecret(EMAIL, SECRET, {
    nowSeconds: NOW_SECONDS,
  })

  assert.notEqual(first.token, second.token)
  assert.notEqual(first.jti, second.jti)
  assert.equal(first.email, EMAIL)
  assert.equal(first.expiresAt, NOW_SECONDS + CUSTOMER_MAGIC_TTL_SECONDS)
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/)
  assert.match(first.emailHash, /^[a-f0-9]{64}$/)
  assert.equal(first.tokenHash.includes(EMAIL), false)
  assert.equal(first.emailHash.includes(EMAIL), false)

  assert.deepEqual(
    verifyMagicTokenWithSecret(first.token, SECRET, { nowSeconds: NOW_SECONDS + 1 }),
    {
      email: EMAIL,
      issuedAt: NOW_SECONDS,
      expiresAt: NOW_SECONDS + CUSTOMER_MAGIC_TTL_SECONDS,
      jti: first.jti,
    }
  )
  assert.equal(
    verifyMagicTokenWithSecret(first.token, SECRET, {
      nowSeconds: NOW_SECONDS + CUSTOMER_MAGIC_TTL_SECONDS,
    }),
    null
  )
  assert.equal(
    verifySessionTokenWithSecret(first.token, SECRET, { nowSeconds: NOW_SECONDS + 1 }),
    null
  )
})

test('tampered customer tokens and weak secrets fail closed', () => {
  const issued = createMagicTokenWithSecret(EMAIL, SECRET, {
    nowSeconds: NOW_SECONDS,
    randomId: 'a'.repeat(43),
  })
  const [payload, signature] = issued.token.split('.')
  const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`

  assert.equal(
    verifyMagicTokenWithSecret(tampered, SECRET, { nowSeconds: NOW_SECONDS + 1 }),
    null
  )
  assert.throws(() => createMagicTokenWithSecret(EMAIL, 'short'))
  assert.equal(verifyMagicTokenWithSecret(issued.token, 'short'), null)
})

test('session credentials have unique identifiers and validate only as sessions', () => {
  const token = createSessionTokenWithSecret(EMAIL, SECRET, {
    nowSeconds: NOW_SECONDS,
    randomId: 's'.repeat(43),
  })

  assert.equal(
    verifySessionTokenWithSecret(token, SECRET, { nowSeconds: NOW_SECONDS + 1 })?.email,
    EMAIL
  )
  assert.equal(
    verifyMagicTokenWithSecret(token, SECRET, { nowSeconds: NOW_SECONDS + 1 }),
    null
  )
})

test('email identifiers are HMAC-keyed and case-normalized', () => {
  assert.equal(
    hashCustomerEmail(' CUSTOMER@example.com ', SECRET),
    hashCustomerEmail(EMAIL, SECRET)
  )
  assert.notEqual(
    hashCustomerEmail(EMAIL, SECRET),
    hashCustomerEmail('someone-else@example.com', SECRET)
  )
})

test('the database claim is atomic and stores no bearer token or raw email column', () => {
  const migration = readFileSync(
    new URL(
      '../../supabase/migrations/20260830150000_customer_magic_link_hardening.sql',
      import.meta.url
    ),
    'utf8'
  )

  assert.match(migration, /token_hash text primary key/)
  assert.match(migration, /email_hash text not null/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /and consumed_at is null/)
  assert.match(migration, /returning token_hash into v_consumed_hash/)
  assert.doesNotMatch(migration, /customer_email\s+text/)
  assert.doesNotMatch(migration, /magic_token\s+text/)
})

test('magic-link delivery uses durable HMAC-keyed email and IP limits', () => {
  const route = readFileSync(
    new URL('../../app/api/account/send-link/route.ts', import.meta.url),
    'utf8'
  )

  assert.match(route, /process\.env\.RATE_LIMIT_SECRET/)
  assert.match(route, /createHmac\('sha256', secret\)/)
  assert.match(route, /rpc\('consume_rate_limit'/)
  assert.match(route, /createCustomerRateLimitScope\('email'/)
  assert.match(route, /createCustomerRateLimitScope\('ip'/)
  assert.doesNotMatch(route, /CHECKOUT_RATE_LIMIT_SECRET/)
})
