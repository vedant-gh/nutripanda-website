import { NextResponse } from 'next/server'
import { getOrderById, finalizeRazorpayPayment } from '@/lib/supabase/queries'
import { verifyRazorpaySignature } from '@/lib/razorpay/utils'
import {
  RazorpayPaymentStateError,
  verifyCapturedRazorpayPayment,
} from '@/lib/razorpay/payment-state'
import {
  CheckoutValidationError,
  readCheckoutJson,
} from '@/lib/orders/checkout-validation'
import { createOrderAccessToken, hasOrderAccessSecret } from '@/lib/orders/access-token'
import { createShipmentForOrder, liveShipmentsEnabled } from '@/lib/proship/fulfillment'

export const runtime = 'nodejs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RAZORPAY_ORDER_PATTERN = /^order_[A-Za-z0-9]{8,64}$/
const RAZORPAY_PAYMENT_PATTERN = /^pay_[A-Za-z0-9]{8,64}$/
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i

interface VerificationRequest {
  order_id: string
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

function parseVerificationRequest(value: unknown): VerificationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CheckoutValidationError('Invalid payment details')
  }
  const body = value as Record<string, unknown>
  const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : ''
  const razorpayOrderId =
    typeof body.razorpay_order_id === 'string' ? body.razorpay_order_id.trim() : ''
  const paymentId =
    typeof body.razorpay_payment_id === 'string' ? body.razorpay_payment_id.trim() : ''
  const signature =
    typeof body.razorpay_signature === 'string' ? body.razorpay_signature.trim() : ''

  if (
    !UUID_PATTERN.test(orderId) ||
    !RAZORPAY_ORDER_PATTERN.test(razorpayOrderId) ||
    !RAZORPAY_PAYMENT_PATTERN.test(paymentId) ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    throw new CheckoutValidationError('Invalid payment details')
  }
  return {
    order_id: orderId,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  }
}

export async function POST(request: Request) {
  try {
    const payment = parseVerificationRequest(await readCheckoutJson(request))
    if (!hasOrderAccessSecret()) {
      throw new Error('ORDER_ACCESS_SECRET is not configured')
    }
    const storedOrder = await getOrderById(payment.order_id)

    if (
      !storedOrder ||
      storedOrder.payment_method !== 'prepaid' ||
      !storedOrder.razorpay_order_id ||
      storedOrder.razorpay_order_id !== payment.razorpay_order_id
    ) {
      return NextResponse.json({ error: 'Payment does not match this order' }, { status: 400 })
    }

    // The HMAC is deliberately built with the immutable order ID loaded from
    // our database, never with an order ID trusted from the browser callback.
    if (
      !verifyRazorpaySignature(
        storedOrder.razorpay_order_id,
        payment.razorpay_payment_id,
        payment.razorpay_signature
      )
    ) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
    }

    const verified = await verifyCapturedRazorpayPayment({
      storedOrderId: storedOrder.razorpay_order_id,
      paymentId: payment.razorpay_payment_id,
      expectedAmount: storedOrder.total_amount,
      expectedCurrency: 'INR',
    })

    const result = await finalizeRazorpayPayment({
      order_id: storedOrder.id,
      razorpay_order_id: verified.orderId,
      razorpay_payment_id: verified.paymentId,
      razorpay_signature: payment.razorpay_signature,
      amount: verified.amount,
      currency: verified.currency,
    })

    // Whichever channel wins the atomic finalization (browser or webhook) owns
    // the shipment attempt. The shipment helper has its own durable claim and
    // reference reconciliation, so no second Proship booking can be created.
    if (result.requires_refund) {
      console.error('Captured payment requires a full refund before fulfillment', {
        orderId: result.order.id,
        reason: result.payment_review_reason,
      })
    }

    if (result.newly_finalized && !result.requires_refund && liveShipmentsEnabled()) {
      try {
        await createShipmentForOrder(result.order)
      } catch (error) {
        console.error(`Auto-ship failed for order ${result.order.order_number}:`, error)
      }
    }

    return NextResponse.json({
      success: true,
      order_id: result.order.id,
      order_number: result.order.order_number,
      confirmation_token: createOrderAccessToken(result.order.id),
      idempotent_replay: !result.newly_finalized,
      payment_review_required: result.requires_refund,
      payment_review_reason: result.payment_review_reason,
    })
  } catch (error) {
    if (error instanceof CheckoutValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof RazorpayPaymentStateError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    const message = error instanceof Error ? error.message : ''
    if (message.includes('ORDER_ALREADY_PAID_WITH_DIFFERENT_PAYMENT')) {
      return NextResponse.json({ error: 'Order is already paid' }, { status: 409 })
    }
    if (message.includes('INSUFFICIENT_STOCK_FOR_CAPTURED_PAYMENT')) {
      console.error('Captured payment requires manual stock/refund review:', error)
      return NextResponse.json(
        { error: 'Payment captured; order requires manual review. Please contact support.' },
        { status: 503 }
      )
    }

    console.error('Verify payment error:', error)
    return NextResponse.json(
      { error: 'Payment verification failed' },
      { status: 500 }
    )
  }
}
