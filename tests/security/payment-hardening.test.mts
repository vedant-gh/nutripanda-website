import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import {
  buildCanonicalOrderItems,
  CheckoutValidationError,
  parseCheckoutRequest,
  parseIdempotencyKey,
} from '../../lib/orders/checkout-validation.ts'
import {
  verifyRazorpaySignature,
  verifyWebhookSignature,
} from '../../lib/razorpay/utils.ts'
import {
  assertFullyRefundedRazorpayPaymentRecord,
  RazorpayPaymentStateError,
} from '../../lib/razorpay/payment-state-core.ts'

const productId = '123e4567-e89b-42d3-a456-426614174000'

function checkout(items: unknown[]) {
  return {
    customer: {
      name: 'Test Customer',
      email: 'TEST@example.com',
      phone: '9876543210',
      whatsappOptIn: true,
    },
    shippingAddress: {
      line1: '123 Test Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    },
    items,
  }
}

test('checkout parser aggregates duplicate products and ignores client snapshots', () => {
  const parsed = parseCheckoutRequest(
    checkout([
      { productId, quantity: 2, price: 1, name: '<script>' },
      { productId, quantity: 3, price: -999 },
    ])
  )

  assert.deepEqual(parsed.items, [{ productId, quantity: 5 }])
  assert.equal(parsed.customer.email, 'test@example.com')

  const canonical = buildCanonicalOrderItems(parsed.items, [
    {
      id: productId,
      name: 'Canonical Gummies',
      slug: 'canonical-gummies',
      price: 49900,
      images: ['https://example.com/image.webp'],
      inventory_count: 8,
      is_active: true,
    },
  ])
  assert.equal(canonical.subtotal, 249500)
  assert.equal(canonical.items[0]?.name, 'Canonical Gummies')
  assert.equal(canonical.items[0]?.price, 49900)
})

for (const quantity of [0, -1, 1.5, 7, Number.NaN]) {
  test(`checkout parser rejects unsafe quantity ${String(quantity)}`, () => {
    assert.throws(
      () => parseCheckoutRequest(checkout([{ productId, quantity }])),
      CheckoutValidationError
    )
  })
}

test('aggregated quantities cannot bypass the per-product maximum', () => {
  assert.throws(
    () =>
      parseCheckoutRequest(
        checkout([
          { productId, quantity: 6 },
          { productId, quantity: 1 },
        ])
      ),
    /cannot exceed 6/
  )
})

test('COD idempotency keys are required and bounded', () => {
  assert.throws(
    () => parseIdempotencyKey(new Request('https://example.test'), true),
    /Idempotency-Key header is required/
  )
  const request = new Request('https://example.test', {
    headers: { 'Idempotency-Key': 'checkout_1234567890abcdef' },
  })
  assert.equal(parseIdempotencyKey(request, true), 'checkout_1234567890abcdef')
})

test('Razorpay signatures are verified against the server-stored order ID', () => {
  process.env.RAZORPAY_KEY_SECRET = 'test-key-secret'
  const orderId = 'order_serverstored123'
  const paymentId = 'pay_payment123456'
  const signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')

  assert.equal(verifyRazorpaySignature(orderId, paymentId, signature), true)
  assert.equal(verifyRazorpaySignature('order_attacker1234', paymentId, signature), false)
  assert.equal(verifyRazorpaySignature(orderId, paymentId, 'not-hex'), false)
})

test('webhook verification fails closed without its dedicated secret', () => {
  const previous = process.env.RAZORPAY_WEBHOOK_SECRET
  delete process.env.RAZORPAY_WEBHOOK_SECRET
  assert.throws(() => verifyWebhookSignature('{}', '0'.repeat(64)), /RAZORPAY_WEBHOOK_SECRET/)

  process.env.RAZORPAY_WEBHOOK_SECRET = 'dedicated-webhook-secret'
  const body = '{"event":"payment.captured"}'
  const signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex')
  assert.equal(verifyWebhookSignature(body, signature), true)

  process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_KEY_SECRET
  assert.throws(
    () => verifyWebhookSignature(body, signature),
    /dedicated strong secret/
  )

  if (previous) process.env.RAZORPAY_WEBHOOK_SECRET = previous
  else delete process.env.RAZORPAY_WEBHOOK_SECRET
})

test('cancellation accepts only an exact completed full Razorpay refund', () => {
  const expected = {
    storedOrderId: 'order_refund12345',
    paymentId: 'pay_refund123456',
    expectedAmount: 49900,
  }
  const refunded = {
    id: expected.paymentId,
    order_id: expected.storedOrderId,
    amount: expected.expectedAmount,
    amount_refunded: expected.expectedAmount,
    currency: 'INR',
    status: 'refunded',
    refund_status: 'full' as const,
  }

  assert.equal(assertFullyRefundedRazorpayPaymentRecord(refunded, expected).amount, 49900)
  assert.throws(
    () => assertFullyRefundedRazorpayPaymentRecord(
      { ...refunded, amount_refunded: 10000, refund_status: 'partial' },
      expected
    ),
    RazorpayPaymentStateError
  )
  assert.throws(
    () => assertFullyRefundedRazorpayPaymentRecord(
      { ...refunded, order_id: 'order_attacker1234' },
      expected
    ),
    RazorpayPaymentStateError
  )
})
