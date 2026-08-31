import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  CUSTOMER_AUTH_MINIMUM_SECRET_LENGTH,
  CUSTOMER_SESSION_MAX_AGE_SECONDS,
  createMagicTokenWithSecret,
  createSessionTokenWithSecret,
  hashCustomerEmail,
  hashCustomerMagicToken,
  verifyMagicTokenWithSecret,
  verifySessionTokenWithSecret,
} from '@/lib/customer-auth-core'

export const SESSION_COOKIE = 'np_customer_session'
export const SESSION_MAX_AGE = CUSTOMER_SESSION_MAX_AGE_SECONDS

function getCustomerAuthSecret(): string | null {
  const secret = process.env.CUSTOMER_AUTH_SECRET
  return secret && secret.length >= CUSTOMER_AUTH_MINIMUM_SECRET_LENGTH ? secret : null
}

export function hasCustomerAuthSecret(): boolean {
  return getCustomerAuthSecret() !== null
}

function requireCustomerAuthSecret(): string {
  const secret = getCustomerAuthSecret()
  if (!secret) {
    throw new Error(
      `CUSTOMER_AUTH_SECRET must be at least ${CUSTOMER_AUTH_MINIMUM_SECRET_LENGTH} characters`
    )
  }
  return secret
}

/**
 * Create a cryptographically unique magic link and persist only keyed/digest
 * identifiers. The bearer token itself is never written to Supabase.
 */
export async function createMagicToken(email: string): Promise<string> {
  const secret = requireCustomerAuthSecret()
  const issued = createMagicTokenWithSecret(email, secret)
  const { error } = await getSupabaseAdmin().rpc('issue_customer_magic_token', {
    p_token_hash: issued.tokenHash,
    p_email_hash: issued.emailHash,
    p_expires_at: new Date(issued.expiresAt * 1000).toISOString(),
  })

  if (error) throw error
  return issued.token
}

/**
 * Verify and atomically consume a magic link. Concurrent requests for the same
 * token cannot both succeed because the database update claims the unused row.
 */
export async function consumeMagicToken(token: string | undefined): Promise<string | null> {
  const secret = getCustomerAuthSecret()
  if (!secret) return null

  const verified = verifyMagicTokenWithSecret(token, secret)
  if (!verified || !token) return null

  const { data, error } = await getSupabaseAdmin().rpc('consume_customer_magic_token', {
    p_token_hash: hashCustomerMagicToken(token),
    p_email_hash: hashCustomerEmail(verified.email, secret),
  })

  if (error) throw error
  return data === true ? verified.email : null
}

export function createSessionToken(email: string): string {
  return createSessionTokenWithSecret(email, requireCustomerAuthSecret())
}

export function verifySessionToken(token: string | undefined): string | null {
  const secret = getCustomerAuthSecret()
  if (!secret) return null
  return verifySessionTokenWithSecret(token, secret)?.email ?? null
}

export const customerSessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/account',
  maxAge: SESSION_MAX_AGE,
  priority: 'high',
} as const
