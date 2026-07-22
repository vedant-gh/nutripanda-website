import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getRazorpayInstance } from '@/lib/razorpay/utils'
import { createOrder, getCouponByCode } from '@/lib/supabase/queries'
import { validateEmail, validatePhone, validatePincode } from '@/lib/utils/validators'
import { SHIPPING_COST } from '@/lib/utils/constants'
import {
  findPublicCoupon,
  computePublicCouponDiscount,
  computeDbCouponDiscount,
} from '@/lib/utils/coupons'
import type { OrderItem, ShippingAddress } from '@/types/supabase'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      customer,
      shippingAddress,
      items,
      couponCode,
    } = body as {
      customer: { name: string; email: string; phone: string; whatsappOptIn?: boolean }
      shippingAddress: ShippingAddress
      items: OrderItem[]
      couponCode?: string
    }

    // ── Validate inputs ──
    if (!customer?.name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (!validateEmail(customer.email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }
    if (!validatePhone(customer.phone)) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }
    if (!shippingAddress?.line1 || !shippingAddress.city || !shippingAddress.state || !validatePincode(shippingAddress.pincode)) {
      return NextResponse.json({ error: 'Invalid shipping address' }, { status: 400 })
    }
    if (!items?.length) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    }

    // Map to internal field names
    const customer_name = customer.name.trim()
    const customer_email = customer.email.trim().toLowerCase()
    const customer_phone = customer.phone.trim()
    const customer_whatsapp_opted_in = customer.whatsappOptIn ?? false
    const shipping_address = shippingAddress
    const coupon_code = couponCode

    // ── Verify prices & stock against DB ──
    const supabase = getSupabaseAdmin()
    const productIds = items.map((item) => item.productId)
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, price, inventory_count, is_active')
      .in('id', productIds)

    if (productsError) throw productsError

    const productMap = new Map(products?.map((p) => [p.id, p]))

    for (const item of items) {
      const product = productMap.get(item.productId)
      if (!product || !product.is_active) {
        return NextResponse.json(
          { error: `Product "${item.name}" is no longer available` },
          { status: 400 }
        )
      }
      if (product.price !== item.price) {
        return NextResponse.json(
          { error: `Price has changed for "${item.name}". Please refresh and try again.` },
          { status: 400 }
        )
      }
      if (product.inventory_count < item.quantity) {
        return NextResponse.json(
          { error: `Insufficient stock for "${item.name}". Only ${product.inventory_count} left.` },
          { status: 400 }
        )
      }
    }

    // ── Calculate totals ──
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    let discount = 0
    let isLeadCoupon = false

    if (coupon_code) {
      // Public sitewide coupon (e.g. PANDA150) — re-validated here so the
      // charged amount is never trusted from the client.
      const publicCoupon = findPublicCoupon(coupon_code)
      if (publicCoupon) {
        const result = computePublicCouponDiscount(publicCoupon, subtotal)
        if (result.ok) discount = result.discount
      } else {
        // Admin-managed reusable coupon (percentage or fixed)
        const adminCoupon = await getCouponByCode(coupon_code)
        if (adminCoupon) {
          const result = computeDbCouponDiscount(adminCoupon, subtotal)
          if (result.ok) discount = result.discount
        } else {
          // Single-use lead coupon (percent-based)
          const { data: coupon } = await supabase
            .from('coupon_leads')
            .select('discount_percent, is_used')
            .eq('coupon_code', coupon_code)
            .single()

          if (coupon && !coupon.is_used) {
            discount = Math.round(subtotal * (coupon.discount_percent / 100))
            isLeadCoupon = true
          }
        }
      }
    }

    // Never let a discount exceed the subtotal.
    discount = Math.min(discount, subtotal)

    const totalAmount = subtotal + SHIPPING_COST - discount

    // ── Create Razorpay order ──
    const razorpay = getRazorpayInstance()
    const razorpayOrder = await razorpay.orders.create({
      amount: totalAmount, // already in paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: {
        customer_email,
        customer_phone,
      },
    })

    // ── Create pending order in Supabase ──
    const order = await createOrder({
      customer_name,
      customer_email,
      customer_phone,
      customer_whatsapp_opted_in,
      shipping_address,
      items,
      subtotal,
      shipping_cost: SHIPPING_COST,
      discount,
      total_amount: totalAmount,
      razorpay_order_id: razorpayOrder.id,
    })

    // ── Mark single-use lead coupons as used (public coupons stay reusable) ──
    if (isLeadCoupon && discount > 0) {
      await supabase
        .from('coupon_leads')
        .update({ is_used: true })
        .eq('coupon_code', coupon_code)
    }

    return NextResponse.json({
      order_id: order.id,
      order_number: order.order_number,
      razorpay_order_id: razorpayOrder.id,
      amount: totalAmount,
      currency: 'INR',
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    })
  } catch (err) {
    console.error('Create order error:', err)
    return NextResponse.json(
      { error: 'Failed to create order. Please try again.' },
      { status: 500 }
    )
  }
}
