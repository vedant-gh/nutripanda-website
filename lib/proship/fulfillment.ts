import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Order } from '@/types/supabase'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getOrderById } from '@/lib/supabase/queries'
import {
  cancelShipment,
  createForwardShipment,
  getShipment,
  orderToForwardShipment,
} from './index'
import { ProshipError } from './client'
import { assertOrderServiceable } from './serviceability'
import {
  buildTrackingUrl,
  orderStatusFromShipmentStatus,
  shipmentIneligibilityReason,
} from './policy'
import type { ProshipCreateResult, ProshipShipment } from './types'

export class ShipmentError extends Error {
  status: number
  code: string
  constructor(message: string, status = 500, code = 'shipment_error') {
    super(message)
    this.name = 'ShipmentError'
    this.status = status
    this.code = code
  }
}

export function liveShipmentsEnabled(): boolean {
  return process.env.PROSHIP_LIVE_SHIPMENTS === 'true'
}

export interface CreateShipmentResult {
  order: Order
  shipment?: ProshipShipment
  alreadyExisted: boolean
  disposition: 'created' | 'reconciled' | 'already_booked'
}

export interface CancelOrderResult {
  order: Order
  alreadyCancelled: boolean
  carrierCancellationRequested: boolean
}

type BookingClaimStatus =
  | 'claimed'
  | 'reconcile_only'
  | 'already_booked'
  | 'in_progress'
  | 'ineligible'
  | 'not_found'

interface BookingClaim {
  status: BookingClaimStatus
  order?: Order
}

type CancellationClaimStatus =
  | 'claimed'
  | 'already_cancelled'
  | 'in_progress'
  | 'ineligible'
  | 'refund_required'
  | 'reconciliation_required'
  | 'not_found'

interface CancellationClaim {
  status: CancellationClaimStatus
  order?: Order
}

type RefundHoldClaimStatus =
  | 'claimed'
  | 'already_stopped'
  | 'in_progress'
  | 'ineligible'
  | 'reconciliation_required'
  | 'not_found'

interface RefundHoldClaim {
  status: RefundHoldClaimStatus
  order?: Order
}

function unwrapRpcRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(name, args)
  if (error) throw error
  const value = unwrapRpcRow(data as T | T[] | null)
  if (!value) throw new Error(`${name} returned no result`)
  return value
}

function matchingShipment(order: Order, shipments: ProshipShipment[]): ProshipShipment | undefined {
  const matches = shipments.filter((shipment) => shipment.reference === order.order_number)
  if (matches.length > 1) {
    throw new ShipmentError(
      'Multiple Proship shipments share this order reference. Reconcile every AWB in Proship before continuing.',
      409,
      'multiple_shipments'
    )
  }
  const match = matches[0]
  if (!match) return undefined
  if (order.awb_number && match.awbNumber !== order.awb_number) {
    throw new ShipmentError(
      'Proship returned an AWB that conflicts with the stored shipment. Reconcile it manually.',
      409,
      'shipment_awb_conflict'
    )
  }
  return match
}

async function lookupShipment(order: Order): Promise<ProshipShipment | undefined> {
  const shipments = await getShipment({ reference: order.order_number })
  return matchingShipment(order, shipments)
}

function trackingUrl(shipment: ProshipShipment | undefined, awb: string): string | null {
  return buildTrackingUrl({
    providerUrl: shipment?.trackingUrl ?? shipment?.tracking_url,
    awb,
    template: process.env.PROSHIP_TRACKING_URL_TEMPLATE,
  })
}

function completionArgs(input: {
  order: Order
  token: string
  created?: ProshipCreateResult
  shipment?: ProshipShipment
}): Record<string, unknown> {
  const awb = input.created?.awb_number ?? input.shipment?.awbNumber
  const providerOrderId = input.created?.orderId ?? input.shipment?.orderId
  if (!awb || !providerOrderId) {
    throw new ShipmentError('Proship did not return a complete shipment reference', 502, 'invalid_provider_response')
  }
  return {
    p_order_id: input.order.id,
    p_claim_token: input.token,
    p_reference: input.order.order_number,
    p_proship_order_id: providerOrderId,
    p_awb_number: awb,
    p_courier_name: input.shipment?.courierParentName ?? null,
    p_label_url: input.created?.label_url ?? input.shipment?.labelUrl ?? null,
    p_tracking_url: trackingUrl(input.shipment, awb),
    p_shipment_status: input.shipment?.currentStatus ?? input.created?.orderStatus ?? 'BOOKED',
  }
}

