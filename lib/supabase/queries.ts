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

// Permanently remove a product row. Existing orders are unaffected because
// their line items are stored as a JSON snapshot, not a foreign key. We do
// clear inventory_log rows first, since they reference product_id.
export async function hardDeleteProduct(id: string): Promise<void> {
  const admin = getSupabaseAdmin()

  const { error: logError } = await admin
    .from('inventory_log')
    .delete()
    .eq('product_id', id)
  if (logError) throw logError

  const { error } = await admin
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

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .insert({
      ...input,
      discount: input.discount ?? 0,
      cod_fee: input.cod_fee ?? 0,
      payment_method: input.payment_method ?? 'prepaid',
      payment_status: 'pending',
      order_status: 'confirmed',
    })
    .select()
    .single()
  if (error) throw error

  // Upsert customer
  await getSupabaseAdmin().from('customers').upsert(
    {
      email: input.customer_email,
      name: input.customer_name,
      phone: input.customer_phone,
      whatsapp_opted_in: input.customer_whatsapp_opted_in,
    },
    { onConflict: 'email' }
  )

  return data as Order
}

export async function updateOrderPayment(
  orderId: string,
  razorpayData: {
    razorpay_order_id: string
    razorpay_payment_id: string
    razorpay_signature: string
  }
): Promise<Order> {
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .update({
      ...razorpayData,
      payment_status: 'paid',
    })
    .eq('id', orderId)
    .select()
    .single()
  if (error) throw error
  return data as Order
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
  payment_status?: string
  order_status?: string
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
    query = query.or(
      `order_number.ilike.%${filters.search}%,customer_name.ilike.%${filters.search}%,customer_email.ilike.%${filters.search}%`
    )
  }

  const limit = filters?.limit ?? 20
  const offset = filters?.offset ?? 0
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
  const { error } = await getSupabaseAdmin().from('notifications_log').insert({
    ...input,
    status: input.status ?? 'sent',
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
