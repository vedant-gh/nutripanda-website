import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { updateCoupon, deleteCoupon } from '@/lib/supabase/queries'
import { MAX_COUPON_BODY_BYTES, parseCouponInput } from '@/lib/coupons/input'
import { isUuid, readBoundedJsonObject } from '@/lib/utils/request-input'

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// PUT — update a coupon (e.g. toggle is_active)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const { id } = await params
    if (!isUuid(id)) {
      return withCors(NextResponse.json({ error: 'Invalid coupon ID' }, { status: 400 }), request)
    }
    const body = await readBoundedJsonObject(request, { maxBytes: MAX_COUPON_BODY_BYTES })
    if (!body.ok) {
      return withCors(NextResponse.json({ error: body.error }, { status: body.status }), request)
    }
    const input = parseCouponInput(body.value, 'update')
    if (!input.ok) {
      return withCors(NextResponse.json({ error: input.error }, { status: 400 }), request)
    }

    const coupon = await updateCoupon(id, input.value)
    return withCors(
      NextResponse.json({ coupon }, { headers: { 'Cache-Control': 'private, no-store' } }),
      request
    )
  } catch (err) {
    const e = err as { code?: string }
    if (e?.code === '23505') {
      return withCors(
        NextResponse.json({ error: 'A coupon with that code already exists' }, { status: 409 }),
        request
      )
    }
    if (e?.code === 'PGRST116') {
      return withCors(
        NextResponse.json({ error: 'Coupon not found' }, { status: 404 }),
        request
      )
    }
    console.error('Admin update coupon error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to update coupon' }, { status: 500 }),
      request
    )
  }
}

// DELETE — permanently remove a coupon
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const { id } = await params
    if (!isUuid(id)) {
      return withCors(NextResponse.json({ error: 'Invalid coupon ID' }, { status: 400 }), request)
    }
    await deleteCoupon(id)
    return withCors(NextResponse.json({ success: true }), request)
  } catch (err) {
    console.error('Admin delete coupon error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to delete coupon' }, { status: 500 }),
      request
    )
  }
}