async function completeBooking(input: {
  order: Order
  token: string
  created?: ProshipCreateResult
  shipment?: ProshipShipment
}): Promise<Order> {
  const completed = await rpc<Order>('shipping_complete_booking', completionArgs(input))

  if (completed.shipment_booking_state === 'cancel_uncertain') {
    try {
      const cancellation = await cancelOrderSafely(completed.id)
      if (cancellation.order.order_status === 'cancelled') {
        throw new ShipmentError(
          'The order became ineligible while Proship was booking it. The carrier shipment was cancelled safely.',
          409,
          'booking_cancelled_after_state_change'
        )
      }
    } catch (error) {
      if (
        error instanceof ShipmentError
        && error.code === 'booking_cancelled_after_state_change'
      ) {
        throw error
      }
      console.error('Unable to automatically cancel an ineligible completed booking', {
        orderId: completed.id,
        name: error instanceof Error ? error.name : 'UnknownError',
      })
      throw new ShipmentError(
        'The order changed while Proship was booking it. The AWB was preserved, but carrier cancellation must be reconciled before retrying.',
        409,
        'cancellation_required'
      )
    }
  }

  return completed
}

async function failBooking(
  orderId: string,
  token: string,
  outcomeUnknown: boolean,
  safeError: string
): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc('shipping_fail_booking', {
    p_order_id: orderId,
    p_claim_token: token,
    p_outcome_unknown: outcomeUnknown,
    p_safe_error: safeError,
  })
  if (error) console.error('Unable to persist shipment booking failure', { orderId, code: error.code })
}

/**
 * Atomically claims booking ownership, reconciles by merchant order reference,
 * then (and only then) creates a shipment. An uncertain POST is never retried
 * automatically because its first request may have reached Proship.
 */
export async function createShipmentForOrder(orderInput: Order): Promise<CreateShipmentResult> {
  const eligibilityError = shipmentIneligibilityReason(orderInput)
  if (eligibilityError) throw new ShipmentError(eligibilityError, 409, 'ineligible')

  const token = randomUUID()
  const claim = await rpc<BookingClaim>('shipping_claim_booking', {
    p_order_id: orderInput.id,
    p_claim_token: token,
  })

  if (claim.status === 'not_found') throw new ShipmentError('Order not found', 404, 'not_found')
  if (claim.status === 'in_progress') {
    throw new ShipmentError('Shipment booking is already in progress. Try syncing shortly.', 409, 'in_progress')
  }
  if (claim.status === 'ineligible') {
    const reason = claim.order ? shipmentIneligibilityReason(claim.order) : null
    throw new ShipmentError(reason ?? 'Order is not eligible for shipment', 409, 'ineligible')
  }
  if (claim.status === 'already_booked' && claim.order) {
    return { order: claim.order, alreadyExisted: true, disposition: 'already_booked' }
  }
  if (!claim.order) throw new ShipmentError('Shipment claim returned no order', 500, 'invalid_claim')

  const order = claim.order
  let createAttempted = false
  let created: ProshipCreateResult | undefined

  try {
    // Recovery always precedes create, including the very first attempt. This
    // also adopts shipments created outside the app using the same reference.
    const recovered = await lookupShipment(order)
    if (recovered) {
      const updated = await completeBooking({ order, token, shipment: recovered })
      return { order: updated, shipment: recovered, alreadyExisted: true, disposition: 'reconciled' }
    }

    if (claim.status === 'reconcile_only') {
      await failBooking(order.id, token, true, 'Shipment outcome remains uncertain after reference reconciliation')
      throw new ShipmentError(
        'A previous booking may have reached Proship. No second shipment was created; sync the order or check Proship by order reference.',
        409,
        'reconciliation_required'
      )
    }

    await assertOrderServiceable(order)
    createAttempted = true
    created = await createForwardShipment(orderToForwardShipment(order))
    if (created.reference && created.reference !== order.order_number) {
      throw new ShipmentError('Proship returned a mismatched order reference', 502, 'reference_mismatch')
    }

    let readback: ProshipShipment | undefined
    try {
      readback = await lookupShipment(order)
    } catch (error) {
      if (error instanceof ProshipError) {
        console.warn('Shipment readback deferred', error.toSafeLog())
      }
    }

    const updated = await completeBooking({ order, token, created, shipment: readback })
    return { order: updated, shipment: readback, alreadyExisted: false, disposition: 'created' }
  } catch (error) {
    if (
      error instanceof ShipmentError
      && (
        error.code === 'booking_cancelled_after_state_change'
        || error.code === 'cancellation_required'
      )
    ) {
      throw error
    }

    // If create returned/failed ambiguously, one final reference lookup may
    // recover the AWB. Never issue another create from this request.
    if (createAttempted) {
      try {
        const recovered = await lookupShipment(order)
        if (recovered) {
          const updated = await completeBooking({ order, token, created, shipment: recovered })
          return { order: updated, shipment: recovered, alreadyExisted: true, disposition: 'reconciled' }
        }
      } catch (recoveryError) {
        if (recoveryError instanceof ShipmentError) {
          await failBooking(
            order.id,
            token,
            true,
            'Multiple or conflicting Proship shipments require manual reconciliation'
          )
          throw recoveryError
        }
        if (recoveryError instanceof ProshipError) {
          console.warn('Post-create shipment reconciliation failed', recoveryError.toSafeLog())
        }
      }
    }

    const providerUnknown = error instanceof ProshipError && error.outcomeUnknown
    const explicitReconciliation = error instanceof ShipmentError
      && ['multiple_shipments', 'shipment_awb_conflict'].includes(error.code)
    const outcomeUnknown = explicitReconciliation
      || (createAttempted && (Boolean(created) || providerUnknown || !(error instanceof ProshipError)))
    await failBooking(
      order.id,
      token,
      outcomeUnknown,
      explicitReconciliation
        ? 'Multiple or conflicting Proship shipments require manual reconciliation'
        : outcomeUnknown
          ? 'Shipment creation outcome is uncertain; reconcile before retry'
          : 'Shipment creation was rejected'
    )
    throw error
  }
}

