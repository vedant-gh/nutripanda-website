import { supabase } from './client'
import { getSupabaseAdmin } from './admin'
import type {
  Product,
  FAQ,
  Testimonial,
  Order,
  Customer,
  InventoryLog,
  ShippingAddress,
  OrderItem,
} from '@/types/supabase'
import type { BlogPost, BlogBlock } from '@/types/blog'
import { estimateReadingTime } from '@/lib/blog/content'
import { isSafeAdminOrderSearch } from '@/lib/orders/admin-list-input'

// ── Products ──

export async function getAllProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return data as Product[]
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('slug', slug)
    // Active products OR coming-soon teasers both get a page
    .or('is_active.eq.true,is_coming_soon.eq.true')
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return (data as Product) ?? null
}

export async function getFeaturedProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .eq('is_featured', true)
    .order('name')
  if (error) throw error
  return data as Product[]
}

export async function getComingSoonProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_coming_soon', true)
    .order('name')
  if (error) throw error
  return data as Product[]
}

// ── FAQs ──

export async function getAllFAQs(): Promise<FAQ[]> {
  const { data, error } = await supabase
    .from('faqs')
    .select('*')
    .eq('is_active', true)
    .order('display_order')
  if (error) throw error
  return data as FAQ[]
}

// ── Testimonials ──

export async function getAllTestimonials(): Promise<Testimonial[]> {
  const { data, error } = await supabase
    .from('testimonials')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Testimonial[]
}

// ── Admin: Products ──

export async function createProduct(
  product: Omit<Product, 'id' | 'created_at' | 'updated_at'>
): Promise<Product> {
  const { data, error } = await getSupabaseAdmin()
    .from('products')
    .insert(product)
    .select()
    .single()
  if (error) throw error
  return data as Product
}

export async function updateProduct(
  id: string,
  updates: Partial<Omit<Product, 'id' | 'created_at' | 'updated_at'>>
): Promise<Product> {
  const { data, error } = await getSupabaseAdmin()
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Product
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('products')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw error
}

// Permanently remove only a product that has no inventory/audit references.
// PostgreSQL's foreign keys reject products with history. Never delete those
// logs first: doing so would destroy the audit trail even if another reference
// later caused the product deletion itself to fail.
export async function hardDeleteProduct(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('products')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function getAllProductsAdmin(): Promise<Product[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('products')
    .select('*')
    .order('name')
  if (error) throw error
  return data as Product[]
}

export async function getProductById(id: string): Promise<Product | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('products')
    .select('*')
    .eq('id', id)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return (data as Product) ?? null
}

// ── Orders ──

interface CreateOrderInput {
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_whatsapp_opted_in: boolean
  shipping_address: ShippingAddress
  items: OrderItem[]
  subtotal: number
  shipping_cost: number
  discount?: number
  cod_fee?: number
  payment_method?: 'prepaid' | 'cod'
  total_amount: number
  razorpay_order_id?: string
}

interface TransactionalOrderInput extends CreateOrderInput {
  coupon_code?: string
  lead_coupon_code?: string
  idempotency_key?: string
  request_fingerprint: string
}

export async function reservePrepaidOrder(
  input: TransactionalOrderInput & { razorpay_order_id: string }
): Promise<{ order: Order; created: boolean }> {
  const { data, error } = await getSupabaseAdmin().rpc('reserve_prepaid_order', {
    p_checkout: input,
  })
  if (error) throw error
  return data as { order: Order; created: boolean }
}

export async function createCodOrderAtomic(
  input: TransactionalOrderInput & { idempotency_key: string }
): Promise<{ order: Order; created: boolean }> {
  const { data, error } = await getSupabaseAdmin().rpc('create_cod_order', {
    p_checkout: input,
  })
  if (error) throw error
  return data as { order: Order; created: boolean }
}

export async function getOrderByCheckoutIdempotencyKey(
  key: string
): Promise<Order | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .select('*')
    .eq('checkout_idempotency_key', key)
    .maybeSingle()
  if (error) throw error
  return (data as Order | null) ?? null
}

