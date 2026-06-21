import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { findPublicCoupon, computePublicCouponDiscount } from '@/lib/utils/coupons'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const code = (body.code ?? '').trim().toUpperCase()
    const subtotal = body.subtotal

    if (!code) {
      return NextResponse.json(
        { valid: false, error: 'Please enter a coupon code' },
        { status: 400 }
      )
    }

    if (typeof subtotal !== 'number' || subtotal <= 0) {
      return NextResponse.json(
        { valid: false, error: 'Invalid subtotal' },
        { status: 400 }
      )
    }

    // 1. Public sitewide coupons (e.g. PANDA150)
    const publicCoupon = findPublicCoupon(code)
    if (publicCoupon) {
      const result = computePublicCouponDiscount(publicCoupon, subtotal)
      if (!result.ok) {
        return NextResponse.json({ valid: false, error: result.error })
      }
      return NextResponse.json({
        valid: true,
        discount: result.discount,
        code: publicCoupon.code,
      })
    }

    // 2. Single-use lead coupons (percent-based)
    const supabase = getSupabaseAdmin()

    const { data: coupon, error } = await supabase
      .from('coupon_leads')
      .select('coupon_code, discount_percent, is_used')
      .eq('coupon_code', code)
      .limit(1)
      .single()

    if (error || !coupon) {
      return NextResponse.json({ valid: false, error: 'Invalid coupon code' })
    }

    if (coupon.is_used) {
      return NextResponse.json({ valid: false, error: 'This coupon has already been used' })
    }

    // Calculate discount in paise
    const discount = Math.round(subtotal * (coupon.discount_percent / 100))

    return NextResponse.json({
      valid: true,
      discount,
      code: coupon.coupon_code,
      discountPercent: coupon.discount_percent,
    })
  } catch (err) {
    console.error('Coupon validate error:', err)
    return NextResponse.json(
      { valid: false, error: 'Something went wrong' },
      { status: 500 }
    )
  }
}