function syncArgs(order: Order, shipment: ProshipShipment): Record<string, unknown> {
  const mappedOrderStatus = orderStatusFromShipmentStatus(order.order_status, shipment.currentStatus)
  return {
    p_order_id: order.id,
    p_reference: order.order_number,
    p_proship_order_id: shipment.orderId,
    p_awb_number: shipment.awbNumber,
    p_courier_name: shipment.courierParentName ?? null,
    p_label_url: shipment.labelUrl ?? null,
    p_tracking_url: trackingUrl(shipment, shipment.awbNumber),
    p_shipment_status: shipment.currentStatus ?? null,
    p_order_status: mappedOrderStatus,
  }
}

/** Secured admin reconciliation primitive used instead of trusting dashboard status text. */
export async function syncShipmentForOrder(order: Order): Promise<{ order: Order; shipment: ProshipShipment }> {
  const shipment = await lookupShipment(order)
  if (!shipment) {
    throw new ShipmentError('No Proship shipment matches this order reference', 404, 'shipment_not_found')
  }
  const updated = await rpc<Order>('shipping_sync_status', syncArgs(order, shipment))
  return { order: updated, shipment }
}

async function reconcileCarrierReferenceBeforeMutation(order: Order): Promise<Order> {
  try {
    return (await syncShipmentForOrder(order)).order
  } catch (error) {
    if (!(error instanceof ShipmentError) || error.code !== 'shipment_not_found') {
      throw error
    }

    const state = order.shipment_booking_state ?? 'idle'
    const noCarrierShipmentIsProven =
      !order.awb_number && ['idle', 'failed', 'cancelled'].includes(state)
    if (noCarrierShipmentIsProven) return order

    throw new ShipmentError(
      'The stored shipment state conflicts with Proship. Reconcile the order reference before changing payment or cancellation state.',
      409,
      'reconciliation_required'
    )
  }
}

/**
 * Stop a paid order's carrier/booking before any refund is recorded. Inventory
 * and local order status remain untouched until the refund is verified.
 */
export async function stopShipmentBeforeRefund(orderId: string): Promise<Order> {
  let current = await getOrderById(orderId)
  if (!current) throw new ShipmentError('Order not found', 404, 'not_found')

  // Reference lookup is deliberately unconditional. It catches an orphan or a
  // duplicate provider shipment even when the local AWB write was lost.
  current = await reconcileCarrierReferenceBeforeMutation(current)
  if (current.payment_status !== 'paid') {
    throw new ShipmentError('A paid order is required', 409, 'ineligible')
  }
  if (current.order_status === 'delivered' || current.shipment_delivered_at) {
    throw new ShipmentError('Delivered orders use the post-delivery refund workflow', 409, 'delivered')
  }

  const token = randomUUID()
  const claim = await rpc<RefundHoldClaim>('shipping_claim_refund_hold', {
    p_order_id: orderId,
    p_claim_token: token,
  })

  if (claim.status === 'not_found') throw new ShipmentError('Order not found', 404, 'not_found')
  if (claim.status === 'already_stopped' && claim.order) return claim.order
  if (claim.status === 'ineligible') {
    throw new ShipmentError('Order is not eligible for a pre-refund shipment stop', 409, 'ineligible')
  }
  if (claim.status === 'in_progress') {
    throw new ShipmentError('Carrier cancellation is already in progress', 409, 'in_progress')
  }
  if (claim.status === 'reconciliation_required') {
    throw new ShipmentError('Reconcile the shipment before issuing a refund', 409, 'reconciliation_required')
  }
  if (!claim.order) throw new ShipmentError('Refund hold returned no order', 500, 'invalid_claim')

  let carrierCallStarted = false
  let carrierAccepted = false
  try {
    if (claim.order.awb_number) {
      carrierCallStarted = true
      await cancelShipment(claim.order.awb_number)
      carrierAccepted = true
    }

    return rpc<Order>('shipping_complete_refund_hold', {
      p_order_id: orderId,
      p_claim_token: token,
    })
  } catch (error) {
    const outcomeUnknown = carrierCallStarted && (
      carrierAccepted || !(error instanceof ProshipError) || error.outcomeUnknown
    )
    const { error: persistError } = await getSupabaseAdmin().rpc('shipping_fail_cancellation', {
      p_order_id: orderId,
      p_claim_token: token,
      p_outcome_unknown: outcomeUnknown,
      p_safe_error: outcomeUnknown
        ? 'Carrier stop outcome is uncertain; reconcile before refunding'
        : 'Carrier rejected the pre-refund cancellation',
    })
    if (persistError) console.error('Unable to persist pre-refund carrier failure', { orderId, code: persistError.code })
    throw error
  }
}

