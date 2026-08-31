import { NextResponse } from 'next/server'
import {
  consumeMagicToken,
  createSessionToken,
  customerSessionCookieOptions,
  SESSION_COOKIE,
} from '@/lib/customer-auth'

function getCanonicalOrigin(requestUrl: URL): string {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!configuredUrl && process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL is required for customer magic links')
  }

  const url = new URL(configuredUrl ?? requestUrl.origin)
  const isLocalDevelopment =
    process.env.NODE_ENV !== 'production'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (url.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('Customer magic-link origin must use HTTPS')
  }
  return url.origin
}

function redirectWithoutToken(origin: string, error?: string): NextResponse {
  const destination = new URL('/account', origin)
  if (error) destination.searchParams.set('error', error)

  const response = NextResponse.redirect(destination, 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

// The magic-link target atomically consumes the one-time credential before it
// creates a scoped 30-day customer session. The token is removed from the URL
// by the redirect and is never copied into another response or log entry.
export async function GET(request: Request) {
  const url = new URL(request.url)
  let canonicalOrigin: string | null = null
  try {
    canonicalOrigin = getCanonicalOrigin(url)
    const email = await consumeMagicToken(url.searchParams.get('token') ?? undefined)
    if (!email) return redirectWithoutToken(canonicalOrigin, 'expired')

    const response = redirectWithoutToken(canonicalOrigin)
    response.cookies.set(SESSION_COOKIE, createSessionToken(email), customerSessionCookieOptions)
    return response
  } catch {
    // A database/configuration failure is intentionally indistinguishable from
    // an invalid token and never includes the bearer credential in logs.
    console.error('Customer magic-link verification failed')
    if (canonicalOrigin) return redirectWithoutToken(canonicalOrigin, 'expired')

    const response = NextResponse.json(
      { error: 'Sign-in is temporarily unavailable. Please try again later.' },
      { status: 503 }
    )
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return response
  }
}
