import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { getAllCouponsAdmin, createCoupon, type CouponInput } from '@/lib/supabase/queries'

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
    return withCors(NextResponse.json({ coupons }), request)
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
    const body = (await request.json()) as CouponInput
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const discountType = body.discount_type
    const value = Number(body.discount_value)

    if (!code) {
      return withCors(
        NextResponse.json({ error: 'Coupon code is required' }, { status: 400 }),
        request
      )
    }
    if (discountType !== 'percent' && discountType !== 'fixed') {
      return withCors(
        NextResponse.json({ error: 'Invalid discount type' }, { status: 400 }),
        request
      )
    }
    if (!Number.isFinite(value) || value <= 0) {
      return withCors(
        NextResponse.json({ error: 'Discount value must be greater than 0' }, { status: 400 }),
        request
      )
    }
    if (discountType === 'percent' && value > 100) {
      return withCors(
        NextResponse.json({ error: 'Percentage cannot exceed 100' }, { status: 400 }),
        request
      )
    }

    const coupon = await createCoupon({
      code,
      discount_type: discountType,
      discount_value: Math.round(value),
      min_subtotal: Math.max(0, Math.round(body.min_subtotal ?? 0)),
      max_discount:
        body.max_discount != null ? Math.max(0, Math.round(body.max_discount)) : null,
      is_active: body.is_active ?? true,
      expires_at: body.expires_at ?? null,
      description: body.description ?? null,
    })

    return withCors(NextResponse.json({ coupon }, { status: 201 }), request)
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
