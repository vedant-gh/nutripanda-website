import 'server-only'

import { escapeHtml, safeEmailSubjectPart } from './html'
import { formatPrice } from '@/lib/utils/format'
import type { Order, OrderItem } from '@/types/supabase'

export interface RenderedEmail {
  subject: string
  html: string
}
function money(value: number): string {
  return escapeHtml(formatPrice(Number.isSafeInteger(value) ? value : 0))
}

function orderItems(order: Order): OrderItem[] {
  return Array.isArray(order.items) ? (order.items as OrderItem[]) : []
}

export function renderOrderConfirmationEmail(order: Order): RenderedEmail {
  const itemRows = orderItems(order)
    .map((item) => {
      const quantity = Number.isSafeInteger(item.quantity) ? item.quantity : 0
      const price = Number.isSafeInteger(item.price) ? item.price : 0

      return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(item.name)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(quantity)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${money(price * quantity)}</td>
      </tr>`
    })
    .join('')

  const address = order.shipping_address
  const addressText = [address?.line1, address?.line2, address?.city, address?.state, address?.pincode]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => escapeHtml(part))
    .join(', ')
  const orderNumber = escapeHtml(order.order_number)

  return {
    subject: `Order Confirmed - ${safeEmailSubjectPart(order.order_number)} | NutriPanda`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;">
    <div style="background:#12BC00;padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:24px;">NutriPanda</h1>
    </div>
    <div style="padding:32px 24px;">
      <h2 style="color:#333;margin:0 0 8px;">Order confirmed</h2>
      <p style="color:#666;margin:0 0 24px;">Thank you for your order, ${escapeHtml(order.customer_name)}.</p>

      <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;color:#333;font-weight:bold;">Order #${orderNumber}</p>
      </div>

      <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;">
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
        <p style="margin:4px 0;color:#666;">Subtotal: ${money(order.subtotal)}</p>
        <p style="margin:4px 0;color:#666;">Shipping: ${order.shipping_cost === 0 ? 'Free' : money(order.shipping_cost)}</p>
        ${order.discount > 0 ? `<p style="margin:4px 0;color:#12BC00;">Discount: -${money(order.discount)}</p>` : ''}
        ${order.cod_fee > 0 ? `<p style="margin:4px 0;color:#666;">COD fee: ${money(order.cod_fee)}</p>` : ''}
        <p style="margin:8px 0 0;font-size:18px;font-weight:bold;color:#333;">${order.payment_method === 'cod' ? 'Pay on delivery' : 'Total paid'}: ${money(order.total_amount)}</p>
      </div>

      <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-weight:bold;color:#333;">Shipping to:</p>
        <p style="margin:0;color:#666;">${addressText}</p>
      </div>

      <p style="color:#666;text-align:center;">We will update you when your order ships.</p>
    </div>
    <div style="background:#333;padding:16px;text-align:center;">
      <p style="color:#999;margin:0;font-size:12px;">NutriPanda · Nutrition that&apos;s fun</p>
      <p style="color:#999;margin:4px 0 0;font-size:12px;">@nutripanda_og</p>
    </div>
  </div>
</body>
</html>`,
  }
}

export function renderAdminNewOrderEmail(order: Order): RenderedEmail {
  const items = orderItems(order)
    .map((item) => `${escapeHtml(item.name)} ×${escapeHtml(item.quantity)}`)
    .join(', ')

  return {
    subject: `New Order: ${safeEmailSubjectPart(order.order_number)} - ${safeEmailSubjectPart(formatPrice(order.total_amount))}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;">
  <div style="max-width:500px;margin:20px auto;padding:24px;border:1px solid #ddd;border-radius:8px;">
    <h2 style="margin:0 0 16px;color:#12BC00;">New order received</h2>
    <p><strong>Order:</strong> ${escapeHtml(order.order_number)}</p>
    <p><strong>Customer:</strong> ${escapeHtml(order.customer_name)} (${escapeHtml(order.customer_email)})</p>
    <p><strong>Phone:</strong> ${escapeHtml(order.customer_phone)}</p>
    <p><strong>Items:</strong> ${items}</p>
    <p><strong>Total:</strong> ${money(order.total_amount)}</p>
    <p><strong>Payment:</strong> ${escapeHtml(order.payment_method === 'cod' ? 'Cash on delivery' : 'Prepaid')}</p>
    <p><strong>City:</strong> ${escapeHtml(order.shipping_address?.city)}, ${escapeHtml(order.shipping_address?.state)}</p>
  </div>
</body>
</html>`,
  }
}
