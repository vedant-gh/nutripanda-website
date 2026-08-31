import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { getAllCouponsAdmin, createCoupon } from '@/lib/supabase/queries'
import { MAX_COUPON_BODY_BYTES, parseCouponInput } from '@/lib/coupons/input'
import { readBoundedJsonObject } from '@/lib/utils/request-input'

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// GET — list all coupons
export async function GET(request: Request) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const coupons = await getAllCouponsAdmin()
    return withCors(
      NextResponse.json({ coupons }, { headers: { 'Cache-Control': 'private, no-store' } }),
      request
    )
  } catch (err) {
    console.error('Admin list coupons error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to fetch coupons' }, { status: 500 }),
      request
    )
  }
}

// POST — create a coupon
export async function POST(request: Request) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const body = await readBoundedJsonObject(request, { maxBytes: MAX_COUPON_BODY_BYTES })
    if (!body.ok) {
      return withCors(NextResponse.json({ error: body.error }, { status: body.status }), request)
    }
    const input = parseCouponInput(body.value, 'create')
    if (!input.ok) {
      return withCors(NextResponse.json({ error: input.error }, { status: 400 }), request)
    }

    const coupon = await createCoupon(input.value)

    return withCors(
      NextResponse.json(
        { coupon },
        { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
      ),
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
    console.error('Admin create coupon error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to create coupon' }, { status: 500 }),
      request
    )
  }
}