export async function finalizeRazorpayPayment(input: {
  order_id?: string
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature?: string
  amount: number
  currency: 'INR'
  webhook_event_id?: string
  webhook_event_type?: string
  webhook_payload_hash?: string
}): Promise<{
  order: Order
  newly_finalized: boolean
  requires_refund: boolean
  payment_review_reason: Order['payment_review_reason']
}> {
  const { data, error } = await getSupabaseAdmin().rpc('finalize_razorpay_payment', {
    p_order_id: input.order_id ?? null,
    p_razorpay_order_id: input.razorpay_order_id,
    p_razorpay_payment_id: input.razorpay_payment_id,
    p_razorpay_signature: input.razorpay_signature ?? null,
    p_amount: input.amount,
    p_currency: input.currency,
    p_webhook_event_id: input.webhook_event_id ?? null,
    p_webhook_event_type: input.webhook_event_type ?? null,
    p_webhook_payload_hash: input.webhook_payload_hash ?? null,
  })
  if (error) throw error
  return data as {
    order: Order
    newly_finalized: boolean
    requires_refund: boolean
    payment_review_reason: Order['payment_review_reason']
  }
}

export async function hasActivePrepaidReservations(order: Pick<Order, 'id' | 'items'>) {
  const { data, error } = await getSupabaseAdmin()
    .from('inventory_reservations')
    .select('product_id,quantity,status,expires_at')
    .eq('order_id', order.id)

  if (error) throw error
  if (!Array.isArray(data) || data.length !== order.items.length) return false

  const expected = new Map(order.items.map((item) => [item.productId, item.quantity]))
  const now = Date.now()
  return data.every((reservation) => (
    reservation.status === 'reserved'
    && typeof reservation.expires_at === 'string'
    && Date.parse(reservation.expires_at) > now
    && expected.get(String(reservation.product_id)) === reservation.quantity
  ))
}

