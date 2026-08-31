export interface Product {
  id: string
  name: string
  slug: string
  description: string | null
  short_description: string | null
  price: number
  compare_at_price: number | null
  images: string[] | null
  color_theme: string | null
  ingredients: Ingredient[] | null
  nutrition_facts: NutritionFacts | null
  trust_badges: string[] | null
  category: string | null
  is_active: boolean
  is_featured: boolean
  is_coming_soon: boolean
  inventory_count: number
  seo_title: string | null
  seo_description: string | null
  created_at: string
  updated_at: string
}

export interface Ingredient {
  name: string
  description: string
  amount: string
  unit: string
}

export interface NutritionFacts {
  servingSize: string
  servingsPerContainer?: number
  calories: number
  fields: NutritionField[]
}

export interface NutritionField {
  label: string
  value: string
  dailyPercent: string
}

export interface FAQ {
  id: string
  question: string
  answer: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Testimonial {
  id: string
  customer_name: string
  customer_location: string | null
  text: string
  rating: number | null
  is_active: boolean
  created_at: string
}

export interface Order {
  id: string
  order_number: string
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_whatsapp_opted_in: boolean
  shipping_address: ShippingAddress
  items: OrderItem[]
  subtotal: number
  shipping_cost: number
  discount: number
  cod_fee: number
  total_amount: number
  payment_method: 'prepaid' | 'cod'
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded'
  payment_refunded_at?: string | null
  payment_review_required?: boolean
  payment_review_reason?:
    | 'late_capture_after_cancellation'
    | 'checkout_expired_before_capture'
    | 'inventory_shortfall_after_capture'
    | 'coupon_reservation_lost_after_capture'
    | 'capture_after_failed_attempt'
    | null
  order_status: 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  razorpay_signature: string | null
  currency?: string
  coupon_code?: string | null
  lead_coupon_code?: string | null
  checkout_idempotency_key?: string | null
  checkout_request_fingerprint?: string | null
  inventory_committed_at?: string | null
  inventory_released_at?: string | null
  inventory_reclaimed_at?: string | null
  inventory_reclaim_shortfall?: number
  shipment_delivered_at?: string | null
  fulfillment_review_required?: boolean
  fulfillment_review_reason?:
    | 'delivered_after_cancellation'
    | 'return_inventory_pending'
    | 'legacy_inventory_ledger_mismatch'
    | 'shipment_while_ineligible'
    | null
  notes: string | null
  // Shipping (Proship) — populated when an admin creates a shipment
  proship_order_id?: string | null
  awb_number?: string | null
  courier_name?: string | null
  shipping_label_url?: string | null
  tracking_url?: string | null
  shipment_status?: string | null
  shipped_at?: string | null
  shipment_booking_state?: 'idle' | 'booking' | 'booked' | 'failed' | 'uncertain' | 'cancelling' | 'cancel_uncertain' | 'cancelled'
  shipment_booking_token?: string | null
  shipment_booking_claimed_at?: string | null
  shipment_booking_attempts?: number
  shipment_last_error?: string | null
  shipment_synced_at?: string | null
  shipment_cancel_token?: string | null
  shipment_cancel_claimed_at?: string | null
  shipment_cancelled_at?: string | null
  created_at: string
  updated_at: string
}

export interface ShippingAddress {
  line1: string
  line2?: string
  city: string
  state: string
  pincode: string
}

export interface OrderItem {
  productId: string
  name: string
  slug: string
  price: number
  image: string
  quantity: number
}

export interface Customer {
  id: string
  name: string
  email: string
  phone: string
  whatsapp_opted_in: boolean
  order_count: number
  total_spent: number
  created_at: string
}

export interface InventoryLog {
  id: string
  product_id: string
  product_name: string
  change_type: 'sale' | 'restock' | 'adjustment' | 'return'
  quantity_change: number
  previous_stock: number
  new_stock: number
  order_id: string | null
  notes: string | null
  created_at: string
}

export interface CouponLead {
  id: string
  phone: string
  coupon_code: string
  discount_percent: number
  is_used: boolean
  whatsapp_sent: boolean
  created_at: string
}
