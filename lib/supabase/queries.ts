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
