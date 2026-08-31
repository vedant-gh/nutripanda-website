import { hasOnlyKeys, type JsonObject } from '../utils/request-input.ts'
import type { CouponInput } from '../supabase/queries.ts'

export const MAX_COUPON_BODY_BYTES = 4 * 1024
export const MAX_COUPON_AMOUNT_PAISE = 2_000_000_000

const COUPON_KEYS = [
  'code',
  'discount_type',
  'discount_value',
  'min_subtotal',
  'max_discount',
  'is_active',
  'expires_at',
  'description',
] as const
const PUBLIC_COUPON_KEYS = ['code', 'subtotal'] as const
const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/
const RFC_3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i

type ParsedCouponInput<T extends Partial<CouponInput>> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export type PublicCouponInput = { code: string; subtotal: number }

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): { ok: true; value: number } | { ok: false; error: string } {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return { ok: false, error: `${label} must be an integer between ${minimum} and ${maximum}` }
  }
  return { ok: true, value: value as number }
}

function code(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return COUPON_CODE_PATTERN.test(normalized)
    ? { ok: true, value: normalized }
    : { ok: false, error: 'Coupon code must be 3-32 letters, numbers, hyphens, or underscores' }
}

function nullableExpiry(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'string' || value.length > 64 || !RFC_3339_PATTERN.test(value)) {
    return { ok: false, error: 'expires_at must be null or a valid RFC 3339 timestamp' }
  }
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})/.exec(value) ?? []
  const daysInMonth = year && month
    ? new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
    : 0
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth) {
    return { ok: false, error: 'expires_at must be null or a valid RFC 3339 timestamp' }
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    ? { ok: true, value: new Date(timestamp).toISOString() }
    : { ok: false, error: 'expires_at must be null or a valid RFC 3339 timestamp' }
}

function nullableDescription(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'string' || value.length > 500) {
    return { ok: false, error: 'description must be null or at most 500 characters' }
  }
  const normalized = value.trim()
  return { ok: true, value: normalized || null }
}

export function parseCouponInput(body: JsonObject, mode: 'create'): ParsedCouponInput<CouponInput>
export function parseCouponInput(
  body: JsonObject,
  mode: 'update'
): ParsedCouponInput<Partial<CouponInput>>
export function parseCouponInput(
  body: JsonObject,
  mode: 'create' | 'update'
): ParsedCouponInput<Partial<CouponInput>> {
  if (!hasOnlyKeys(body, COUPON_KEYS)) {
    return { ok: false, error: 'Request contains unsupported coupon fields' }
  }
  if (mode === 'update' && Object.keys(body).length === 0) {
    return { ok: false, error: 'At least one coupon field is required' }
  }

  const patch: Partial<CouponInput> = {}
  const has = (key: keyof CouponInput) => Object.prototype.hasOwnProperty.call(body, key)

  if (mode === 'create' || has('code')) {
    const parsed = code(body.code)
    if (!parsed.ok) return parsed
    patch.code = parsed.value
  }

  const hasType = has('discount_type')
  const hasValue = has('discount_value')
  if (mode === 'create' && (!hasType || !hasValue)) {
    return { ok: false, error: 'discount_type and discount_value are required' }
  }
  if (mode === 'update' && hasType !== hasValue) {
    return { ok: false, error: 'discount_type and discount_value must be changed together' }
  }
  if (hasType && hasValue) {
    if (body.discount_type !== 'percent' && body.discount_type !== 'fixed') {
      return { ok: false, error: 'discount_type must be percent or fixed' }
    }
    const maximum = body.discount_type === 'percent' ? 100 : MAX_COUPON_AMOUNT_PAISE
    const parsed = integer(body.discount_value, 'discount_value', 1, maximum)
    if (!parsed.ok) return parsed
    patch.discount_type = body.discount_type
    patch.discount_value = parsed.value
  }

  if (has('min_subtotal')) {
    const parsed = integer(body.min_subtotal, 'min_subtotal', 0, MAX_COUPON_AMOUNT_PAISE)
    if (!parsed.ok) return parsed
    patch.min_subtotal = parsed.value
  } else if (mode === 'create') {
    patch.min_subtotal = 0
  }

  if (has('max_discount')) {
    if (body.max_discount === null) {
      patch.max_discount = null
    } else {
      const parsed = integer(body.max_discount, 'max_discount', 0, MAX_COUPON_AMOUNT_PAISE)
      if (!parsed.ok) return parsed
      patch.max_discount = parsed.value
    }
  } else if (mode === 'create') {
    patch.max_discount = null
  }

  if (has('is_active')) {
    if (typeof body.is_active !== 'boolean') {
      return { ok: false, error: 'is_active must be boolean' }
    }
    patch.is_active = body.is_active
  } else if (mode === 'create') {
    patch.is_active = true
  }

  if (has('expires_at')) {
    const parsed = nullableExpiry(body.expires_at)
    if (!parsed.ok) return parsed
    patch.expires_at = parsed.value
  } else if (mode === 'create') {
    patch.expires_at = null
  }

  if (has('description')) {
    const parsed = nullableDescription(body.description)
    if (!parsed.ok) return parsed
    patch.description = parsed.value
  } else if (mode === 'create') {
    patch.description = null
  }

  return { ok: true, value: patch }
}

export function parsePublicCouponInput(
  body: JsonObject
): { ok: true; value: PublicCouponInput } | { ok: false; error: string } {
  if (!hasOnlyKeys(body, PUBLIC_COUPON_KEYS)) {
    return { ok: false, error: 'Request contains unsupported fields' }
  }
  const parsedCode = code(body.code)
  if (!parsedCode.ok) return parsedCode
  const subtotal = integer(body.subtotal, 'subtotal', 1, MAX_COUPON_AMOUNT_PAISE)
  if (!subtotal.ok) return subtotal
  return { ok: true, value: { code: parsedCode.value, subtotal: subtotal.value } }
}