export async function renewPrepaidCheckoutReservation(
  orderId: string,
  requestFingerprint: string
): Promise<Order> {
  const { data, error } = await getSupabaseAdmin().rpc('renew_prepaid_checkout_reservation', {
    p_order_id: orderId,
    p_fingerprint: requestFingerprint,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('renew_prepaid_checkout_reservation returned no order')
  return row as Order
}

export async function recordRazorpayPaymentFailure(input: {
  razorpay_order_id: string
  razorpay_payment_id: string
  webhook_event_id: string
  webhook_event_type: string
  webhook_payload_hash: string
}): Promise<{ duplicate: boolean }> {
  const { data, error } = await getSupabaseAdmin().rpc('record_razorpay_payment_failure', {
    p_razorpay_order_id: input.razorpay_order_id,
    p_razorpay_payment_id: input.razorpay_payment_id,
    p_webhook_event_id: input.webhook_event_id,
    p_webhook_event_type: input.webhook_event_type,
    p_webhook_payload_hash: input.webhook_payload_hash,
  })
  if (error) throw error
  return data as { duplicate: boolean }
}

export async function consumeRateLimit(input: {
  scope_key: string
  action: string
  limit: number
  window_seconds: number
}): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc('consume_rate_limit', {
    p_scope_key: input.scope_key,
    p_action: input.action,
    p_limit: input.limit,
    p_window_seconds: input.window_seconds,
  })
  if (error) throw error
  return data === true
}

export const consumeCheckoutRateLimit = consumeRateLimit

export async function adjustInventoryAtomic(input: {
  product_id: string
  quantity_change: number
  change_type?: 'restock' | 'adjustment' | 'return'
  notes?: string
}): Promise<{
  product_id: string
  previous_stock: number
  new_stock: number
  quantity_change: number
  log: InventoryLog
}> {
  const { data, error } = await getSupabaseAdmin().rpc('admin_adjust_inventory', {
    p_product_id: input.product_id,
    p_quantity_change: input.quantity_change,
    p_change_type: input.change_type ?? 'adjustment',
    p_notes: input.notes ?? null,
  })
  if (error) throw error
  return data as {
    product_id: string
    previous_stock: number
    new_stock: number
    quantity_change: number
    log: InventoryLog
  }
}

export async function updateOrderStatus(
  orderId: string,
  status: Order['order_status']
): Promise<Order> {
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .update({ order_status: status })
    .eq('id', orderId)
    .select()
    .single()
  if (error) throw error
  return data as Order
}

// Store Proship shipment details (AWB, label, courier) on an order after a
// shipment is created from the admin dashboard.
export async function updateOrderShipment(
  orderId: string,
  shipment: {
    proship_order_id?: string | null
    awb_number?: string | null
    courier_name?: string | null
    shipping_label_url?: string | null
    tracking_url?: string | null
    shipment_status?: string | null
    shipped_at?: string | null
  }
): Promise<Order> {
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .update(shipment)
    .eq('id', orderId)
    .select()
    .single()
  if (error) throw error
  return data as Order
}

export async function getOrders(filters?: {
  payment_status?: Order['payment_status']
  order_status?: Order['order_status']
  search?: string
  limit?: number
  offset?: number
}): Promise<{ orders: Order[]; count: number }> {
  let query = getSupabaseAdmin()
    .from('orders')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (filters?.payment_status) {
    query = query.eq('payment_status', filters.payment_status)
  }
  if (filters?.order_status) {
    query = query.eq('order_status', filters.order_status)
  }
  if (filters?.search) {
    if (!isSafeAdminOrderSearch(filters.search)) {
      throw new Error('Unsafe admin order search')
    }
    query = query.or(
      `order_number.ilike.%${filters.search}%,customer_name.ilike.%${filters.search}%,customer_email.ilike.%${filters.search}%`
    )
  }

  const limit = Math.min(100, Math.max(1, Math.trunc(filters?.limit ?? 20)))
  const offset = Math.min(1_000_000, Math.max(0, Math.trunc(filters?.offset ?? 0)))
  query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query
  if (error) throw error
  return { orders: data as Order[], count: count ?? 0 }
}

export async function getOrderById(id: string): Promise<Order | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .select('*')
    .eq('id', id)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return (data as Order) ?? null
}

export async function getOrderByRazorpayOrderId(
  razorpayOrderId: string
): Promise<Order | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .select('*')
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle()
  if (error) throw error
  return (data as Order | null) ?? null
}

// All orders for a customer email (for the "My Orders" magic-link page).
export async function getOrdersByEmail(email: string): Promise<Order[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .select('*')
    .eq('customer_email', email.trim().toLowerCase())
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Order[]
}

// ── Inventory ──

export async function logInventoryChange(input: {
  product_id: string
  product_name: string
  change_type: InventoryLog['change_type']
  quantity_change: number
  previous_stock: number
  new_stock: number
  order_id?: string
  notes?: string
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from('inventory_log').insert(input)
  if (error) throw error
}

export async function getInventoryLog(
  productId?: string
): Promise<InventoryLog[]> {
  let query = getSupabaseAdmin()
    .from('inventory_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (productId) {
    query = query.eq('product_id', productId)
  }

  const { data, error } = await query
  if (error) throw error
  return data as InventoryLog[]
}

// ── Notifications ──

export async function logNotification(input: {
  order_id?: string
  channel: 'email' | 'whatsapp' | 'sms'
  recipient: string
  template: string
  status?: 'sent' | 'delivered' | 'failed'
  error_message?: string
}): Promise<void> {
  const status = input.status ?? 'sent'
  const { error } = await getSupabaseAdmin().from('notifications_log').insert({
    ...input,
    status,
    sent_at: status === 'sent' || status === 'delivered'
      ? new Date().toISOString()
      : null,
  })
  if (error) throw error
}

// ── Customers ──

export async function getCustomers(filters?: {
  search?: string
  limit?: number
  offset?: number
}): Promise<{ customers: Customer[]; count: number }> {
  let query = getSupabaseAdmin()
    .from('customers')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (filters?.search) {
    query = query.or(
      `name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`
    )
  }

  const limit = filters?.limit ?? 20
  const offset = filters?.offset ?? 0
  query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query
  if (error) throw error
  return { customers: data as Customer[], count: count ?? 0 }
}

// ── Blog (public) ──

export async function getPublishedBlogPosts(): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
  if (error) throw error
  return data as BlogPost[]
}

