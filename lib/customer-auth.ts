import { createHmac, timingSafeEqual } from 'crypto'

// Lightweight, stateless customer auth for the "My Orders" magic-link flow.
// Tokens are HMAC-signed (no DB/session table needed). Falls back to the
// service-role key as the signing secret if CUSTOMER_AUTH_SECRET isn't set.
const SECRET =
  process.env.CUSTOMER_AUTH_SECRET ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'nutripanda-dev-secret'

export const SESSION_COOKIE = 'np_customer_session'
const MAGIC_TTL = 15 * 60 // 15 minutes
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60 // 30 days

type Purpose = 'magic' | 'session'

interface TokenPayload {
  email: string
  purpose: Purpose
  exp: number
}

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('base64url')
}

function makeToken(email: string, purpose: Purpose, ttl: number): string {
  const payload: TokenPayload = {
    email: email.trim().toLowerCase(),
    purpose,
    exp: Math.floor(Date.now() / 1000) + ttl,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

// Returns the verified email, or null if the token is missing/tampered/expired
// or signed for a different purpose.
function readToken(token: string | undefined, purpose: Purpose): string | null {
  if (!token) return null
  const [body, providedSig] = token.split('.')
  if (!body || !providedSig) return null

  const expectedSig = sign(body)
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload
    if (payload.purpose !== purpose) return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload.email
  } catch {
    return null
  }
}

export const createMagicToken = (email: string) => makeToken(email, 'magic', MAGIC_TTL)
export const verifyMagicToken = (token: string | undefined) => readToken(token, 'magic')
export const createSessionToken = (email: string) => makeToken(email, 'session', SESSION_MAX_AGE)
export const verifySessionToken = (token: string | undefined) => readToken(token, 'session')
