import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  findPublicCoupon,
  computePublicCouponDiscount,
  computeDbCouponDiscount,
} from '@/lib/utils/coupons'
import { getCouponByCode } from '@/lib/supabase/queries'
import {
  MAX_COUPON_BODY_BYTES,
  parsePublicCouponInput,
} from '@/lib/coupons/input'
import { readBoundedJsonObject } from '@/lib/utils/request-input'

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS })
}

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: MAX_COUPON_BODY_BYTES })
    if (!body.ok) {
      return json({ valid: false, error: body.error }, body.status)
    }
    const input = parsePublicCouponInput(body.value)
    if (!input.ok) return json({ valid: false, error: input.error }, 400)
    const { code, subtotal } = input.value

    // 1. Public sitewide coupons (e.g. PANDA150)
    const publicCoupon = findPublicCoupon(code)
    if (publicCoupon) {
      const result = computePublicCouponDiscount(publicCoupon, subtotal)
      if (!result.ok) {
        return json({ valid: false, error: result.error })
      }
      return json({
        valid: true,
        discount: result.discount,
        code: publicCoupon.code,
      })
    }

    // 2. Admin-managed reusable coupons (percentage or fixed)
    const adminCoupon = await getCouponByCode(code)
    if (adminCoupon) {
      const result = computeDbCouponDiscount(adminCoupon, subtotal)
      if (!result.ok) {
        return json({ valid: false, error: result.error })
      }
      return json({
        valid: true,
        discount: result.discount,
        code: adminCoupon.code,
        ...(adminCoupon.discount_type === 'percent'
          ? { discountPercent: adminCoupon.discount_value }
          : {}),
      })
    }

    // 3. Single-use lead coupons (percent-based)
    const supabase = getSupabaseAdmin()

    const { data: coupon, error } = await supabase
      .from('coupon_leads')
      .select('coupon_code, discount_percent, is_used')
      .eq('coupon_code', code)
      .limit(1)
      .single()

    if (error || !coupon) {
      return json({ valid: false, error: 'Invalid coupon code' })
    }

    if (coupon.is_used) {
      return json({ valid: false, error: 'This coupon has already been used' })
    }

    // Calculate discount in paise
    const discount = Math.round(subtotal * (coupon.discount_percent / 100))

    return json({
      valid: true,
      discount,
      code: coupon.coupon_code,
      discountPercent: coupon.discount_percent,
    })
  } catch (err) {
    console.error('Coupon validate error:', err)
    return json({ valid: false, error: 'Something went wrong' }, 500)
  }
}
