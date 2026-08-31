import { NextResponse } from 'next/server'
import {
  ADMIN_COOKIE_NAME,
  authenticateDashboardCredentials,
  createDashboardSessionToken,
  getDashboardSession,
  getSessionCookieOptions,
  hasDashboardCredentials,
  hasDashboardSessionSecret,
} from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { consumeRateLimit } from '@/lib/supabase/queries'
import { clearRateLimit, releaseRateLimitAttempt } from '@/lib/supabase/rate-limit'
import { createRateLimitScope, getClientIp } from '@/lib/orders/checkout-validation'
import { hasOnlyKeys, readBoundedJsonObject } from '@/lib/utils/request-input'

const LOGIN_RATE_ACTION = 'dashboard_login'
const LOGIN_RATE_LIMIT = 5
const LOGIN_WINDOW_SECONDS = 30 * 60
const MAX_LOGIN_BODY_BYTES = 2 * 1024

function dashboardUserResponse(session: { sub: string; name: string; role: string }) {
  return {
    id: session.sub,
    name: session.name,
    role: session.role,
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// POST — log in as the full admin or one of the two blog editors.
export async function POST(request: Request) {
  try {
    const parsed = await readBoundedJsonObject(request, { maxBytes: MAX_LOGIN_BODY_BYTES })
    if (!parsed.ok) {
      return withCors(
        noStore(NextResponse.json({ error: parsed.error }, { status: parsed.status })),
        request
      )
    }
    const body = parsed.value
    if (!hasOnlyKeys(body, ['email', 'password'])) {
      return withCors(
        noStore(NextResponse.json({ error: 'Invalid request fields' }, { status: 400 })),
        request
      )
    }

    const { email, password } = body
    if (typeof password !== 'string' || !password || password.length > 512) {
      return withCors(
        noStore(NextResponse.json({ error: 'Password required' }, { status: 400 })),
        request
      )
    }

    if (
      email !== undefined &&
      (typeof email !== 'string' || email.length > 254)
    ) {
      return withCors(
        noStore(NextResponse.json({ error: 'Email must be a string' }, { status: 400 })),
        request
      )
    }

    if (!hasDashboardCredentials() || !hasDashboardSessionSecret()) {
      console.error(
        'Dashboard auth requires at least one configured account and a DASHBOARD_SESSION_SECRET of at least 32 characters'
      )
      return withCors(
        noStore(NextResponse.json({ error: 'Server configuration error' }, { status: 500 })),
        request
      )
    }

    const identity = typeof email === 'string' && email.trim()
      ? email.trim().toLowerCase()
      : 'password-only'
    const ipScope = createRateLimitScope('dashboard_ip', getClientIp(request))
    const identityScope = createRateLimitScope('dashboard_identity', identity)
    const scopeKeys = [ipScope, identityScope]
    // Consume both counters atomically before comparing credentials. A
    // read-then-increment flow lets parallel attempts all pass the read.
    const allowed = await Promise.all(
      scopeKeys.map((scope_key) => consumeRateLimit({
        scope_key,
        action: LOGIN_RATE_ACTION,
        limit: LOGIN_RATE_LIMIT,
        window_seconds: LOGIN_WINDOW_SECONDS,
      }))
    )
    if (allowed.some((entry) => !entry)) {
      const response = NextResponse.json(
        { error: 'Too many failed attempts. Try again in 30 minutes.' },
        { status: 429 }
      )
      response.headers.set('Retry-After', String(LOGIN_WINDOW_SECONDS))
      return withCors(noStore(response), request)
    }

    const user = authenticateDashboardCredentials(email as string | undefined, password)
    if (!user) {
      return withCors(
        noStore(NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })),
        request
      )
    }

    // Clear this known account's failed identity history, but only subtract the
    // successful request itself from the shared IP bucket. A valid editor login
    // must not erase concurrent/admin-password guesses from the same address.
    await Promise.all([
      clearRateLimit(identityScope, LOGIN_RATE_ACTION),
      releaseRateLimitAttempt(ipScope, LOGIN_RATE_ACTION),
    ])

    const { token, session } = createDashboardSessionToken(user)
    const response = NextResponse.json({
      success: true,
      authenticated: true,
      user: dashboardUserResponse(session),
    })
    response.cookies.set(ADMIN_COOKIE_NAME, token, getSessionCookieOptions())

    return withCors(noStore(response), request)
  } catch (error) {
    console.error('Dashboard auth error:', error)
    return withCors(
      noStore(NextResponse.json({ error: 'Authentication failed' }, { status: 500 })),
      request
    )
  }
}

// GET — return the current role-aware dashboard session.
export async function GET(request: Request) {
  const session = await getDashboardSession()
  const response = session
    ? NextResponse.json({
        authenticated: true,
        user: dashboardUserResponse(session),
      })
    : NextResponse.json({ authenticated: false, user: null })

  return withCors(noStore(response), request)
}

// DELETE — log out and expire the dashboard session cookie.
export async function DELETE(request: Request) {
  const response = NextResponse.json({ success: true })
  response.cookies.set(ADMIN_COOKIE_NAME, '', {
    ...getSessionCookieOptions(),
    maxAge: 0,
  })

  return withCors(noStore(response), request)
}
