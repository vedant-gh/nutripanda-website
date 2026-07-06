// Order → Proship shipment orchestration, shared by the manual admin route and
// the automatic (webhook) path. Keeping this in one place guarantees both routes
// map, create, read back and persist a shipment identically.

import type { Order } from '@/types/supabase'
import { updateOrderShipment } from '@/lib/supabase/queries'
import {
  orderToForwardShipment,
  createForwardShipment,
  getShipment,
} from './index'
import type { ProshipShipment } from './types'

export class ShipmentError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ShipmentError'
    this.status = status
  }
}

/**
 * Production gate for automatic shipment creation.
 *
 * OFF by default (and in local `.env.local`) so test-mode Razorpay checkouts
 * never book real shipments. Set PROSHIP_LIVE_SHIPMENTS=true in production to
 * auto-ship prepaid orders. The manual admin button ignores this flag — it
 * always creates on demand.
 */
export function liveShipmentsEnabled(): boolean {
  return process.env.PROSHIP_LIVE_SHIPMENTS === 'true'
}

export interface CreateShipmentResult {
  order: Order
  shipment?: ProshipShipment
  /** True when the order already had an AWB and nothing new was created. */
  alreadyExisted: boolean
}

/**
 * Create a real Proship shipment for an order and persist the AWB / label /
 * courier onto the order row.
 *
 * Idempotent: if the order already has an AWB it returns immediately without
 * re-creating (protects against webhook retries and double-clicks).
 */
export async function createShipmentForOrder(order: Order): Promise<CreateShipmentResult> {
  if (order.awb_number) {
    return { order, alreadyExisted: true }
  }

  const shippable = order.payment_status === 'paid' || order.payment_method === 'cod'
  if (!shippable) {
    throw new ShipmentError('Order is not paid yet — cannot create a shipment', 400)
  }

  // 1) Create on Proship.
  const payload = orderToForwardShipment(order)
  const created = await createForwardShipment(payload)
  if (!created?.awb_number) {
    throw new ShipmentError(
      'Shipment was submitted but Proship did not return an AWB. Check the Proship panel and retry.',
      502
    )
  }

  // 2) Best-effort readback (external view) to enrich the human courier name and
  //    live status. The create response is authoritative for AWB + label, so a
  //    failed/empty readback must not fail the booking.
  let shipment: ProshipShipment | undefined
  try {
    shipment = (await getShipment({ reference: order.order_number }))[0]
  } catch {
    shipment = undefined
  }

  // 3) Persist (create response is authoritative; readback only enriches).
  const updated = await updateOrderShipment(order.id, {
    proship_order_id: created.orderId ?? shipment?.orderId ?? null,
    awb_number: created.awb_number,
    courier_name: shipment?.courierParentName ?? null,
    shipping_label_url: created.label_url ?? shipment?.labelUrl ?? null,
    shipment_status: shipment?.currentStatus ?? created.orderStatus ?? null,
  })

  return { order: updated, shipment, alreadyExisted: false }
}
