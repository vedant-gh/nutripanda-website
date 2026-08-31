import crypto from 'crypto'
import { validateEmail, validatePhone, validatePincode } from '../utils/validators.ts'
import type { OrderItem, ShippingAddress } from '../../types/supabase.ts'

const MAX_BODY_BYTES = 32 * 1024
const MAX_LINE_ITEMS = 20
const MAX_QUANTITY_PER_PRODUCT = 6
const MAX_TOTAL_QUANTITY = 6
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COUPON_PATTERN = /^[A-Z0-9_-]{3,32}$/
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/

export class CheckoutValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckoutValidationError'
  }
}

type JsonRecord = Record<string, unknown>

export interface CheckoutRequest {
  customer: {
    name: string
    email: string
    phone: string
    whatsappOptIn: boolean
  }
  shippingAddress: ShippingAddress
  items: Array<{ productId: string; quantity: number }>
  couponCode?: string
}

export interface CheckoutProduct {
  id: string
  name: string
  slug: string
  price: number
  images: string[] | null
  inventory_count: number
  is_active: boolean
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(
  value: unknown,
  label: string,
  maxLength: number,
  minLength = 1
): string {
  if (typeof value !== 'string') {
    throw new CheckoutValidationError(`${label} is required`)
  }

  const normalized = value.trim()
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new CheckoutValidationError(
      `${label} must be between ${minLength} and ${maxLength} characters`
    )
  }
  return normalized
}

function optionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requiredString(value, label, maxLength)
}

export async function readCheckoutJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim()
  if (contentType !== 'application/json') {
    throw new CheckoutValidationError('Content-Type must be application/json')
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new CheckoutValidationError('Request body is too large')
  }

  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw new CheckoutValidationError('Request body is too large')
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new CheckoutValidationError('Request body must be valid JSON')
  }
}

export function parseCheckoutRequest(value: unknown): CheckoutRequest {
  if (!isRecord(value)) throw new CheckoutValidationError('Invalid checkout request')

  const customer = value.customer
  const address = value.shippingAddress
  const rawItems = value.items

  if (!isRecord(customer)) throw new CheckoutValidationError('Customer details are required')
  if (!isRecord(address)) throw new CheckoutValidationError('Shipping address is required')
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new CheckoutValidationError('Cart is empty')
  }
  if (rawItems.length > MAX_LINE_ITEMS) {
    throw new CheckoutValidationError(`Cart cannot contain more than ${MAX_LINE_ITEMS} items`)
  }

  const name = requiredString(customer.name, 'Name', 100, 2)
  const email = requiredString(customer.email, 'Email', 254).toLowerCase()
  const phone = requiredString(customer.phone, 'Phone number', 10)
  if (!validateEmail(email)) throw new CheckoutValidationError('Invalid email')
  if (!validatePhone(phone)) throw new CheckoutValidationError('Invalid phone number')
  if (
    customer.whatsappOptIn !== undefined &&
    typeof customer.whatsappOptIn !== 'boolean'
  ) {
    throw new CheckoutValidationError('WhatsApp opt-in must be true or false')
  }

  const line1 = requiredString(address.line1, 'Address line 1', 200, 3)
  const line2 = optionalString(address.line2, 'Address line 2', 200)
  const city = requiredString(address.city, 'City', 100, 2)
  const state = requiredString(address.state, 'State', 100, 2)
  const pincode = requiredString(address.pincode, 'Pincode', 6)
  if (!validatePincode(pincode)) throw new CheckoutValidationError('Invalid pincode')

  const quantities = new Map<string, number>()
  for (const rawItem of rawItems) {
    if (!isRecord(rawItem)) throw new CheckoutValidationError('Invalid cart item')
    const productId = requiredString(rawItem.productId, 'Product ID', 36)
    if (!UUID_PATTERN.test(productId)) {
      throw new CheckoutValidationError('Invalid product ID')
    }
    if (!Number.isInteger(rawItem.quantity)) {
      throw new CheckoutValidationError('Item quantity must be a whole number')
    }

    const quantity = rawItem.quantity as number
    if (quantity < 1 || quantity > MAX_QUANTITY_PER_PRODUCT) {
      throw new CheckoutValidationError(
        `Item quantity must be between 1 and ${MAX_QUANTITY_PER_PRODUCT}`
      )
    }

    const aggregated = (quantities.get(productId) ?? 0) + quantity
    if (aggregated > MAX_QUANTITY_PER_PRODUCT) {
      throw new CheckoutValidationError(
        `A product quantity cannot exceed ${MAX_QUANTITY_PER_PRODUCT}`
      )
    }
    quantities.set(productId, aggregated)
  }
  const totalQuantity = Array.from(quantities.values()).reduce((sum, quantity) => sum + quantity, 0)
  if (totalQuantity > MAX_TOTAL_QUANTITY) {
    throw new CheckoutValidationError(`Checkout cannot contain more than ${MAX_TOTAL_QUANTITY} units`)
  }

  let couponCode: string | undefined
  if (value.couponCode !== undefined && value.couponCode !== null && value.couponCode !== '') {
    couponCode = requiredString(value.couponCode, 'Coupon code', 32).toUpperCase()
    if (!COUPON_PATTERN.test(couponCode)) {
      throw new CheckoutValidationError('Invalid coupon code')
    }
  }

  return {
    customer: {
      name,
      email,
      phone,
      whatsappOptIn: customer.whatsappOptIn === true,
    },
    shippingAddress: { line1, ...(line2 ? { line2 } : {}), city, state, pincode },
    items: Array.from(quantities, ([productId, quantity]) => ({ productId, quantity })),
    couponCode,
  }
}

