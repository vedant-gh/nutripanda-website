import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { logNotification } from '@/lib/supabase/queries'
import { formatPrice } from '@/lib/utils/format'
import type { Order, OrderItem } from '@/types/supabase'

function buildOrderConfirmationHtml(order: Order): string {
  const items = order.items as OrderItem[]
  const itemRows = items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${item.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${formatPrice(item.price * item.quantity)}</td>
      </tr>`
    )
    .join('')

  const address = order.shipping_address
  const addressStr = [address.line1, address.line2, address.city, address.state, address.pincode]
    .filter(Boolean)
    .join(', ')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;">
    <div style="background:#12BC00;padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:24px;">NutriPanda</h1>
    </div>
    <div style="padding:32px 24px;">
      <h2 style="color:#333;margin:0 0 8px;">Order Confirmed!</h2>
      <p style="color:#666;margin:0 0 24px;">Thank you for your order, ${order.customer_name}!</p>

      <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;color:#333;font-weight:bold;">Order #${order.order_number}</p>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#f9f9f9;">
            <th style="padding:8px 12px;text-align:left;">Item</th>
            <th style="padding:8px 12px;text-align:center;">Qty</th>
            <th style="padding:8px 12px;text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div style="text-align:right;margin-bottom:24px;">
        <p style="margin:4px 0;color:#666;">Subtotal: ${formatPrice(order.subtotal)}</p>
        <p style="margin:4px 0;color:#666;">Shipping: ${order.shipping_cost === 0 ? 'Free' : formatPrice(order.shipping_cost)}</p>
        ${order.discount > 0 ? `<p style="margin:4px 0;color:#12BC00;">Discount: -${formatPrice(order.discount)}</p>` : ''}
        <p style="margin:8px 0 0;font-size:18px;font-weight:bold;color:#333;">Total: ${formatPrice(order.total_amount)}</p>
      </div>

      <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-weight:bold;color:#333;">Shipping to:</p>
        <p style="margin:0;color:#666;">${addressStr}</p>
      </div>

      <p style="color:#666;text-align:center;">We'll update you when your order ships!</p>
    </div>
    <div style="background:#333;padding:16px;text-align:center;">
      <p style="color:#999;margin:0;font-size:12px;">NutriPanda · Nutrition that's fun</p>
      <p style="color:#999;margin:4px 0 0;font-size:12px;">@nutripanda_og</p>
    </div>
  </div>
</body>
</html>`
}

function buildAdminNewOrderHtml(order: Order): string {
  const items = order.items as OrderItem[]
  const itemList = items.map((i) => `${i.name} x${i.quantity}`).join(', ')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;">
  <div style="max-width:500px;margin:20px auto;padding:24px;border:1px solid #ddd;border-radius:8px;">
    <h2 style="margin:0 0 16px;color:#12BC00;">New Order Received</h2>
    <p><strong>Order:</strong> ${order.order_number}</p>
    <p><strong>Customer:</strong> ${order.customer_name} (${order.customer_email})</p>
    <p><strong>Phone:</strong> ${order.customer_phone}</p>
    <p><strong>Items:</strong> ${itemList}</p>
    <p><strong>Total:</strong> ${formatPrice(order.total_amount)}</p>
    <p><strong>City:</strong> ${order.shipping_address.city}, ${order.shipping_address.state}</p>
  </div>
</body>
</html>`
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { template, order_id } = body as {
      template: 'order_confirmation' | 'admin_new_order'
      order_id: string
    }

    if (!template || !order_id) {
      return NextResponse.json({ error: 'template and order_id required' }, { status: 400 })
    }

    // Fetch order
    const supabase = getSupabaseAdmin()
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Build email
    let to: string
    let subject: string
    let html: string

    if (template === 'order_confirmation') {
      to = order.customer_email
      subject = `Order Confirmed - ${order.order_number} | NutriPanda`
      html = buildOrderConfirmationHtml(order as Order)
    } else if (template === 'admin_new_order') {
      to = process.env.ADMIN_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? ''
      subject = `New Order: ${order.order_number} - ${formatPrice(order.total_amount)}`
      html = buildAdminNewOrderHtml(order as Order)
    } else {
      return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
    }

    if (!to) {
      return NextResponse.json({ error: 'No recipient email' }, { status: 400 })
    }

    // Send via Resend
    const resendApiKey = process.env.RESEND_API_KEY
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured')
      await logNotification({
        order_id,
        channel: 'email',
        recipient: to,
        template,
        status: 'failed',
        error_message: 'RESEND_API_KEY not configured',
      })
      return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
    }

    const { Resend } = await import('resend')
    const resend = new Resend(resendApiKey)

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'NutriPanda <orders@nutripanda.com>'

    const { error: sendError } = await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      html,
    })

    if (sendError) {
      console.error('Resend error:', sendError)
      await logNotification({
        order_id,
        channel: 'email',
        recipient: to,
        template,
        status: 'failed',
        error_message: String(sendError),
      })
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    await logNotification({
      order_id,
      channel: 'email',
      recipient: to,
      template,
      status: 'sent',
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Email notification error:', err)
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 })
  }
}
