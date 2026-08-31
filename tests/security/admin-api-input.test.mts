import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_COUPON_BODY_BYTES,
  parseCouponInput,
  parsePublicCouponInput,
} from '../../lib/coupons/input.ts'
import {
  isSafeAdminOrderSearch,
  parseAdminOrderFilters,
} from '../../lib/orders/admin-list-input.ts'
import {
  isUuid,
  readBoundedJsonObject,
} from '../../lib/utils/request-input.ts'

test('coupon creation normalizes bounded, typed fields', () => {
  const result = parseCouponInput({
    code: ' panda-20 ',
    discount_type: 'percent',
    discount_value: 20,
    expires_at: '2026-12-31T23:59:59.000Z',
    description: '  Launch offer  ',
  }, 'create')

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value, {
    code: 'PANDA-20',
    discount_type: 'percent',
    discount_value: 20,
    min_subtotal: 0,
    max_discount: null,
    is_active: true,
    expires_at: '2026-12-31T23:59:59.000Z',
    description: 'Launch offer',
  })
})

test('coupon writes reject coercion, unknown fields, and inconsistent updates', () => {
  assert.deepEqual(
    parseCouponInput({
      code: 'PANDA20',
      discount_type: 'percent',
      discount_value: '20',
    }, 'create'),
    { ok: false, error: 'discount_value must be an integer between 1 and 100' }
  )
  assert.deepEqual(
    parseCouponInput({ is_active: true, role: 'admin' }, 'update'),
    { ok: false, error: 'Request contains unsupported coupon fields' }
  )
  assert.deepEqual(
    parseCouponInput({ discount_type: 'fixed' }, 'update'),
    { ok: false, error: 'discount_type and discount_value must be changed together' }
  )
  assert.deepEqual(
    parseCouponInput({ expires_at: '2026-02-31T10:00:00Z' }, 'update'),
    { ok: false, error: 'expires_at must be null or a valid RFC 3339 timestamp' }
  )
})

test('public coupon input requires canonical integer paise and a bounded code', () => {
  assert.deepEqual(
    parsePublicCouponInput({ code: ' panda150 ', subtotal: 149900 }),
    { ok: true, value: { code: 'PANDA150', subtotal: 149900 } }
  )
  assert.equal(parsePublicCouponInput({ code: 'PANDA150', subtotal: 10.5 }).ok, false)
  assert.equal(parsePublicCouponInput({ code: 'PANDA150', subtotal: 100, extra: true }).ok, false)
})

test('bounded JSON reader enforces MIME type, shape, declared size, and actual size', async () => {
  const valid = await readBoundedJsonObject(new Request('https://example.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ action: 'sync' }),
  }), { maxBytes: 1024 })
  assert.deepEqual(valid, { ok: true, value: { action: 'sync' } })

  const wrongType = await readBoundedJsonObject(new Request('https://example.test', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  }), { maxBytes: 1024 })
  assert.equal(wrongType.ok, false)
  if (!wrongType.ok) assert.equal(wrongType.status, 415)

  const array = await readBoundedJsonObject(new Request('https://example.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '[]',
  }), { maxBytes: 1024 })
  assert.equal(array.ok, false)

  const oversized = await readBoundedJsonObject(new Request('https://example.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(MAX_COUPON_BODY_BYTES) }),
  }), { maxBytes: MAX_COUPON_BODY_BYTES })
  assert.equal(oversized.ok, false)
  if (!oversized.ok) assert.equal(oversized.status, 413)
})

test('admin order filters reject status/filter injection and clamp resource use', () => {
  const valid = parseAdminOrderFilters(new URLSearchParams({
    payment_status: 'paid',
    order_status: 'processing',
    search: 'Asha customer@example.com',
    limit: '50',
    offset: '100',
  }))
  assert.equal(valid.ok, true)

  assert.equal(
    parseAdminOrderFilters(new URLSearchParams('search=foo%29%2Corder_status.eq.delivered')).ok,
    false
  )
  assert.equal(parseAdminOrderFilters(new URLSearchParams('limit=101')).ok, false)
  assert.equal(parseAdminOrderFilters(new URLSearchParams('offset=-1')).ok, false)
  assert.equal(parseAdminOrderFilters(new URLSearchParams('order_status=deleted')).ok, false)
  assert.equal(parseAdminOrderFilters(new URLSearchParams('search=a&search=b')).ok, false)
  assert.equal(isSafeAdminOrderSearch('Asha_Rao+buyer@example.com'), true)
})

test('UUID validation accepts canonical IDs and rejects route syntax', () => {
  assert.equal(isUuid('123e4567-e89b-42d3-a456-426614174000'), true)
  assert.equal(isUuid('123e4567-e89b-42d3-a456-426614174000,or(id.neq.null)'), false)
})
