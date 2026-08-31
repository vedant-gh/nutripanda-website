import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkoutTurnstileToken,
  TurnstileError,
  verifyCheckoutTurnstile,
} from '../../lib/security/turnstile.ts'

const originalFetch = globalThis.fetch
const originalSecret = process.env.TURNSTILE_SECRET_KEY
const originalHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME

test.after(() => {
  globalThis.fetch = originalFetch
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY
  else process.env.TURNSTILE_SECRET_KEY = originalSecret
  if (originalHostname === undefined) delete process.env.TURNSTILE_EXPECTED_HOSTNAME
  else process.env.TURNSTILE_EXPECTED_HOSTNAME = originalHostname
})

test('checkout challenge tokens are required and bounded', () => {
  assert.equal(checkoutTurnstileToken({ turnstileToken: ' valid-token ' }), 'valid-token')
  assert.throws(() => checkoutTurnstileToken({}), TurnstileError)
  assert.throws(
    () => checkoutTurnstileToken({ turnstileToken: 'x'.repeat(2049) }),
    TurnstileError
  )
})

test('checkout challenge fails closed without the server secret', async () => {
  delete process.env.TURNSTILE_SECRET_KEY
  await assert.rejects(
    verifyCheckoutTurnstile({ token: 'token' }),
    (error: unknown) => error instanceof TurnstileError && error.status === 503
  )
})

test('checkout challenge enforces action and production hostname', async () => {
  process.env.TURNSTILE_SECRET_KEY = 'test-secret'
  process.env.TURNSTILE_EXPECTED_HOSTNAME = 'nutripanda.in'

  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    action: 'coupon',
    hostname: 'nutripanda.in',
  }))
  await assert.rejects(verifyCheckoutTurnstile({ token: 'token' }), TurnstileError)

  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    action: 'checkout',
    hostname: 'attacker.example',
  }))
  await assert.rejects(verifyCheckoutTurnstile({ token: 'token' }), TurnstileError)
})

test('checkout challenge sends the remote IP and accepts an exact valid response', async () => {
  process.env.TURNSTILE_SECRET_KEY = 'test-secret'
  process.env.TURNSTILE_EXPECTED_HOSTNAME = 'nutripanda.in'
  let requestBody = ''
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body)
    return new Response(JSON.stringify({
      success: true,
      action: 'checkout',
      hostname: 'nutripanda.in',
    }))
  }

  await verifyCheckoutTurnstile({ token: 'valid-token', remoteIp: '203.0.113.7' })
  const params = new URLSearchParams(requestBody)
  assert.equal(params.get('response'), 'valid-token')
  assert.equal(params.get('remoteip'), '203.0.113.7')
  assert.match(params.get('idempotency_key') ?? '', /^[0-9a-f-]{36}$/)
})