export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return (data as BlogPost) ?? null
}

export async function getRelatedBlogPosts(
  excludeSlug: string,
  limit = 3
): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('status', 'published')
    .neq('slug', excludeSlug)
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as BlogPost[]
}

// ── Blog (admin) ──

export interface BlogPostInput {
  slug: string
  title: string
  excerpt?: string | null
  cover_image_url?: string | null
  content: BlogBlock[]
  author?: string | null
  tags?: string[]
  category?: string | null
  status?: 'draft' | 'published'
  is_featured?: boolean
  seo_title?: string | null
  seo_description?: string | null
}

export async function getAllBlogPostsAdmin(): Promise<BlogPost[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('blog_posts')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data as BlogPost[]
}

export async function getBlogPostById(id: string): Promise<BlogPost | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('blog_posts')
    .select('*')
    .eq('id', id)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return (data as BlogPost) ?? null
}

export async function createBlogPost(input: BlogPostInput): Promise<BlogPost> {
  const status = input.status ?? 'draft'
  const { data, error } = await getSupabaseAdmin()
    .from('blog_posts')
    .insert({
      ...input,
      reading_time: estimateReadingTime(input.content ?? []),
      published_at: status === 'published' ? new Date().toISOString() : null,
    })
    .select()
    .single()
  if (error) throw error
  return data as BlogPost
}

export async function updateBlogPost(
  id: string,
  updates: Partial<BlogPostInput>
): Promise<BlogPost> {
  const admin = getSupabaseAdmin()
  const patch: Record<string, unknown> = { ...updates }

  if (updates.content) {
    patch.reading_time = estimateReadingTime(updates.content)
  }
  // Stamp published_at the first time a post goes live; preserve it afterwards.
  if (updates.status === 'published') {
    const { data: current } = await admin
      .from('blog_posts')
      .select('published_at')
      .eq('id', id)
      .single()
    if (!current?.published_at) patch.published_at = new Date().toISOString()
  }

  const { data, error } = await admin
    .from('blog_posts')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as BlogPost
}

export async function deleteBlogPost(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('blog_posts')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── Coupons (admin-managed) ──

export interface Coupon {
  id: string
  code: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
  min_subtotal: number
  max_discount: number | null
  is_active: boolean
  expires_at: string | null
  description: string | null
  created_at: string
  updated_at: string
}

export interface CouponInput {
  code: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
  min_subtotal?: number
  max_discount?: number | null
  is_active?: boolean
  expires_at?: string | null
  description?: string | null
}

export async function getAllCouponsAdmin(): Promise<Coupon[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Coupon[]
}

/** Look up a coupon by code (service role — used for server-side validation). */
export async function getCouponByCode(code: string): Promise<Coupon | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('coupons')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle()
  if (error) throw error
  return (data as Coupon) ?? null
}

export async function createCoupon(input: CouponInput): Promise<Coupon> {
  const { data, error } = await getSupabaseAdmin()
    .from('coupons')
    .insert({ ...input, code: input.code.trim().toUpperCase() })
    .select()
    .single()
  if (error) throw error
  return data as Coupon
}

export async function updateCoupon(
  id: string,
  updates: Partial<CouponInput>
): Promise<Coupon> {
  const patch: Partial<CouponInput> = { ...updates }
  if (patch.code) patch.code = patch.code.trim().toUpperCase()
  const { data, error } = await getSupabaseAdmin()
    .from('coupons')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Coupon
}

export async function deleteCoupon(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from('coupons').delete().eq('id', id)
  if (error) throw error
}
