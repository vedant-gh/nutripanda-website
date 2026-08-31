import { NextResponse } from 'next/server'
import { customerSessionCookieOptions, SESSION_COOKIE } from '@/lib/customer-auth'

export async function POST(request: Request) {
  // 303 so the browser follows with a GET to the orders page.
  const response = NextResponse.redirect(new URL('/account', new URL(request.url).origin), 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.cookies.set(SESSION_COOKIE, '', {
    ...customerSessionCookieOptions,
    maxAge: 0,
  })
  return response
}
