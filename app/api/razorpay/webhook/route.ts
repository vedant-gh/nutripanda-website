import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/razorpay/utils'
import { verifyCapturedRazorpayPayment } from '@/lib/razorpay/payment-state'
import {
  finalizeRazorpayPayment,
  getOrderByRazorpayOrderId,
  recordRazorpayPaymentFailure,
} from '@/lib/supabase/queries'
import { createShipmentForOrder, liveShipmentsEnabled } from '@/lib/proship/fulfillment'

export const runtime = 'nodejs'

const MAX_WEBHOOK_BYTES = 256 * 1024
const ORDER_ID_PATTERN = /^order_[A-Za-z0-9]{8,64}$/
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{8,64}$/
const EVENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/

type WebhookRecord = Record<string, unknown>

function isRecord(value: unknown): value is WebhookRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function webhookPayment(payload: unknown): {
  orderId: string
  paymentId: string
} | null {
  if (!isRecord(payload) || !isRecord(payload.payload)) return null
  const paymentWrapper = payload.payload.payment
  if (!isRecord(paymentWrapper) || !isRecord(paymentWrapper.entity)) return null
  const orderId = paymentWrapper.entity.order_id
  const paymentId = paymentWrapper.entity.id
  if (
    typeof orderId !== 'string' ||
    typeof paymentId !== 'string' ||
    !ORDER_ID_PATTERN.test(orderId) ||
    !PAYMENT_ID_PATTERN.test(paymentId)
  ) {
    return null
  }
  return { orderId, paymentId }
}

export async function POST(request: Request) {
  try {
    const declaredLength = Number(request.headers.get('content-length') ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
      return NextResponse.json({ error: 'Webhook is too large' }, { status: 413 })
    }

    const rawBody = await request.text()
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES) {
      return NextResponse.json({ error: 'Webhook is too large' }, { status: 413 })
    }

    const signature = request.headers.get('x-razorpay-signature')?.trim() ?? ''
    if (!signature || !verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawBody) as unknown
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (!isRecord(payload) || typeof payload.event !== 'string') {
      return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 })
    }

    const eventType = payload.event
    if (eventType !== 'payment.captured' && eventType !== 'payment.failed') {
      return NextResponse.json({ status: 'ignored' })
    }

    const payment = webhookPayment(payload)
    if (!payment) {
      return NextResponse.json({ error: 'Missing payment entity' }, { status: 400 })
    }

    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex')
    const headerEventId = request.headers.get('x-razorpay-event-id')?.trim()
    const eventId =
      headerEventId && EVENT_ID_PATTERN.test(headerEventId)
        ? headerEventId
        : `sha256:${payloadHash}`

    if (eventType === 'payment.failed') {
      const result = await recordRazorpayPaymentFailure({
        razorpay_order_id: payment.orderId,
        razorpay_payment_id: payment.paymentId,
        webhook_event_id: eventId,
        webhook_event_type: eventType,
        webhook_payload_hash: payloadHash,
      })
      return NextResponse.json({ status: result.duplicate ? 'already_processed' : 'ok' })
    }

    const storedOrder = await getOrderByRazorpayOrderId(payment.orderId)
    if (!storedOrder || storedOrder.payment_method !== 'prepaid') {
      // The Razorpay order can exist a few milliseconds before our DB order is
      // committed. A retryable response lets Razorpay deliver the event again.
      return NextResponse.json({ error: 'Order is not available yet' }, { status: 503 })
    }

    const verified = await verifyCapturedRazorpayPayment({
      storedOrderId: payment.orderId,
      paymentId: payment.paymentId,
      expectedAmount: storedOrder.total_amount,
      expectedCurrency: 'INR',
    })
    const result = await finalizeRazorpayPayment({
      razorpay_order_id: verified.orderId,
      razorpay_payment_id: verified.paymentId,
      amount: verified.amount,
      currency: verified.currency,
      webhook_event_id: eventId,
      webhook_event_type: eventType,
      webhook_payload_hash: payloadHash,
    })

    if (result.requires_refund) {
      console.error('Captured webhook payment requires a full refund before fulfillment', {
        orderId: result.order.id,
        reason: result.payment_review_reason,
      })
    }

    if (result.newly_finalized && !result.requires_refund && liveShipmentsEnabled()) {
      try {
        await createShipmentForOrder(result.order)
      } catch (error) {
        // Payment is already durable. Shipment state records whether a safe
        // retry/reconciliation is possible, and the dashboard exposes that.
        console.error(`Auto-ship failed for order ${result.order.order_number}:`, error)
      }
    }

    return NextResponse.json({
      status: result.requires_refund
        ? 'refund_required'
        : result.newly_finalized
          ? 'ok'
          : 'already_processed',
    })
  } catch (error) {
    // Never acknowledge an event that failed before durable processing. A
    // non-2xx response makes Razorpay retry instead of silently losing payment.
    console.error('Webhook processing error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