export function buildCanonicalOrderItems(
  requestedItems: CheckoutRequest['items'],
  products: CheckoutProduct[]
): { items: OrderItem[]; subtotal: number } {
  const productMap = new Map(products.map((product) => [product.id, product]))
  const items: OrderItem[] = []
  let subtotal = 0

  for (const requested of requestedItems) {
    const product = productMap.get(requested.productId)
    if (!product || !product.is_active) {
      throw new CheckoutValidationError('A product in your cart is no longer available')
    }
    if (!Number.isSafeInteger(product.price) || product.price < 0) {
      throw new Error(`Product ${product.id} has an invalid price`)
    }
    if (!Number.isSafeInteger(product.inventory_count) || product.inventory_count < 0) {
      throw new Error(`Product ${product.id} has invalid inventory`)
    }
    if (product.inventory_count < requested.quantity) {
      throw new CheckoutValidationError(
        `Insufficient stock for ${product.name}. Only ${product.inventory_count} left.`
      )
    }

    const lineTotal = product.price * requested.quantity
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) {
      throw new CheckoutValidationError('Cart total is too large')
    }
    subtotal += lineTotal
    items.push({
      productId: product.id,
      name: product.name,
      slug: product.slug,
      price: product.price,
      image: product.images?.[0] ?? '',
      quantity: requested.quantity,
    })
  }

  if (items.length !== requestedItems.length) {
    throw new CheckoutValidationError('A product in your cart is no longer available')
  }
  return { items, subtotal }
}

export function parseIdempotencyKey(request: Request, required: boolean): string | undefined {
  const value = request.headers.get('idempotency-key')?.trim()
  if (!value) {
    if (required) {
      throw new CheckoutValidationError('Idempotency-Key header is required')
    }
    return undefined
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new CheckoutValidationError('Invalid Idempotency-Key header')
  }
  return value
}

export function createRateLimitScope(kind: string, value: string): string {
  if (!/^[a-z][a-z0-9_.-]{1,31}$/.test(kind)) {
    throw new Error('Invalid rate-limit scope kind')
  }
  const secret = process.env.RATE_LIMIT_SECRET ?? process.env.CHECKOUT_RATE_LIMIT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('RATE_LIMIT_SECRET must contain at least 32 characters')
  }
  return `${kind}:${crypto.createHmac('sha256', secret).update(value).digest('hex')}`
}

export function createCheckoutFingerprint(input: CheckoutRequest): string {
  const stablePayload = {
    customer: input.customer,
    shippingAddress: input.shippingAddress,
    items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)),
    couponCode: input.couponCode ?? null,
  }
  return crypto.createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex')
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ??
    'unknown'
  )
}

export const checkoutValidationLimits = {
  maxBodyBytes: MAX_BODY_BYTES,
  maxLineItems: MAX_LINE_ITEMS,
  maxQuantityPerProduct: MAX_QUANTITY_PER_PRODUCT,
} as const
