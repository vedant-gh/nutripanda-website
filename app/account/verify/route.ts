import { NextResponse } from 'next/server'
import {
  verifyMagicToken,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from '@/lib/customer-auth'

// The magic-link target. Verifies the one-time token, sets a 30-day session
// cookie holding the verified email, and redirects to the orders page.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const email = verifyMagicToken(url.searchParams.get('token') ?? undefined)

  if (!email) {
    return NextResponse.redirect(new URL('/account?error=expired', url.origin))
  }

  const res = NextResponse.redirect(new URL('/account', url.origin))
  res.cookies.set(SESSION_COOKIE, createSessionToken(email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return res
}
