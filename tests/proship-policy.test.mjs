import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTrackingUrl,
  normalizeShipmentStatus,
  orderStatusFromShipmentStatus,
  shipmentIneligibilityReason,
} from '../lib/proship/policy.ts'
import { parcelProfileForItems } from '../lib/proship/package.ts'
import { ProshipError } from '../lib/proship/client.ts'
import { parseShipmentLookupResponse } from '../lib/proship/policy.ts'

test('prepaid shipments require captured payment', () => {
  assert.match(
    shipmentIneligibilityReason({
      payment_method: 'prepaid',
      payment_status: 'pending',
      order_status: 'confirmed',
    }),
    /captured payment/
  )
  assert.equal(
    shipmentIneligibilityReason({
      payment_method: 'prepaid',
      payment_status: 'paid',
      order_status: 'confirmed',
    }),
    null
  )
})

test('cancelled, delivered, failed, and refunded orders are never shippable', () => {
  for (const input of [
    { payment_method: 'cod', payment_status: 'pending', order_status: 'cancelled' },
    { payment_method: 'cod', payment_status: 'pending', order_status: 'delivered' },
    { payment_method: 'cod', payment_status: 'failed', order_status: 'confirmed' },
    { payment_method: 'prepaid', payment_status: 'refunded', order_status: 'confirmed' },
  ]) {
    assert.ok(shipmentIneligibilityReason(input))
  }
})

test('provider status mapping advances orders and surfaces delivery after cancellation', () => {
  assert.equal(orderStatusFromShipmentStatus('processing', 'Out for delivery'), 'shipped')
  assert.equal(orderStatusFromShipmentStatus('confirmed', 'DELIVERED'), 'delivered')
  assert.equal(orderStatusFromShipmentStatus('delivered', 'IN_TRANSIT'), null)
  assert.equal(orderStatusFromShipmentStatus('cancelled', 'DELIVERED'), 'delivered')
  assert.equal(orderStatusFromShipmentStatus('cancelled', 'CANCELLED'), 'cancelled')
  assert.equal(orderStatusFromShipmentStatus('cancelled', 'IN_TRANSIT'), null)
  assert.equal(normalizeShipmentStatus('  Out-for delivery '), 'OUT_FOR_DELIVERY')
})

test('tracking links accept only http(s) and require an AWB placeholder', () => {
  assert.equal(
    buildTrackingUrl({ providerUrl: 'https://carrier.example/track/123', awb: '123' }),
    'https://carrier.example/track/123'
  )
  assert.equal(
    buildTrackingUrl({ awb: 'AB 12', template: 'https://track.example/{awb}' }),
    'https://track.example/AB%2012'
  )
  assert.equal(buildTrackingUrl({ providerUrl: 'javascript:alert(1)', awb: '1' }), null)
  assert.equal(buildTrackingUrl({ awb: '1', template: 'https://track.example/static' }), null)
})

test('parcel profile rejects quantities that could corrupt provider requests', () => {
  assert.deepEqual(parcelProfileForItems([{ quantity: 2 }, { quantity: 1 }]), {
    totalUnits: 3,
    weightGrams: 450,
    dimensionsCm: { length: 15, breadth: 12, height: 8 },
  })
  assert.throws(() => parcelProfileForItems([{ quantity: -1 }]), /positive integer/)
  assert.throws(() => parcelProfileForItems([{ quantity: 101 }]), /between 1 and 100/)
})

test('provider errors expose only redacted diagnostic text', () => {
  const error = new ProshipError({
    message: 'Shipping provider rejected the request',
    status: 502,
    operation: 'POST /api/order/create',
    providerMessage: 'Authorization: Bearer abc.secret token=topsecret buyer@example.com +919876543210',
    outcomeUnknown: true,
  })
  const log = error.toSafeLog()
  assert.doesNotMatch(String(log.providerMessage), /abc\.secret|topsecret|buyer@example\.com|9876543210/)
  assert.equal(log.outcomeUnknown, true)
})

test('shipment lookup fails closed on malformed provider rows', () => {
  const valid = {
    reference: 'NP-20260830-TEST',
    orderId: 'provider-order-1',
    awbNumber: 'AWB-1',
    currentStatus: 'BOOKED',
  }
  assert.deepEqual(parseShipmentLookupResponse([valid]), [valid])
  assert.throws(
    () => parseShipmentLookupResponse([valid, { reference: 'NP-20260830-TEST' }]),
    /malformed shipment lookup row/
  )
  assert.throws(() => parseShipmentLookupResponse({ result: [] }), /invalid shipment lookup response/)
})
