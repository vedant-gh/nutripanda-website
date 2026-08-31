import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeDbCouponDiscount,
  computePublicCouponDiscount,
  findPublicCoupon,
} from '@/lib/utils/coupons'
import {
  buildCanonicalOrderItems,
  CheckoutValidationError,
  type CheckoutProduct,
  type CheckoutRequest,
} from './checkout-validation'

export async function loadCanonicalCart(
  supabase: SupabaseClient,
  requestedItems: CheckoutRequest['items']
) {
  const productIds = requestedItems.map((item) => item.productId)
  const { data, error } = await supabase
    .from('products')
    .select('id, name, slug, price, images, inventory_count, is_active')
    .in('id', productIds)

  if (error) throw error
  return buildCanonicalOrderItems(requestedItems, (data ?? []) as CheckoutProduct[])
}

export async function resolveCheckoutDiscount(
  supabase: SupabaseClient,
  couponCode: string | undefined,
  subtotal: number
): Promise<{ discount: number; couponCode?: string; leadCouponCode?: string }> {
  if (!couponCode) return { discount: 0 }

  const publicCoupon = findPublicCoupon(couponCode)
  if (publicCoupon) {
    const result = computePublicCouponDiscount(publicCoupon, subtotal)
    if (!result.ok) throw new CheckoutValidationError(result.error)
    return { discount: Math.min(result.discount, subtotal), couponCode: publicCoupon.code }
  }

  const { data: adminCoupon, error: adminCouponError } = await supabase
    .from('coupons')
    .select('code, discount_type, discount_value, min_subtotal, max_discount, is_active, expires_at')
    .eq('code', couponCode)
    .maybeSingle()

  if (adminCouponError) throw adminCouponError
  if (adminCoupon) {
    const result = computeDbCouponDiscount(adminCoupon, subtotal)
    if (!result.ok) throw new CheckoutValidationError(result.error)
    return {
      discount: Math.min(result.discount, subtotal),
      couponCode: String(adminCoupon.code),
    }
  }

  const { data: coupon, error } = await supabase
    .from('coupon_leads')
    .select('discount_percent, is_used, reserved_until')
    .eq('coupon_code', couponCode)
    .maybeSingle()

  if (error) throw error
  if (!coupon || coupon.is_used) throw new CheckoutValidationError('Invalid or used coupon code')
  if (coupon.reserved_until && new Date(coupon.reserved_until).getTime() > Date.now()) {
    throw new CheckoutValidationError('This coupon is currently reserved by another checkout')
  }

  const percent = Number(coupon.discount_percent)
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    throw new Error('Coupon has an invalid discount percentage')
  }

  return {
    discount: Math.min(Math.round(subtotal * (percent / 100)), subtotal),
    couponCode,
    leadCouponCode: couponCode,
  }
}
