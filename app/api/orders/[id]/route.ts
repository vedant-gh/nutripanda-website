import { NextResponse } from 'next/server'
import { getOrderById } from '@/lib/supabase/queries'

// Public GET — fetch order by ID (for order confirmation page)
// Only returns non-sensitive fields
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const order = await getOrderById(id)

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Return only what the customer needs to see
    return NextResponse.json({
      order: {
        id: order.id,
        order_number: order.order_number,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_phone: order.customer_phone,
        customer_whatsapp_opted_in: order.customer_whatsapp_opted_in,
        shipping_address: order.shipping_address,
        items: order.items,
        subtotal: order.subtotal,
        shipping_cost: order.shipping_cost,
        discount: order.discount,
        cod_fee: order.cod_fee,
        total_amount: order.total_amount,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        order_status: order.order_status,
        created_at: order.created_at,
      },
    })
  } catch (err) {
    console.error('Get order error:', err)
    return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 })
  }
}
