import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { verifyWebhookSignature } from '@/lib/razorpay/utils'
import { logInventoryChange } from '@/lib/supabase/queries'
import { createShipmentForOrder, liveShipmentsEnabled } from '@/lib/proship/fulfillment'
import type { Order, OrderItem } from '@/types/supabase'

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-razorpay-signature') ?? ''

    // ── Verify webhook signature ──
    if (!verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    const payload = JSON.parse(rawBody)
    const event = payload.event as string
    const paymentEntity = payload.payload?.payment?.entity

    if (!paymentEntity) {
      return NextResponse.json({ status: 'ignored' })
    }

    const razorpayOrderId = paymentEntity.order_id as string
    const razorpayPaymentId = paymentEntity.id as string
    const supabase = getSupabaseAdmin()

    // Find order by razorpay_order_id
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('razorpay_order_id', razorpayOrderId)
      .single()

    if (orderError || !order) {
      console.error('Webhook: order not found for', razorpayOrderId)
      return NextResponse.json({ status: 'order_not_found' })
    }

    // ── Handle payment.captured ──
    if (event === 'payment.captured') {
      // Idempotent — skip if already paid
      if (order.payment_status === 'paid') {
        return NextResponse.json({ status: 'already_processed' })
      }

      // Update order
      await supabase
        .from('orders')
        .update({
          payment_status: 'paid',
          razorpay_payment_id: razorpayPaymentId,
        })
        .eq('id', order.id)

      // Decrement inventory
      const items = order.items as OrderItem[]
      for (const item of items) {
        const { data: product } = await supabase
          .from('products')
          .select('inventory_count')
          .eq('id', item.productId)
          .single()

        if (product) {
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
      }

      // ── Auto-create the Proship shipment (prepaid only, production-gated) ──
      // COD never reaches this webhook (it doesn't go through Razorpay), so any
      // order here is prepaid. Best-effort: a Proship failure is logged but must
      // not fail the webhook — the manual "Create Shipment" button is the
      // fallback, and createShipmentForOrder is idempotent on retry.
      if (liveShipmentsEnabled()) {
        try {
          const paidOrder: Order = {
            ...(order as Order),
            payment_status: 'paid',
            razorpay_payment_id: razorpayPaymentId,
          }
          const { alreadyExisted } = await createShipmentForOrder(paidOrder)
          console.log(
            alreadyExisted
              ? `Auto-ship: order ${order.order_number} already had a shipment`
              : `Auto-ship: created shipment for order ${order.order_number}`
          )
        } catch (shipErr) {
          console.error(`Auto-ship failed for order ${order.order_number}:`, shipErr)
        }
      }
    }

    // ── Handle payment.failed ──
    if (event === 'payment.failed') {
      if (order.payment_status !== 'pending') {
        return NextResponse.json({ status: 'already_processed' })
      }

      await supabase
        .from('orders')
        .update({ payment_status: 'failed' })
        .eq('id', order.id)
    }

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    console.error('Webhook error:', err)
    // Always return 200 to Razorpay to prevent retries on our errors
    return NextResponse.json({ status: 'error' }, { status: 200 })
  }
}
