import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  consumeCheckoutRateLimit,
  createCodOrderAtomic,
  getOrderByCheckoutIdempotencyKey,
} from '@/lib/supabase/queries'
import { COD_FEE, SHIPPING_COST } from '@/lib/utils/constants'
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

export const runtime = 'nodejs'

const MAX_ORDER_TOTAL = 10_000_000

function codFailure(error: unknown) {
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
      { error: 'An active COD order already exists for these contact details.' },
      { status: 429, headers: { 'Retry-After': '86400' } }
    )
  }
  if (message.includes('CHECKOUT_UNIT_LIMIT')) {
    return NextResponse.json(
      { error: 'Cash on Delivery is limited to 3 units per order' },
      { status: 400 }
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
    const checkout = parseCheckoutRequest(rawCheckout)
    const requestFingerprint = createCheckoutFingerprint(checkout)
    const existing = await getOrderByCheckoutIdempotencyKey(idempotencyKey)
    if (existing) {
      // A COD order is complete as soon as the atomic insert succeeds. Recover
      // it before comparing a re-rendered form/coupon after a lost response.
      if (existing.checkout_request_fingerprint !== requestFingerprint) {
        const safelyFinished = existing.payment_status === 'paid'
          || existing.payment_status === 'refunded'
          || (existing.payment_method === 'cod' && existing.order_status === 'cancelled')
        return NextResponse.json(
          {
            error: safelyFinished
              ? 'A previous checkout on this browser is complete. Submit once more to start this different order.'
              : 'An active checkout on this browser belongs to different details. Restore those details or contact support.',
            code: safelyFinished ? 'checkout_previous_terminal' : 'checkout_payload_changed',
          },
          { status: 409 }
        )
      }
      if (existing.payment_method !== 'cod') {
        const safelyFinished = existing.payment_status === 'paid'
          || existing.payment_status === 'refunded'
        return NextResponse.json(
          {
            error: safelyFinished
              ? 'A previous prepaid checkout is complete. Submit once more to place this COD order.'
              : 'An unresolved prepaid checkout already exists for these details. Finish it or contact support.',
            code: safelyFinished ? 'checkout_previous_terminal' : 'checkout_payload_changed',
          },
          { status: 409 }
        )
      }
      if (existing.payment_status === 'refunded') {
        return NextResponse.json(
          {
            error: 'This COD order was refunded. You can start a new checkout.',
            code: 'checkout_refunded',
          },
          { status: 409 }
        )
      }
      if (existing.order_status === 'cancelled') {
        return NextResponse.json(
          {
            error: 'This COD checkout was cancelled. You can start a new checkout.',
            code: 'checkout_not_payable',
          },
          { status: 409 }
        )
      }
      return NextResponse.json({
        order_id: existing.id,
        order_number: existing.order_number,
        confirmation_token: createOrderAccessToken(existing.id),
        recovery_state: 'cod',
        idempotent_replay: true,
      })
    }

    if (checkout.items.reduce((sum, item) => sum + item.quantity, 0) > 3) {
      throw new CheckoutValidationError('Cash on Delivery is limited to 3 units per order')
    }

    const clientIp = getClientIp(request)
    const [phoneAllowed, ipAllowed] = await Promise.all([
      consumeCheckoutRateLimit({
        scope_key: createRateLimitScope('phone', checkout.customer.phone),
        action: 'cod_order',
        limit: 1,
        window_seconds: 60 * 60,
      }),
      consumeCheckoutRateLimit({
        scope_key: createRateLimitScope('ip', clientIp),
        action: 'cod_order',
        limit: 3,
        window_seconds: 60 * 60,
      }),
    ])

    if (!phoneAllowed || !ipAllowed) {
      return NextResponse.json(
        { error: 'Too many COD attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '3600' } }
      )
    }

    const supabase = getSupabaseAdmin()
    const { items, subtotal } = await loadCanonicalCart(supabase, checkout.items)
    const coupon = await resolveCheckoutDiscount(supabase, checkout.couponCode, subtotal)
    const totalAmount = subtotal + SHIPPING_COST + COD_FEE - coupon.discount

    if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0 || totalAmount > MAX_ORDER_TOTAL) {
      throw new CheckoutValidationError('Order total is outside the supported range')
    }

    await assertCheckoutServiceable({
      pincode: checkout.shippingAddress.pincode,
      paymentMethod: 'cod',
      items,
      totalAmountPaise: totalAmount,
    })

    const { order, created } = await createCodOrderAtomic({
      customer_name: checkout.customer.name,
      customer_email: checkout.customer.email,
      customer_phone: checkout.customer.phone,
      customer_whatsapp_opted_in: checkout.customer.whatsappOptIn,
      shipping_address: checkout.shippingAddress,
      items,
      subtotal,
      shipping_cost: SHIPPING_COST,
      discount: coupon.discount,
      cod_fee: COD_FEE,
      payment_method: 'cod',
      total_amount: totalAmount,
      coupon_code: coupon.couponCode,
      lead_coupon_code: coupon.leadCouponCode,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
    })

    return NextResponse.json({
      order_id: order.id,
      order_number: order.order_number,
      confirmation_token: createOrderAccessToken(order.id),
      idempotent_replay: !created,
    })
  } catch (error) {
    const response = codFailure(error)
    if (response) return response

    console.error('COD order error:', error)
    return NextResponse.json(
      { error: 'Failed to place order. Please try again.' },
      { status: 500 }
    )
  }
}
