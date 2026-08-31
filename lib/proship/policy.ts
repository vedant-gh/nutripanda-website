export interface ShipmentEligibilityInput {
  payment_method: 'prepaid' | 'cod'
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded'
  order_status: 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
  payment_review_required?: boolean
  fulfillment_review_required?: boolean
}

type ShipmentLookupRow = Record<string, unknown> & {
  reference: string
  orderId: string
  awbNumber: string
  currentStatus: string
}

export function parseShipmentLookupResponse(result: unknown): ShipmentLookupRow[] {
  if (!Array.isArray(result)) {
    throw new Error('Shipping provider returned an invalid shipment lookup response')
  }
  for (const shipment of result) {
    if (
      !shipment
      || typeof shipment !== 'object'
      || Array.isArray(shipment)
      || typeof shipment.reference !== 'string'
      || !shipment.reference.trim()
      || typeof shipment.orderId !== 'string'
      || !shipment.orderId.trim()
      || typeof shipment.awbNumber !== 'string'
      || !shipment.awbNumber.trim()
      || typeof shipment.currentStatus !== 'string'
      || !shipment.currentStatus.trim()
    ) {
      // Never turn provider schema drift into an apparent "no shipment" result:
      // callers use an empty list as proof that cancellation/restocking is safe.
      throw new Error('Shipping provider returned a malformed shipment lookup row')
    }
  }
  return result as ShipmentLookupRow[]
}

export function shipmentIneligibilityReason(order: ShipmentEligibilityInput): string | null {
  if (order.order_status === 'cancelled') return 'Cancelled orders cannot be shipped'
  if (order.order_status === 'delivered') return 'Delivered orders cannot be shipped again'
  if (order.order_status === 'shipped') return 'This order is already marked as shipped'
  if (order.payment_status === 'refunded') return 'Refunded orders cannot be shipped'
  if (order.payment_status === 'failed') return 'Orders with failed payment cannot be shipped'
  if (order.payment_review_required) return 'Payment review must be resolved before shipping'
  if (order.fulfillment_review_required) {
    return 'Fulfillment or inventory review must be resolved before shipping'
  }
  if (order.payment_method === 'prepaid' && order.payment_status !== 'paid') {
    return 'Prepaid orders must have a captured payment before shipment creation'
  }
  return null
}

export function normalizeShipmentStatus(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
}

const DELIVERED_STATUSES = new Set(['DELIVERED', 'DELIVERY_COMPLETE'])
const CANCELLED_STATUSES = new Set(['CANCELLED', 'CANCELED', 'ORDER_CANCELLED'])
const SHIPPED_STATUSES = new Set([
  'SHIPPED',
  'PICKED_UP',
  'PICKUP_COMPLETE',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
])

export function orderStatusFromShipmentStatus(
  current: ShipmentEligibilityInput['order_status'],
  providerStatus: string | null | undefined
): ShipmentEligibilityInput['order_status'] | null {
  const normalized = normalizeShipmentStatus(providerStatus)
  if (!normalized) return null

  // A real delivery after local cancellation is a reconciliation incident, not
  // a normal state transition. Pass it to the database so inventory can be
  // compensated once and the order can be visibly flagged for review.
  if (current === 'cancelled' && DELIVERED_STATUSES.has(normalized)) return 'delivered'
  // Historical local cancellations with an AWB are not trusted until Proship
  // independently confirms the carrier-side cancellation.
  if (current === 'cancelled' && CANCELLED_STATUSES.has(normalized)) return 'cancelled'
  if (current === 'delivered' || current === 'cancelled') return null
  if (DELIVERED_STATUSES.has(normalized)) return 'delivered'
  if (CANCELLED_STATUSES.has(normalized)) return 'cancelled'
  if (SHIPPED_STATUSES.has(normalized) && current !== 'shipped') return 'shipped'
  return null
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function buildTrackingUrl(input: {
  providerUrl?: string | null
  awb: string
  template?: string | null
}): string | null {
  const providerUrl = safeHttpUrl(input.providerUrl)
  if (providerUrl) return providerUrl
  if (!input.template?.includes('{awb}')) return null
  return safeHttpUrl(input.template.replaceAll('{awb}', encodeURIComponent(input.awb)))
}
