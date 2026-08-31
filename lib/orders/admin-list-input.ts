import type { Order } from '../../types/supabase.ts'

const PAYMENT_STATUSES: readonly Order['payment_status'][] = [
  'pending', 'paid', 'failed', 'refunded',
]
const ORDER_STATUSES: readonly Order['order_status'][] = [
  'confirmed', 'processing', 'shipped', 'delivered', 'cancelled',
]
const ALLOWED_QUERY_KEYS = new Set([
  'payment_status', 'order_status', 'search', 'limit', 'offset',
])
const SAFE_SEARCH_PATTERN = /^[\p{L}\p{N}\s@._+'-]+$/u

export interface AdminOrderFilters {
  payment_status?: Order['payment_status']
  order_status?: Order['order_status']
  search?: string
  limit: number
  offset: number
}

function boundedInteger(
  raw: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string
): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: fallback }
  if (!/^(?:0|[1-9]\d*)$/.test(raw) || raw.length > 10) {
    return { ok: false, error: `${label} must be a whole number` }
  }
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? { ok: true, value }
    : { ok: false, error: `${label} must be between ${minimum} and ${maximum}` }
}

export function isSafeAdminOrderSearch(value: string): boolean {
  return value.length <= 100 && SAFE_SEARCH_PATTERN.test(value)
}

export function parseAdminOrderFilters(
  searchParams: URLSearchParams
): { ok: true; value: AdminOrderFilters } | { ok: false; error: string } {
  for (const key of searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      return { ok: false, error: `Unsupported query parameter: ${key}` }
    }
    if (searchParams.getAll(key).length !== 1) {
      return { ok: false, error: `${key} must be supplied once` }
    }
  }

  const paymentStatus = searchParams.get('payment_status')
  if (
    paymentStatus !== null
    && !(PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)
  ) {
    return { ok: false, error: 'Invalid payment_status' }
  }

  const orderStatus = searchParams.get('order_status')
  if (orderStatus !== null && !(ORDER_STATUSES as readonly string[]).includes(orderStatus)) {
    return { ok: false, error: 'Invalid order_status' }
  }

  const rawSearch = searchParams.get('search')
  const search = rawSearch?.trim()
  if (search && !isSafeAdminOrderSearch(search)) {
    return {
      ok: false,
      error: 'search must be at most 100 letters, numbers, spaces, or email characters',
    }
  }

  const limit = boundedInteger(searchParams.get('limit'), 20, 1, 100, 'limit')
  if (!limit.ok) return limit
  const offset = boundedInteger(searchParams.get('offset'), 0, 0, 1_000_000, 'offset')
  if (!offset.ok) return offset

  return {
    ok: true,
    value: {
      ...(paymentStatus ? { payment_status: paymentStatus as Order['payment_status'] } : {}),
      ...(orderStatus ? { order_status: orderStatus as Order['order_status'] } : {}),
      ...(search ? { search } : {}),
      limit: limit.value,
      offset: offset.value,
    },
  }
}
