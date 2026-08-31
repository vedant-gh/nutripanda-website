import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getRazorpayInstance } from '@/lib/razorpay/utils'
import {
  consumeCheckoutRateLimit,
  getOrderByCheckoutIdempotencyKey,
  hasActivePrepaidReservations,
  renewPrepaidCheckoutReservation,
  reservePrepaidOrder,
} from '@/lib/supabase/queries'
import { SHIPPING_COST } from '@/lib/utils/constants'
import {
  CheckoutValidationError,
  createCheckoutFingerprint,
  createRateLimitScope,
  getClientIp,
  parseCheckoutRequest,
  parseIdempotencyKey,
  readCheckoutJson,
} from '@/lib/orders/checkout-validation'
import {
  loadCanonicalCart,
  resolveCheckoutDiscount,
} from '@/lib/orders/checkout-pricing'
import {
  assertCheckoutServiceable,
  ServiceabilityError,
} from '@/lib/proship/serviceability'
import { createOrderAccessToken, hasOrderAccessSecret } from '@/lib/orders/access-token'
import {
  checkoutTurnstileToken,
  TurnstileError,
  verifyCheckoutTurnstile,
} from '@/lib/security/turnstile'

export const runtime = 'nodejs'

const MAX_ORDER_TOTAL = 10_000_000 // ₹1,00,000 in paise

function paidCheckoutRecovery(order: Awaited<ReturnType<typeof getOrderByCheckoutIdempotencyKey>>) {
  if (!order || order.payment_status !== 'paid') return null
  return NextResponse.json({
    order_id: order.id,
    order_number: order.order_number,
    confirmation_token: createOrderAccessToken(order.id),
    recovery_state: order.payment_review_required ? 'payment_review' : 'paid',
    payment_review_required: order.payment_review_required,
    idempotent_replay: true,
  })
}

