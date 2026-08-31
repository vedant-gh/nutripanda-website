import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { getOrderById } from '@/lib/supabase/queries'
import { ProshipError } from '@/lib/proship/client'
import { ServiceabilityError } from '@/lib/proship/serviceability'
import {
  createShipmentForOrder,
  ShipmentError,
  syncShipmentForOrder,
} from '@/lib/proship/fulfillment'
import { hasOnlyKeys, isUuid, readBoundedJsonObject } from '@/lib/utils/request-input'

const MAX_BODY_BYTES = 1024

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// POST defaults to a concurrency-safe booking. Send { action: "sync" } to
// reconcile tracking/status by immutable merchant order reference instead.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), request)
  }

  try {
    const { id } = await params
    if (!isUuid(id)) {
      return withCors(NextResponse.json({ error: 'Invalid order ID' }, { status: 400 }), request)
    }

    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_BODY_BYTES,
      allowEmpty: true,
    })
    if (!body.ok) {
      return withCors(NextResponse.json({ error: body.error }, { status: body.status }), request)
    }
    if (!hasOnlyKeys(body.value, ['action'])) {
      return withCors(
        NextResponse.json({ error: 'Request contains unsupported fields' }, { status: 400 }),
        request
      )
    }

    const suppliedAction = body.value.action
    if (
      suppliedAction !== undefined
      && suppliedAction !== 'create'
      && suppliedAction !== 'sync'
    ) {
      return withCors(
        NextResponse.json({ error: 'action must be create or sync' }, { status: 400 }),
        request
      )
    }
    const action: 'create' | 'sync' = suppliedAction === 'sync' ? 'sync' : 'create'

    const order = await getOrderById(id)

    if (!order) {
      return withCors(NextResponse.json({ error: 'Order not found' }, { status: 404 }), request)
    }

    if (action === 'sync') {
      const { order: updated, shipment } = await syncShipmentForOrder(order)
      let notification
      if (
        updated.customer_whatsapp_opted_in
        && (updated.order_status === 'shipped' || updated.order_status === 'delivered')
      ) {
        const { enqueueOrderNotification } = await import('@/lib/notifications/queue')
        notification = await enqueueOrderNotification({
          orderId: updated.id,
          channel: 'whatsapp',
          template: updated.order_status === 'shipped' ? 'shipping_update' : 'delivered',
          idempotencyKey: `order:${updated.id}:status:${updated.order_status}:whatsapp`,
          payload: updated.order_status === 'shipped'
            ? { tracking_link: updated.tracking_url ?? undefined }
            : undefined,
        })
      }
      return withCors(NextResponse.json({ order: updated, shipment, action, notification }), request)
    }

    const result = await createShipmentForOrder(order)
    return withCors(NextResponse.json({ ...result, action }), request)
  } catch (err) {
    if (err instanceof ShipmentError) {
      return withCors(
        NextResponse.json({ error: err.message, code: err.code }, { status: err.status }),
        request
      )
    }
    if (err instanceof ServiceabilityError) {
      return withCors(NextResponse.json({ error: err.message }, { status: err.status }), request)
    }
    if (err instanceof ProshipError) {
      console.error('Shipment provider request failed', err.toSafeLog())
      return withCors(
        NextResponse.json(
          { error: 'Shipping provider request failed. No automatic retry was attempted.' },
          { status: err.status === 504 ? 504 : 502 }
        ),
        request
      )
    }
    console.error('Shipment operation failed', { name: err instanceof Error ? err.name : 'UnknownError' })
    return withCors(NextResponse.json({ error: 'Failed to create shipment' }, { status: 500 }), request)
  }
}