export async function cancelOrderSafely(orderId: string, notes?: string): Promise<CancelOrderResult> {
  let current = await getOrderById(orderId)
  if (!current) throw new ShipmentError('Order not found', 404, 'not_found')

  // Check the immutable reference before every early return. A missing local
  // AWB is not evidence that a provider shipment was never created.
  current = await reconcileCarrierReferenceBeforeMutation(current)
  if (current.shipment_delivered_at || current.order_status === 'delivered') {
    if (current.order_status === 'cancelled') {
      return { order: current, alreadyCancelled: true, carrierCancellationRequested: false }
    }
    throw new ShipmentError('Delivered orders cannot be cancelled', 409, 'delivered')
  }

  if (
    current.payment_status === 'refunded'
    && current.shipment_booking_state === 'cancelled'
    && (!current.awb_number || Boolean(current.shipment_cancelled_at))
  ) {
    const order = await rpc<Order>('shipping_finalize_refunded_cancellation', {
      p_order_id: orderId,
      p_notes: notes?.trim().slice(0, 2000) || null,
    })
    return {
      order,
      alreadyCancelled: current.order_status === 'cancelled',
      carrierCancellationRequested: Boolean(current.awb_number),
    }
  }

  if (
    current.order_status === 'cancelled'
    && current.shipment_booking_state === 'cancelled'
    && (!current.awb_number || Boolean(current.shipment_cancelled_at))
  ) {
    return {
      order: current,
      alreadyCancelled: true,
      carrierCancellationRequested: Boolean(current.awb_number),
    }
  }

  const token = randomUUID()
  const claim = await rpc<CancellationClaim>('shipping_claim_cancellation', {
    p_order_id: orderId,
    p_claim_token: token,
  })
  if (claim.status === 'not_found') throw new ShipmentError('Order not found', 404, 'not_found')
  if (claim.status === 'already_cancelled' && claim.order) {
    return { order: claim.order, alreadyCancelled: true, carrierCancellationRequested: false }
  }
  if (claim.status === 'ineligible') {
    throw new ShipmentError('Delivered orders cannot be cancelled', 409, 'ineligible')
  }
  if (claim.status === 'refund_required') {
    throw new ShipmentError(
      'This order is paid. Reconcile and record its refund before cancellation.',
      409,
      'refund_required'
    )
  }
  if (claim.status === 'in_progress') {
    throw new ShipmentError('Order cancellation is already in progress', 409, 'in_progress')
  }
  if (claim.status === 'reconciliation_required') {
    throw new ShipmentError('Reconcile the shipment before cancelling this order', 409, 'reconciliation_required')
  }
  if (!claim.order) throw new ShipmentError('Cancellation claim returned no order', 500, 'invalid_claim')

  let carrierCallStarted = false
  let carrierAccepted = false
  try {
    if (claim.order.awb_number) {
      carrierCallStarted = true
      await cancelShipment(claim.order.awb_number)
      carrierAccepted = true
    }

    const updated = await rpc<Order>('shipping_complete_cancellation', {
      p_order_id: orderId,
      p_claim_token: token,
      p_notes: notes?.trim().slice(0, 2000) || null,
    })
    return {
      order: updated,
      alreadyCancelled: false,
      carrierCancellationRequested: carrierCallStarted,
    }
  } catch (error) {
    const outcomeUnknown = carrierCallStarted && (
      carrierAccepted || !(error instanceof ProshipError) || error.outcomeUnknown
    )
    const { error: persistError } = await getSupabaseAdmin().rpc('shipping_fail_cancellation', {
      p_order_id: orderId,
      p_claim_token: token,
      p_outcome_unknown: outcomeUnknown,
      p_safe_error: outcomeUnknown
        ? 'Carrier cancellation outcome is uncertain; reconcile before retry'
        : 'Carrier rejected shipment cancellation',
    })
    if (persistError) console.error('Unable to persist shipment cancellation failure', { orderId, code: persistError.code })
    throw error
  }
}
