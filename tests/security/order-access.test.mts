import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOrderAccessTokenWithSecret,
  verifyOrderAccessTokenWithSecret,
} from '../../lib/orders/access-token-core.ts'

const SECRET = 'test-only-order-access-secret-32-bytes-minimum'
const ORDER_ID = '123e4567-e89b-42d3-a456-426614174000'
const OTHER_ORDER_ID = '123e4567-e89b-42d3-a456-426614174001'

test('order access token is scoped to one order and has an expiry', () => {
  const token = createOrderAccessTokenWithSecret(ORDER_ID, SECRET, {
    nowSeconds: 1_000,
    ttlSeconds: 300,
  })

  assert.deepEqual(
    verifyOrderAccessTokenWithSecret(token, SECRET, ORDER_ID, { nowSeconds: 1_100 }),
    { orderId: ORDER_ID, issuedAt: 1_000, expiresAt: 1_300 }
  )
  assert.equal(
    verifyOrderAccessTokenWithSecret(token, SECRET, OTHER_ORDER_ID, { nowSeconds: 1_100 }),
    null
  )
  assert.equal(
    verifyOrderAccessTokenWithSecret(token, SECRET, ORDER_ID, { nowSeconds: 1_300 }),
    null
  )
})
test('tampered order access token is rejected', () => {
  const token = createOrderAccessTokenWithSecret(ORDER_ID, SECRET, {
    nowSeconds: 2_000,
    ttlSeconds: 300,
  })
  const [payload, signature] = token.split('.')
  const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`

  assert.equal(
    verifyOrderAccessTokenWithSecret(tampered, SECRET, ORDER_ID, { nowSeconds: 2_100 }),
    null
  )
})

test('token creation fails closed for weak secrets and malformed order IDs', () => {
  assert.throws(() => createOrderAccessTokenWithSecret(ORDER_ID, 'short'))
  assert.throws(() => createOrderAccessTokenWithSecret('not-an-order-id', SECRET))
})
