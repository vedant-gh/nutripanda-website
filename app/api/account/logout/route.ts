import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/customer-auth'

export async function POST(request: Request) {
  // 303 so the browser follows with a GET to the orders page.
  const res = NextResponse.redirect(new URL('/account', new URL(request.url).origin), 303)
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
