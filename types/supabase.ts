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
  order_status: 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  razorpay_signature: string | null
  notes: string | null
  // Shipping (Proship) — populated when an admin creates a shipment
  proship_order_id?: string | null
  awb_number?: string | null
  courier_name?: string | null
  shipping_label_url?: string | null
  tracking_url?: string | null
  shipment_status?: string | null
  shipped_at?: string | null
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