function checkoutFailure(error: unknown) {
  if (error instanceof TurnstileError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof CheckoutValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof ServiceabilityError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  const message = error instanceof Error ? error.message : ''
  if (message.includes('INSUFFICIENT_STOCK')) {
    return NextResponse.json({ error: 'One or more products are out of stock' }, { status: 409 })
  }
  if (message.includes('COUPON_')) {
    return NextResponse.json({ error: 'Coupon is no longer available' }, { status: 409 })
  }
  if (message.includes('IDEMPOTENCY_KEY_REUSED')) {
    return NextResponse.json(
      { error: 'This checkout key was already used for a different order' },
      { status: 409 }
    )
  }
  if (message.includes('CHECKOUT_ACTIVE_LIMIT')) {
    return NextResponse.json(
      { error: 'An active order already exists for these contact details. Complete or cancel it before trying again.' },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }
  if (message.includes('CHECKOUT_UNIT_LIMIT')) {
    return NextResponse.json(
      { error: 'Checkout cannot contain more than 6 units' },
      { status: 400 }
    )
  }
  if (message.includes('checkout_cannot_be_renewed')) {
    return NextResponse.json(
      {
        error: 'This payment attempt is too old or no longer renewable. Contact support before starting another payment.',
        code: 'checkout_reconciliation_required',
      },
      { status: 409 }
    )
  }
  return null
}

export async function POST(request: Request) {
  try {
    const rawCheckout = await readCheckoutJson(request)
    if (!hasOrderAccessSecret()) {
      throw new Error('ORDER_ACCESS_SECRET is not configured')
    }
    const idempotencyKey = parseIdempotencyKey(request, true)!
    const supabase = getSupabaseAdmin()
    const checkout = parseCheckoutRequest(rawCheckout)
    const requestFingerprint = createCheckoutFingerprint(checkout)

    // A stored browser key may outlive the person/form that created it. Never
    // expose or silently recover a prior order until the normalized payload is
    // proven to match; mismatches get a non-sensitive conflict instead.
    const existing = await getOrderByCheckoutIdempotencyKey(idempotencyKey)
    if (existing && existing.checkout_request_fingerprint !== requestFingerprint) {
      const safelyFinished = existing.payment_status === 'paid'
        || existing.payment_status === 'refunded'
        || (existing.payment_method === 'cod' && existing.order_status === 'cancelled')
      return NextResponse.json(
        {
          error: safelyFinished
            ? 'A previous checkout on this browser is complete. Submit once more to start this different order.'
            : 'An unresolved checkout on this browser belongs to different details. Restore those details or contact support.',
          code: safelyFinished ? 'checkout_previous_terminal' : 'checkout_payload_changed',
        },
        { status: 409 }
      )
    }

    const recovery = paidCheckoutRecovery(existing)
    if (recovery) return recovery
    if (existing?.payment_status === 'refunded') {
      return NextResponse.json(
        {
          error: 'This payment was refunded. Submit once more to start a new checkout.',
          code: 'checkout_previous_terminal',
        },
        { status: 409 }
      )
    }

    // Avoid creating an orphan Razorpay order on a client retry.
    if (existing) {
        if (existing.payment_method !== 'prepaid') {
          return NextResponse.json(
            { error: 'This checkout key was already used for a different order' },
            { status: 409 }
          )
        }
        if (existing.payment_status !== 'pending'
          || existing.order_status === 'cancelled'
          || !existing.razorpay_order_id) {
          return NextResponse.json(
            {
              error: 'This checkout can no longer be paid safely. Contact support before attempting another payment.',
              code: 'checkout_reconciliation_required',
            },
            { status: 409 }
          )
        }
        if (existing.checkout_request_fingerprint !== requestFingerprint) {
          return NextResponse.json(
            {
              error: 'An active checkout already exists for different details. Use the original details or wait for it to expire.',
              code: 'checkout_payload_changed',
            },
            { status: 409 }
          )
        }
        if (!(await hasActivePrepaidReservations(existing))) {
          await assertCheckoutServiceable({
            pincode: existing.shipping_address.pincode,
            paymentMethod: 'prepaid',
            items: existing.items,
            totalAmountPaise: existing.total_amount,
          })
          try {
            await renewPrepaidCheckoutReservation(existing.id, requestFingerprint)
          } catch (error) {
            const latest = await getOrderByCheckoutIdempotencyKey(idempotencyKey)
            const concurrentRecovery = paidCheckoutRecovery(latest)
            if (concurrentRecovery) return concurrentRecovery
            throw error
          }
        }
        return NextResponse.json({
          order_id: existing.id,
          order_number: existing.order_number,
          razorpay_order_id: existing.razorpay_order_id,
          amount: existing.total_amount,
          currency: existing.currency ?? 'INR',
          key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
          idempotent_replay: true,
        })
    }

    const clientIp = getClientIp(request)
    await verifyCheckoutTurnstile({
      token: checkoutTurnstileToken(rawCheckout),
      remoteIp: clientIp,
    })

    const [phoneAllowed, ipAllowed] = await Promise.all([
      consumeCheckoutRateLimit({
        scope_key: createRateLimitScope('phone', checkout.customer.phone),
        action: 'prepaid_order',
        limit: 4,
        window_seconds: 60 * 60,
      }),
      consumeCheckoutRateLimit({
        scope_key: createRateLimitScope('ip', clientIp),
        action: 'prepaid_order',
        limit: 8,
        window_seconds: 60 * 60,
      }),
    ])
    if (!phoneAllowed || !ipAllowed) {
      return NextResponse.json(
        { error: 'Too many checkout attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '3600' } }
      )
    }

    const { items, subtotal } = await loadCanonicalCart(supabase, checkout.items)
    const coupon = await resolveCheckoutDiscount(supabase, checkout.couponCode, subtotal)
    const totalAmount = subtotal + SHIPPING_COST - coupon.discount

    if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0 || totalAmount > MAX_ORDER_TOTAL) {
      throw new CheckoutValidationError('Order total is outside the supported range')
    }

    await assertCheckoutServiceable({
      pincode: checkout.shippingAddress.pincode,
      paymentMethod: 'prepaid',
      items,
      totalAmountPaise: totalAmount,
    })

    const razorpay = getRazorpayInstance()
    const razorpayOrder = await razorpay.orders.create({
      amount: totalAmount,
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
    })

    if (
      !razorpayOrder.id?.startsWith('order_') ||
      Number(razorpayOrder.amount) !== totalAmount ||
      razorpayOrder.currency !== 'INR'
    ) {
      throw new Error('Razorpay returned an invalid order')
    }

    const { order } = await reservePrepaidOrder({
      customer_name: checkout.customer.name,
      customer_email: checkout.customer.email,
      customer_phone: checkout.customer.phone,
      customer_whatsapp_opted_in: checkout.customer.whatsappOptIn,
      shipping_address: checkout.shippingAddress,
      items,
      subtotal,
      shipping_cost: SHIPPING_COST,
      discount: coupon.discount,
      total_amount: totalAmount,
      razorpay_order_id: razorpayOrder.id,
      coupon_code: coupon.couponCode,
      lead_coupon_code: coupon.leadCouponCode,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
    })

    // A concurrent retry/cancellation can win the idempotency-key conflict
    // after the provider order was created. Never hand an old, cancelled, or
    // expired Razorpay order back to the browser.
    const postReserveRecovery = paidCheckoutRecovery(order)
    if (postReserveRecovery) return postReserveRecovery
    if (order.payment_status === 'refunded') {
      return NextResponse.json(
        {
          error: 'This payment was refunded. Contact support before starting another payment.',
          code: 'checkout_refunded',
        },
        { status: 409 }
      )
    }
    if (
      order.payment_status !== 'pending'
      || order.order_status === 'cancelled'
      || !order.razorpay_order_id
      || !(await hasActivePrepaidReservations(order))
    ) {
      return NextResponse.json(
        {
          error: 'This checkout can no longer be paid safely. Contact support before attempting another payment.',
          code: 'checkout_reconciliation_required',
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      order_id: order.id,
      order_number: order.order_number,
      razorpay_order_id: order.razorpay_order_id,
      amount: order.total_amount,
      currency: order.currency ?? 'INR',
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    })
  } catch (error) {
    const response = checkoutFailure(error)
    if (response) return response

    console.error('Create order error:', error)
    return NextResponse.json(
      { error: 'Failed to create order. Please try again.' },
      { status: 500 }
    )
  }
}
