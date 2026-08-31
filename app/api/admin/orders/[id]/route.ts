import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { getOrderById } from '@/lib/supabase/queries'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { ProshipError } from '@/lib/proship/client'
import {
  cancelOrderSafely,
  ShipmentError,
  stopShipmentBeforeRefund,
} from '@/lib/proship/fulfillment'
import {
  RazorpayPaymentStateError,
  verifyFullyRefundedRazorpayPayment,
} from '@/lib/razorpay/payment-state'
import type { Order } from '@/types/supabase'
import { hasOnlyKeys, isUuid, readBoundedJsonObject } from '@/lib/utils/request-input'

const MAX_BODY_BYTES = 16_384
const ORDER_STATUSES: Order['order_status'][] = [
  'confirmed', 'processing', 'shipped', 'delivered', 'cancelled',
]
const COD_PAYMENT_STATUSES: Order['payment_status'][] = ['paid', 'refunded']

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

function unauthorized(request: Request) {
  return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), request)
}

function shippingFailure(error: unknown, request: Request): NextResponse | null {
  if (error instanceof ShipmentError) {
    return withCors(
      NextResponse.json({ error: error.message, code: error.code }, { status: error.status }),
      request
    )
  }
  if (error instanceof ProshipError) {
    console.error('Carrier operation failed', error.toSafeLog())
    return withCors(
      NextResponse.json(
        { error: 'Carrier request failed. The local order was not cancelled; reconcile before retrying.' },
        { status: error.status === 504 ? 504 : 502 }
      ),
      request
    )
  }
  return null
}

async function orderRpc(name: string, args: Record<string, unknown>): Promise<Order> {
  const { data, error } = await getSupabaseAdmin().rpc(name, args)
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error(`${name} returned no order`)
  return row as Order
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) return unauthorized(request)

  try {
    const { id } = await params
    const order = await getOrderById(id)
    if (!order) {
      return withCors(NextResponse.json({ error: 'Order not found' }, { status: 404 }), request)
    }
    return withCors(
      NextResponse.json({ order }, { headers: { 'Cache-Control': 'private, no-store' } }),
      request
    )
  } catch (error) {
    console.error('Admin order lookup failed', { name: error instanceof Error ? error.name : 'UnknownError' })
    return withCors(NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 }), request)
  }
}

