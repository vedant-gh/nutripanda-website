import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { logNotification } from '@/lib/supabase/queries'
import { formatPrice } from '@/lib/utils/format'
import {
  sendGetGabsText,
  sendGetGabsTemplate,
  toWhatsAppNumber,
  type TemplateComponent,
} from '@/lib/notifications/getgabs'
import type { Order } from '@/types/supabase'

// Free-text bodies — used when a customer is inside the 24-hour session window
// (or as a fallback until an approved template is configured below).
const TEXT_TEMPLATES: Record<string, (order: Order, extra?: Record<string, string>) => string> = {
  order_confirmation: (order) =>
    `Hi ${order.customer_name}! 🐼\n\nYour NutriPanda order #${order.order_number} for ${formatPrice(order.total_amount)} has been confirmed.\n\nWe'll notify you when it ships. Thank you for choosing NutriPanda!`,

  shipping_update: (order, extra) =>
    `Great news, ${order.customer_name}! 🎉\n\nYour NutriPanda order #${order.order_number} has been shipped!${extra?.tracking_link ? `\n\nTrack it here: ${extra.tracking_link}` : ''}\n\nExpected delivery: 3-5 business days.`,

  delivered: (order) =>
    `Your NutriPanda order #${order.order_number} has been delivered! 🐼🎉\n\nEnjoy your gummies, ${order.customer_name}! We'd love to hear your feedback.`,
}

// Approved-template config. WhatsApp requires an APPROVED TEMPLATE for
// business-initiated messages (the normal case for order confirmations). Create
// the template in GetGabs, then set its name in the matching env var. `components`
// builds the BODY variables in the order the template expects. Until the env var
// is set, the route falls back to free-text (which only delivers in-session).
const TEMPLATE_CONFIG: Record<
  string,
  { envName: string; components: (order: Order, extra?: Record<string, string>) => TemplateComponent[] }
> = {
  order_confirmation: {
    envName: 'GETGABS_TEMPLATE_ORDER_CONFIRMATION',
    components: (order) => [
      {
        type: 'BODY',
        parameters: [
          { type: 'text', text: order.customer_name },
          { type: 'text', text: order.order_number },
          { type: 'text', text: formatPrice(order.total_amount) },
        ],
      },
    ],
  },
  shipping_update: {
    envName: 'GETGABS_TEMPLATE_SHIPPING_UPDATE',
    components: (order, extra) => [
      {
        type: 'BODY',
        parameters: [
          { type: 'text', text: order.customer_name },
          { type: 'text', text: order.order_number },
          { type: 'text', text: extra?.tracking_link ?? '-' },
        ],
      },
    ],
  },
  delivered: {
    envName: 'GETGABS_TEMPLATE_DELIVERED',
    components: (order) => [
      {
        type: 'BODY',
        parameters: [
          { type: 'text', text: order.customer_name },
          { type: 'text', text: order.order_number },
        ],
      },
    ],
  },
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { template, order_id, ...extra } = body as {
      template: string
      order_id: string
      [key: string]: string
    }

    if (!template || !order_id) {
      return NextResponse.json({ error: 'template and order_id required' }, { status: 400 })
    }
    if (!TEXT_TEMPLATES[template]) {
      return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
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

    // Only message customers who opted in to WhatsApp updates.
    if (!order.customer_whatsapp_opted_in) {
      return NextResponse.json({ status: 'skipped', reason: 'not_opted_in' })
    }

    const typedOrder = order as Order
    const to = toWhatsAppNumber(typedOrder.customer_phone)

    // Prefer an approved template (works for business-initiated messages);
    // fall back to free-text (delivers only inside the 24-hour session window).
    const tmpl = TEMPLATE_CONFIG[template]
    const templateName = tmpl ? process.env[tmpl.envName] : undefined

    const result = templateName
      ? await sendGetGabsTemplate(to, {
          name: templateName,
          components: tmpl!.components(typedOrder, extra),
        })
      : await sendGetGabsText(to, TEXT_TEMPLATES[template](typedOrder, extra))

    await logNotification({
      order_id,
      channel: 'whatsapp',
      recipient: typedOrder.customer_phone,
      template,
      status: result.ok ? 'sent' : 'failed',
      error_message: result.ok ? undefined : result.error,
    })

    // WhatsApp is best-effort — never fail the caller; the purchase succeeded regardless.
    return NextResponse.json(
      result.ok ? { success: true, id: result.id } : { success: false, error: result.error }
    )
  } catch (err) {
    console.error('WhatsApp notification error:', err)
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 })
  }
}
