import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_VERSION = 1
const TOKEN_PURPOSE = 'order_confirmation'
const CLOCK_SKEW_SECONDS = 60
const MAX_TOKEN_LENGTH = 2048

export const ORDER_ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const MINIMUM_ORDER_ACCESS_SECRET_LENGTH = 32

interface OrderAccessPayload {
  v: typeof TOKEN_VERSION
  purpose: typeof TOKEN_PURPOSE
  sub: string
  iat: number
  exp: number
}
export interface VerifiedOrderAccess {
  orderId: string
  issuedAt: number
  expiresAt: number
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function encodePayload(payload: OrderAccessPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function sign(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest()
}

function parsePayload(value: unknown, nowSeconds: number): OrderAccessPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const payload = value as Record<string, unknown>
  if (
    payload.v !== TOKEN_VERSION
    || payload.purpose !== TOKEN_PURPOSE
    || typeof payload.sub !== 'string'
    || !isUuid(payload.sub)
    || typeof payload.iat !== 'number'
    || !Number.isSafeInteger(payload.iat)
    || typeof payload.exp !== 'number'
    || !Number.isSafeInteger(payload.exp)
    || payload.exp <= payload.iat
    || payload.iat > nowSeconds + CLOCK_SKEW_SECONDS
    || payload.exp <= nowSeconds
  ) {
    return null
  }

  return payload as unknown as OrderAccessPayload
}

/**
 * Pure token primitive kept separate from the server-only environment wrapper
 * so expiry, tamper resistance, and order binding can be unit tested.
 */
export function createOrderAccessTokenWithSecret(
  orderId: string,
  secret: string,
  options: { nowSeconds?: number; ttlSeconds?: number } = {}
): string {
  if (!isUuid(orderId)) throw new Error('A valid order UUID is required')
  if (secret.length < MINIMUM_ORDER_ACCESS_SECRET_LENGTH) {
    throw new Error(
      `ORDER_ACCESS_SECRET must be at least ${MINIMUM_ORDER_ACCESS_SECRET_LENGTH} characters`
    )
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  const ttlSeconds = options.ttlSeconds ?? ORDER_ACCESS_TOKEN_TTL_SECONDS
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('Invalid token issue time')
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 24 * 60 * 60) {
    throw new Error('Order access token TTL must be between 1 minute and 24 hours')
  }

  const payload: OrderAccessPayload = {
    v: TOKEN_VERSION,
    purpose: TOKEN_PURPOSE,
    sub: orderId.toLowerCase(),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  }
  const encodedPayload = encodePayload(payload)
  const signature = sign(encodedPayload, secret).toString('base64url')

  return `${encodedPayload}.${signature}`
}

export function verifyOrderAccessTokenWithSecret(
  token: string,
  secret: string,
  expectedOrderId: string,
  options: { nowSeconds?: number } = {}
): VerifiedOrderAccess | null {
  if (
    !token
    || token.length > MAX_TOKEN_LENGTH
    || secret.length < MINIMUM_ORDER_ACCESS_SECRET_LENGTH
    || !isUuid(expectedOrderId)
  ) {
    return null
  }

  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null

  try {
    const suppliedSignature = Buffer.from(parts[1], 'base64url')
    const expectedSignature = sign(parts[0], secret)
    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null
    }

    const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
    const decodedPayload = Buffer.from(parts[0], 'base64url').toString('utf8')
    const payload = parsePayload(JSON.parse(decodedPayload) as unknown, nowSeconds)
    if (!payload || payload.sub !== expectedOrderId.toLowerCase()) return null

    return {
      orderId: payload.sub,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    }
  } catch {
    return null
  }
}
