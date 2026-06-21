import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createOrder, logInventoryChange } from '@/lib/supabase/queries'
import { validateEmail, validatePhone, validatePincode } from '@/lib/utils/validators'
import { SHIPPING_COST, COD_FEE } from '@/lib/utils/constants'
import { findPublicCoupon, computePublicCouponDiscount } from '@/lib/utils/coupons'
import type { OrderItem, ShippingAddress } from '@/types/supabase'

// Cash-on-delivery order placement. No payment gateway — the order is created as
// confirmed/pending-payment, stock is decremented immediately, and the COD_FEE
// is added to the total.
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { customer, shippingAddress, items, couponCode } = body as {
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
    if (
      !shippingAddress?.line1 ||
      !shippingAddress.city ||
      !shippingAddress.state ||
      !validatePincode(shippingAddress.pincode)
    ) {
      return NextResponse.json({ error: 'Invalid shipping address' }, { status: 400 })
    }
    if (!items?.length) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    }

    const customer_name = customer.name.trim()
    const customer_email = customer.email.trim().toLowerCase()
    const customer_phone = customer.phone.trim()
    const customer_whatsapp_opted_in = customer.whatsappOptIn ?? false
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

    // ── Calculate totals (re-validate coupon server-side) ──
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    let discount = 0
    let isLeadCoupon = false

    if (coupon_code) {
      const publicCoupon = findPublicCoupon(coupon_code)
      if (publicCoupon) {
        const result = computePublicCouponDiscount(publicCoupon, subtotal)
        if (result.ok) discount = result.discount
      } else {
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

    discount = Math.min(discount, subtotal)
    const totalAmount = subtotal + SHIPPING_COST + COD_FEE - discount

    // ── Create the COD order ──
    const order = await createOrder({
      customer_name,
      customer_email,
      customer_phone,
      customer_whatsapp_opted_in,
      shipping_address: shippingAddress,
      items,
      subtotal,
      shipping_cost: SHIPPING_COST,
      discount,
      cod_fee: COD_FEE,
      payment_method: 'cod',
      total_amount: totalAmount,
    })

    // ── Mark single-use lead coupon as used (public coupons stay reusable) ──
    if (isLeadCoupon && discount > 0) {
      await supabase
        .from('coupon_leads')
        .update({ is_used: true })
        .eq('coupon_code', coupon_code)
    }

    // ── Decrement inventory (COD orders are confirmed on placement) ──
    for (const item of items) {
      const product = productMap.get(item.productId)
      if (!product) continue
      const previousStock = product.inventory_count
      const newStock = Math.max(0, previousStock - item.quantity)

      await supabase
        .from('products')
        .update({ inventory_count: newStock })
        .eq('id', item.productId)

      await logInventoryChange({
        product_id: item.productId,
        product_name: item.name,
        change_type: 'sale',
        quantity_change: -item.quantity,
        previous_stock: previousStock,
        new_stock: newStock,
        order_id: order.id,
      })
    }

    // ── Trigger notifications (fire-and-forget) ──
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.headers.get('origin') ?? ''

    fetch(`${baseUrl}/api/notifications/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: 'order_confirmation', order_id: order.id }),
    }).catch((err) => console.error('Email notification failed:', err))

    fetch(`${baseUrl}/api/notifications/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: 'admin_new_order', order_id: order.id }),
    }).catch((err) => console.error('Admin email notification failed:', err))

    if (customer_whatsapp_opted_in) {
      fetch(`${baseUrl}/api/notifications/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: 'order_confirmation', order_id: order.id }),
      }).catch((err) => console.error('WhatsApp notification failed:', err))
    }

    return NextResponse.json({
      order_id: order.id,
      order_number: order.order_number,
    })
  } catch (err) {
    console.error('COD order error:', err)
    return NextResponse.json(
      { error: 'Failed to place order. Please try again.' },
      { status: 500 }
    )
  }
}
