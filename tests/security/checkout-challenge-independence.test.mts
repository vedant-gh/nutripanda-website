import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const checkoutPage = readFileSync('app/checkout/page.tsx', 'utf8')
const prepaidRoute = readFileSync('app/api/razorpay/create-order/route.ts', 'utf8')
const codRoute = readFileSync('app/api/orders/cod/route.ts', 'utf8')

test('checkout does not depend on an external challenge service', () => {
  for (const source of [checkoutPage, prepaidRoute, codRoute]) {
    assert.doesNotMatch(source, /turnstile/i)
  }
})

test('checkout retains durable phone and IP rate limiting', () => {
  for (const source of [prepaidRoute, codRoute]) {
    assert.match(source, /consumeCheckoutRateLimit/)
    assert.match(source, /createRateLimitScope\('phone'/)
    assert.match(source, /createRateLimitScope\('ip'/)
  }
})
