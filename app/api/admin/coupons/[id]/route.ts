import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { updateCoupon, deleteCoupon, type CouponInput } from '@/lib/supabase/queries'

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
    const body = (await request.json()) as Partial<CouponInput>
    const coupon = await updateCoupon(id, body)
    return withCors(NextResponse.json({ coupon }), request)
  } catch (err) {
    const e = err as { code?: string }
    if (e?.code === '23505') {
      return withCors(
        NextResponse.json({ error: 'A coupon with that code already exists' }, { status: 409 }),
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
