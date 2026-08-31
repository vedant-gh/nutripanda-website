import posthog from 'posthog-js'

// ── E-commerce funnel events ──

export function trackProductViewed(product: {
  product_id: string
  product_name: string
  price: number
  color_theme: string | null
  slug: string
}) {
  posthog.capture('product_viewed', {
    product_id: product.product_id,
    product_name: product.product_name,
    price_paise: product.price,
    price_inr: product.price / 100,
    color_theme: product.color_theme,
    slug: product.slug,
  })
}

export function trackAddToCart(product: {
  product_id: string
  product_name: string
  price: number
  quantity: number
  color_theme: string | null
}) {
  posthog.capture('add_to_cart', {
    product_id: product.product_id,
    product_name: product.product_name,
    price_paise: product.price,
    price_inr: product.price / 100,
    quantity: product.quantity,
    color_theme: product.color_theme,
  })
}

export function trackRemoveFromCart(product: {
  product_id: string
  product_name: string
}) {
  posthog.capture('remove_from_cart', {
    product_id: product.product_id,
    product_name: product.product_name,
  })
}

export function trackCartOpened(itemCount: number, cartTotal: number) {
  posthog.capture('cart_opened', {
    item_count: itemCount,
    cart_total_paise: cartTotal,
    cart_total_inr: cartTotal / 100,
  })
}

export function trackCheckoutStarted(itemCount: number, cartTotal: number) {
  posthog.capture('checkout_started', {
    item_count: itemCount,
    cart_total_paise: cartTotal,
    cart_total_inr: cartTotal / 100,
  })
}

export function trackPaymentInitiated(amount: number) {
  posthog.capture('payment_initiated', {
    amount_paise: amount,
    amount_inr: amount / 100,
  })
}

export function trackPaymentCompleted(order: {
  total_amount: number
  item_count: number
  payment_method: 'prepaid' | 'cod'
}) {
  posthog.capture('payment_completed', {
    total_paise: order.total_amount,
    total_inr: order.total_amount / 100,
    item_count: order.item_count,
    payment_method: order.payment_method,
  })
}

export function trackPaymentFailed(reason?: string) {
  posthog.capture('payment_failed', {
    reason: reason || 'unknown',
  })
}

export function trackCouponApplied(discountPercent: number) {
  posthog.capture('coupon_applied', {
    discount_percent: discountPercent,
  })
}
