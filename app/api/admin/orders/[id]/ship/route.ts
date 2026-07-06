import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { getOrderById } from '@/lib/supabase/queries'
import { ProshipError } from '@/lib/proship'
import { createShipmentForOrder, ShipmentError } from '@/lib/proship/fulfillment'

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// POST — create a REAL Proship shipment for this order (admin-triggered, manual).
// Always available regardless of PROSHIP_LIVE_SHIPMENTS — this is the on-demand
// button and the fallback when automatic creation is off or has failed.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), request)
  }

  try {
    const { id } = await params
    const order = await getOrderById(id)

    if (!order) {
      return withCors(NextResponse.json({ error: 'Order not found' }, { status: 404 }), request)
    }
    if (order.awb_number) {
      return withCors(
        NextResponse.json(
          { error: `Shipment already exists for this order (AWB ${order.awb_number})` },
          { status: 409 }
        ),
        request
      )
    }

    const { order: updated, shipment } = await createShipmentForOrder(order)
    return withCors(NextResponse.json({ order: updated, shipment }), request)
  } catch (err) {
    console.error('Create shipment error:', err)
    // Surface Proship's / the orchestrator's own message so the payload can be debugged.
    if (err instanceof ShipmentError) {
      return withCors(NextResponse.json({ error: err.message }, { status: err.status }), request)
    }
    if (err instanceof ProshipError) {
      return withCors(NextResponse.json({ error: err.message }, { status: 502 }), request)
    }
    return withCors(NextResponse.json({ error: 'Failed to create shipment' }, { status: 500 }), request)
  }
}
