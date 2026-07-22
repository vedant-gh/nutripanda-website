// Public, sitewide promo coupons. Single source of truth shared by the coupon
// API, the order/payment route, and the storefront UI — so the advertised offer
// and the actually-charged discount can never drift apart.

export interface PublicCoupon {
  code: string
  /** Flat amount off, in paise. */
  amountOff: number
  /** Minimum cart subtotal required, in paise. */
  minSubtotal: number
  /** Short marketing label, e.g. for the announcement bar. */
  label: string
  active: boolean
}

export const PUBLIC_COUPONS: PublicCoupon[] = [
  {
    code: 'PANDA150',
    amountOff: 15000, // ₹150
    minSubtotal: 50000, // ₹500
    label: 'Flat ₹150 OFF on orders above ₹500',
    active: true,
  },
  {
    code: 'PANDA300',
    amountOff: 30000, // ₹300
    minSubtotal: 99900, // ₹999
    label: 'Flat ₹300 OFF on orders above ₹999',
    active: true,
  },
]

/** The currently-promoted coupon to surface in the UI (or undefined). */
export function getActivePublicCoupon(): PublicCoupon | undefined {
  return PUBLIC_COUPONS.find((c) => c.active)
}

/** All active public coupons, to list in the checkout coupon dropdown. */
export function getActivePublicCoupons(): PublicCoupon[] {
  return PUBLIC_COUPONS.filter((c) => c.active)
}

/** Look up an active public coupon by code (case-insensitive). */
export function findPublicCoupon(code: string): PublicCoupon | undefined {
  const normalized = code.trim().toUpperCase()
  return PUBLIC_COUPONS.find((c) => c.active && c.code === normalized)
}

export type CouponResult =
  | { ok: true; discount: number }
  | { ok: false; error: string }

/** Compute the discount (in paise) for a public coupon against a subtotal. */
export function computePublicCouponDiscount(
  coupon: PublicCoupon,
  subtotal: number
): CouponResult {
  if (subtotal < coupon.minSubtotal) {
    const gap = Math.ceil((coupon.minSubtotal - subtotal) / 100)
    return { ok: false, error: `Add ₹${gap} more to use ${coupon.code}` }
  }
  // Never discount below zero.
  return { ok: true, discount: Math.min(coupon.amountOff, subtotal) }
}

// ── Admin-managed DB coupons (percentage or fixed) ──

/** The subset of a `coupons` row needed to compute a discount. */
export interface CouponRule {
  discount_type: 'percent' | 'fixed'
  discount_value: number // percent: 1-100; fixed: paise
  min_subtotal: number // paise
  max_discount: number | null // paise cap (percent coupons)
  is_active: boolean
  expires_at: string | null
}

/**
 * Compute the discount (in paise) for an admin-managed coupon. Single source of
 * truth used by the validate endpoint and by both order-creation routes so the
 * quoted and the charged discount can never diverge.
 */
export function computeDbCouponDiscount(
  c: CouponRule,
  subtotal: number
): CouponResult {
  if (!c.is_active) return { ok: false, error: 'This coupon is no longer active' }
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'This coupon has expired' }
  }
  if (subtotal < c.min_subtotal) {
    const gap = Math.ceil((c.min_subtotal - subtotal) / 100)
    return { ok: false, error: `Add ₹${gap} more to use this coupon` }
  }

  let discount =
    c.discount_type === 'percent'
      ? Math.round((subtotal * c.discount_value) / 100)
      : c.discount_value
  if (c.max_discount != null && discount > c.max_discount) discount = c.max_discount
  discount = Math.min(discount, subtotal)

  if (discount <= 0) return { ok: false, error: 'This coupon has no value on your cart' }
  return { ok: true, discount }
}
