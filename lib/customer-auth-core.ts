import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export const CUSTOMER_AUTH_MINIMUM_SECRET_LENGTH = 32
export const CUSTOMER_MAGIC_TTL_SECONDS = 15 * 60
export const CUSTOMER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

const MAX_TOKEN_LENGTH = 4096
const MAX_CLOCK_SKEW_SECONDS = 60
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const JTI_PATTERN = /^[A-Za-z0-9_-]{32,128}$/

type CustomerTokenPurpose = 'magic' | 'session'

interface CustomerTokenPayload {
  v: 1
  email: string
  purpose: CustomerTokenPurpose
  iat: number
  exp: number
  jti: string
}

export interface VerifiedCustomerToken {
  email: string
  issuedAt: number
  expiresAt: number
  jti: string
}

interface TokenCreationOptions {
  nowSeconds?: number
  randomId?: string
}

interface TokenVerificationOptions {
  nowSeconds?: number
}

export interface IssuedMagicToken extends VerifiedCustomerToken {
  token: string
  tokenHash: string
  emailHash: string
}

function assertStrongSecret(secret: string): void {
  if (secret.length < CUSTOMER_AUTH_MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `CUSTOMER_AUTH_SECRET must be at least ${CUSTOMER_AUTH_MINIMUM_SECRET_LENGTH} characters`
    )
  }
}

export function normalizeCustomerEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isNormalizedEmail(email: unknown): email is string {
  return (
    typeof email === 'string'
    && email.length > 0
    && email.length <= 254
    && email === normalizeCustomerEmail(email)
    && EMAIL_PATTERN.test(email)
  )
}

function assertJti(jti: string): void {
  if (!JTI_PATTERN.test(jti)) {
    throw new Error('Customer token identifier is invalid')
  }
}

function signPayload(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest()
}

function createToken(
  email: string,
  purpose: CustomerTokenPurpose,
  ttlSeconds: number,
  secret: string,
  options: TokenCreationOptions = {}
): { token: string; payload: CustomerTokenPayload } {
  assertStrongSecret(secret)

  const normalizedEmail = normalizeCustomerEmail(email)
  if (!isNormalizedEmail(normalizedEmail)) {
    throw new Error('Customer email is invalid')
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('Customer token issue time is invalid')
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new Error('Customer token lifetime is invalid')
  }

  const jti = options.randomId ?? randomBytes(32).toString('base64url')
  assertJti(jti)

  const payload: CustomerTokenPayload = {
    v: 1,
    email: normalizedEmail,
    purpose,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    jti,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = signPayload(encodedPayload, secret).toString('base64url')

  return { token: `${encodedPayload}.${signature}`, payload }
}

function parseToken(
  token: string | undefined,
  purpose: CustomerTokenPurpose,
  maximumLifetimeSeconds: number,
  secret: string,
  options: TokenVerificationOptions = {}
): VerifiedCustomerToken | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null

  try {
    assertStrongSecret(secret)

    const parts = token.split('.')
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null

    const suppliedSignature = Buffer.from(parts[1], 'base64url')
    const expectedSignature = signPayload(parts[0], secret)
    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null
    }

    const decoded = Buffer.from(parts[0], 'base64url').toString('utf8')
    const rawPayload = JSON.parse(decoded) as unknown
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return null

    const payload = rawPayload as Record<string, unknown>
    const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
    if (
      payload.v !== 1
      || payload.purpose !== purpose
      || !isNormalizedEmail(payload.email)
      || typeof payload.iat !== 'number'
      || !Number.isSafeInteger(payload.iat)
      || typeof payload.exp !== 'number'
      || !Number.isSafeInteger(payload.exp)
      || typeof payload.jti !== 'string'
      || !JTI_PATTERN.test(payload.jti)
      || payload.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS
      || payload.exp <= nowSeconds
      || payload.exp <= payload.iat
      || payload.exp - payload.iat > maximumLifetimeSeconds
    ) {
      return null
    }

    return {
      email: payload.email,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
      jti: payload.jti,
    }
  } catch {
    return null
  }
}

export function hashCustomerMagicToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function hashCustomerEmail(email: string, secret: string): string {
  assertStrongSecret(secret)
  return createHmac('sha256', secret)
    .update(`customer-email:${normalizeCustomerEmail(email)}`, 'utf8')
    .digest('hex')
}

export function createMagicTokenWithSecret(
  email: string,
  secret: string,
  options: TokenCreationOptions = {}
): IssuedMagicToken {
  const { token, payload } = createToken(
    email,
    'magic',
    CUSTOMER_MAGIC_TTL_SECONDS,
    secret,
    options
  )

  return {
    token,
    tokenHash: hashCustomerMagicToken(token),
    emailHash: hashCustomerEmail(payload.email, secret),
    email: payload.email,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    jti: payload.jti,
  }
}

export function verifyMagicTokenWithSecret(
  token: string | undefined,
  secret: string,
  options: TokenVerificationOptions = {}
): VerifiedCustomerToken | null {
  return parseToken(
    token,
    'magic',
    CUSTOMER_MAGIC_TTL_SECONDS,
    secret,
    options
  )
}

export function createSessionTokenWithSecret(
  email: string,
  secret: string,
  options: TokenCreationOptions = {}
): string {
  return createToken(
    email,
    'session',
    CUSTOMER_SESSION_MAX_AGE_SECONDS,
    secret,
    options
  ).token
}

export function verifySessionTokenWithSecret(
  token: string | undefined,
  secret: string,
  options: TokenVerificationOptions = {}
): VerifiedCustomerToken | null {
  return parseToken(
    token,
    'session',
    CUSTOMER_SESSION_MAX_AGE_SECONDS,
    secret,
    options
  )
}