/**
 * Safe dashboard lifecycle API.
 *
 * - order_status follows a forward-only state machine; cancellation calls the
 *   carrier first and restores committed inventory once.
 * - payment_status is accepted only for COD collection (`paid`) or refund.
 *   Prepaid status remains exclusively provider-managed.
 * - one lifecycle transition per request keeps retries unambiguous.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) return unauthorized(request)

  try {
    const { id } = await params
    if (!isUuid(id)) {
      return withCors(NextResponse.json({ error: 'Invalid order ID' }, { status: 400 }), request)
    }
    const parsed = await readBoundedJsonObject(request, { maxBytes: MAX_BODY_BYTES })
    if (!parsed.ok) {
      return withCors(
        NextResponse.json({ error: parsed.error }, { status: parsed.status }),
        request
      )
    }
    const body = parsed.value
    if (!hasOnlyKeys(body, ['action', 'order_status', 'payment_status', 'notes', 'send_notification'])) {
      return withCors(
        NextResponse.json({ error: 'Request contains unsupported fields' }, { status: 400 }),
        request
      )
    }
    const orderStatus = typeof body.order_status === 'string'
      ? body.order_status as Order['order_status']
      : undefined
    const paymentStatus = typeof body.payment_status === 'string'
      ? body.payment_status as Order['payment_status']
      : undefined
    const action = typeof body.action === 'string' ? body.action : undefined

    if (
      action !== undefined
      && ![
        'confirm_return_inventory',
        'confirm_no_legacy_shipment',
        'record_prepaid_refund',
        'resolve_inventory_reconciliation',
      ].includes(action)
    ) {
      return withCors(
        NextResponse.json({ error: 'Invalid order action' }, { status: 400 }),
        request
      )
    }
    if ([Boolean(action), Boolean(orderStatus), Boolean(paymentStatus)].filter(Boolean).length > 1) {
      return withCors(
        NextResponse.json({ error: 'Perform one order action per request' }, { status: 400 }),
        request
      )
    }
    if (!action && !orderStatus && !paymentStatus && body.notes === undefined) {
      return withCors(
        NextResponse.json({ error: 'order_status, payment_status, or notes is required' }, { status: 400 }),
        request
      )
    }
    if (orderStatus && !ORDER_STATUSES.includes(orderStatus)) {
      return withCors(NextResponse.json({ error: 'Invalid order status' }, { status: 400 }), request)
    }
    if (paymentStatus && !COD_PAYMENT_STATUSES.includes(paymentStatus)) {
      return withCors(
        NextResponse.json({ error: 'COD payment status must be paid or refunded' }, { status: 400 }),
        request
      )
    }
    if (body.notes !== undefined && typeof body.notes !== 'string') {
      return withCors(NextResponse.json({ error: 'notes must be text' }, { status: 400 }), request)
    }
    if (typeof body.notes === 'string' && body.notes.length > 2000) {
      return withCors(NextResponse.json({ error: 'notes is too long' }, { status: 400 }), request)
    }
    if (body.send_notification !== undefined && typeof body.send_notification !== 'boolean') {
      return withCors(NextResponse.json({ error: 'send_notification must be boolean' }, { status: 400 }), request)
    }

    const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined
    let order: Order
    if (action === 'confirm_return_inventory') {
      order = await orderRpc('admin_confirm_return_inventory', { p_order_id: id })
    } else if (action === 'confirm_no_legacy_shipment') {
      order = await orderRpc('admin_confirm_no_legacy_shipment', { p_order_id: id })
    } else if (action === 'resolve_inventory_reconciliation') {
      order = await orderRpc('admin_resolve_inventory_reconciliation', {
        p_order_id: id,
        p_notes: notes || null,
      })
    } else if (action === 'record_prepaid_refund') {
      const existing = await getOrderById(id)
      if (!existing) {
        return withCors(NextResponse.json({ error: 'Order not found' }, { status: 404 }), request)
      }
      if (
        existing.payment_method !== 'prepaid'
        || existing.payment_status !== 'paid'
        || (
          existing.order_status !== 'delivered'
          && !existing.shipment_delivered_at
        )
        || !existing.razorpay_order_id
        || !existing.razorpay_payment_id
      ) {
        return withCors(
          NextResponse.json(
            { error: 'Only a delivered paid prepaid order can use this refund action' },
            { status: 409 }
          ),
          request
        )
      }
      const refund = await verifyFullyRefundedRazorpayPayment({
        storedOrderId: existing.razorpay_order_id,
        paymentId: existing.razorpay_payment_id,
        expectedAmount: existing.total_amount,
      })
      order = await orderRpc('admin_record_prepaid_refund', {
        p_order_id: existing.id,
        p_razorpay_order_id: refund.orderId,
        p_razorpay_payment_id: refund.paymentId,
        p_amount: refund.amount,
        p_currency: refund.currency,
      })
    } else if (orderStatus === 'cancelled') {
      order = (await cancelOrderSafely(id, notes)).order
    } else if (orderStatus) {
      order = await orderRpc('admin_transition_order_status', {
        p_order_id: id,
        p_new_status: orderStatus,
        p_notes: notes || null,
      })
    } else if (paymentStatus) {
      const existing = await getOrderById(id)
      if (!existing) {
        return withCors(NextResponse.json({ error: 'Order not found' }, { status: 404 }), request)
      }
      if (
        paymentStatus === 'refunded'
        && existing.payment_method === 'cod'
        && existing.payment_status === 'paid'
        && existing.order_status !== 'delivered'
        && !existing.shipment_delivered_at
      ) {
        await stopShipmentBeforeRefund(id)
      }
      order = await orderRpc('admin_transition_cod_payment', {
        p_order_id: id,
        p_new_payment_status: paymentStatus,
        p_notes: notes || null,
      })
      if (
        paymentStatus === 'refunded'
        && order.order_status !== 'delivered'
        && !order.shipment_delivered_at
      ) {
        order = (await cancelOrderSafely(id, notes)).order
      }
    } else {
      const existing = await getOrderById(id)
      if (!existing) {
        return withCors(NextResponse.json({ error: 'Order not found' }, { status: 404 }), request)
      }
      order = await orderRpc('admin_transition_order_status', {
        p_order_id: id,
        p_new_status: existing.order_status,
        p_notes: notes ?? '',
      })
    }

    let notification: { status: string; deliveryId?: string } | undefined
    if (body.send_notification === true && order.customer_whatsapp_opted_in && orderStatus) {
      const template = orderStatus === 'shipped'
        ? 'shipping_update'
        : orderStatus === 'delivered'
          ? 'delivered'
          : null
      if (template) {
        const { enqueueOrderNotification } = await import('@/lib/notifications/queue')
        notification = await enqueueOrderNotification({
          orderId: order.id,
          channel: 'whatsapp',
          template,
          idempotencyKey: `order:${order.id}:status:${orderStatus}:whatsapp`,
          payload: template === 'shipping_update'
            ? { tracking_link: order.tracking_url ?? undefined }
            : undefined,
        })
      }
    }

    return withCors(NextResponse.json({ order, notification }), request)
  } catch (error) {
    if (error instanceof RazorpayPaymentStateError) {
      return withCors(
        NextResponse.json(
          { error: 'Razorpay does not yet show a completed exact full refund.' },
          { status: 409 }
        ),
        request
      )
    }
    const response = shippingFailure(error, request)
    if (response) return response
    console.error('Admin order transition failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
    })
    return withCors(
      NextResponse.json({ error: 'Order transition was rejected' }, { status: 409 }),
      request
    )
  }
}

// DELETE is intentionally non-destructive. It safely cancels the carrier (if
// any), restores committed inventory once, and retains the financial/audit row.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) return unauthorized(request)

  try {
    const { id } = await params
    const current = await getOrderById(id)
    if (!current) {
      return withCors(NextResponse.json({ error: 'Order not found' }, { status: 404 }), request)
    }

    if (current.order_status === 'delivered') {
      return withCors(
        NextResponse.json(
          { error: 'Delivered orders cannot use the cancellation workflow' },
          { status: 409 }
        ),
        request
      )
    }

    // Stop/reconcile the carrier first while payment and inventory remain
    // committed. Refunds remain an explicit Razorpay-dashboard operation; a
    // second call verifies the exact full refund before final local cancellation.
    if (current.payment_status === 'paid') {
      const stoppedOrder = await stopShipmentBeforeRefund(current.id)
      if (current.payment_method === 'cod') {
        return withCors(
          NextResponse.json({
            success: false,
            refund_required: true,
            refund_method: 'cod',
            order: stoppedOrder,
            error: 'Shipment/booking is stopped. Refund the COD payment, then record that refund in Payment Details.',
          }),
          request
        )
      }
      if (!current.razorpay_order_id || !current.razorpay_payment_id) {
        return withCors(
          NextResponse.json({ error: 'Payment identifiers are missing; reconcile this order manually' }, { status: 409 }),
          request
        )
      }
      let refund
      try {
        refund = await verifyFullyRefundedRazorpayPayment({
          storedOrderId: current.razorpay_order_id,
          paymentId: current.razorpay_payment_id,
          expectedAmount: current.total_amount,
        })
      } catch (error) {
        if (error instanceof RazorpayPaymentStateError) {
          return withCors(
            NextResponse.json({
              success: false,
              refund_required: true,
              order: stoppedOrder,
              error: 'Shipment/booking is stopped. Issue the exact full refund in Razorpay, then retry verification.',
            }),
            request
          )
        }
        throw error
      }
      await orderRpc('admin_record_prepaid_refund', {
        p_order_id: current.id,
        p_razorpay_order_id: refund.orderId,
        p_razorpay_payment_id: refund.paymentId,
        p_amount: refund.amount,
        p_currency: refund.currency,
      })
    }

    const result = await cancelOrderSafely(id)
    return withCors(
      NextResponse.json({
        success: true,
        refund_required: false,
        soft_deleted: true,
        order: result.order,
      }),
      request
    )
  } catch (error) {
    if (error instanceof RazorpayPaymentStateError) {
      return withCors(
        NextResponse.json(
          { error: 'Razorpay does not yet show a completed full refund. Refund it there first, then retry cancellation.' },
          { status: 409 }
        ),
        request
      )
    }
    const response = shippingFailure(error, request)
    if (response) return response
    console.error('Admin soft cancellation failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return withCors(
      NextResponse.json({ error: 'Order could not be safely cancelled' }, { status: 409 }),
      request
    )
  }
}
