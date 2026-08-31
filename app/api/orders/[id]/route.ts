import { NextResponse } from 'next/server'
import { getOrderById } from '@/lib/supabase/queries'
import {
  hasOrderAccessSecret,
  verifyOrderAccessToken,
} from '@/lib/orders/access-token'
import type { OrderItem } from '@/types/supabase'

const PRIVATE_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  Vary: 'Authorization',
}

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_RESPONSE_HEADERS,
  })
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (!authorization || authorization.length > 4096) return null
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization)
  return match?.[1] ?? null
}

function safeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0
}

function confirmationItem(item: OrderItem) {
  const quantity = safeInteger(item.quantity)
  const unitPrice = safeInteger(item.price)

  return {
    name: typeof item.name === 'string' ? item.name.slice(0, 200) : 'Product',
    quantity,
    unit_price: unitPrice,
    line_total: unitPrice * quantity,
  }
}

/**
 * Customer confirmation lookup.
 *
 * The order UUID is only a lookup key, never authorization. Callers must send
 * the one-hour token returned by order creation/finalization as:
 * `Authorization: Bearer <confirmation_token>`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!hasOrderAccessSecret()) {
      console.error('Order confirmation lookup is disabled: ORDER_ACCESS_SECRET is not configured')
      return privateJson({ error: 'Order confirmation is temporarily unavailable' }, 503)
    }

    const { id } = await params
    const token = bearerToken(request)

    // Use the same response for malformed IDs, missing tokens, bad signatures,
    // expired tokens, and tokens scoped to another order. This avoids turning
    // the endpoint into an order-existence oracle.
    if (!token || !verifyOrderAccessToken(token, id)) {
      return privateJson({ error: 'Order not found' }, 404)
    }

    const order = await getOrderById(id)

    if (!order) {
      return privateJson({ error: 'Order not found' }, 404)
    }
    if (
      (
        order.payment_method === 'prepaid'
        && (
          order.payment_status !== 'paid'
          || (order.order_status === 'cancelled' && !order.payment_review_required)
        )
      )
      || (order.payment_method === 'cod' && order.order_status === 'cancelled')
    ) {
      return privateJson({ error: 'Order not found' }, 404)
    }

    const firstName = order.customer_name.trim().split(/\s+/u)[0] || 'there'

    // Deliberately omit email, phone, WhatsApp consent, full shipping address,
    // internal UUID, gateway IDs, notes, and carrier credentials/labels.
    return privateJson({
      order: {
        order_number: order.order_number,
        customer_first_name: firstName.slice(0, 80),
        items: (order.items as OrderItem[]).map(confirmationItem),
        subtotal: safeInteger(order.subtotal),
        shipping_cost: safeInteger(order.shipping_cost),
        discount: safeInteger(order.discount),
        cod_fee: safeInteger(order.cod_fee),
        total_amount: safeInteger(order.total_amount),
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        order_status: order.order_status,
        payment_review_required: order.payment_review_required === true,
        payment_review_reason: order.payment_review_reason ?? null,
        created_at: order.created_at,
      },
    })
  } catch (error) {
    console.error(
      'Order confirmation lookup failed:',
      error instanceof Error ? error.message : 'unknown error'
    )
    return privateJson({ error: 'Failed to fetch order' }, 500)
  }
}
