import 'server-only'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import {
  findDashboardBlogEditorByEmail,
  findDashboardBlogEditorSessionById,
  recordDashboardBlogEditorLogin,
} from '@/lib/supabase/dashboard-blog-editors'
import {
  consumeDummyDashboardPasswordCheck,
  verifyDashboardEditorPassword,
} from '@/lib/dashboard-auth/editor-password'

const ADMIN_COOKIE_NAME = 'nutripanda_admin_session'
const SESSION_MAX_AGE = 60 * 60 * 24 // 24 hours
const MINIMUM_SESSION_SECRET_LENGTH = 32

export type DashboardRole = 'admin' | 'blog_editor'

export interface DashboardUser {
  id: string
  name: string
  role: DashboardRole
  sessionVersion: number
}

export interface DashboardSession {
  sub: string
  name: string
  role: DashboardRole
  ver: number
  exp: number
}

export type DashboardAuthorization =
  | { authorized: true; session: DashboardSession }
  | { authorized: false; status: 401 | 403; error: 'Unauthorized' | 'Forbidden' }

function safeEqual(left: string, right: string): boolean {
  // Hashing first gives timingSafeEqual fixed-size inputs, regardless of the
  // lengths of user-controlled credentials.
  const leftDigest = createHash('sha256').update(left, 'utf8').digest()
  const rightDigest = createHash('sha256').update(right, 'utf8').digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function hasDashboardCredentials(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD)
}

export function hasDashboardSessionSecret(): boolean {
  return (process.env.DASHBOARD_SESSION_SECRET?.length ?? 0) >= MINIMUM_SESSION_SECRET_LENGTH
}

/**
 * Match configured dashboard credentials without using ordinary string
 * equality for either the email or password.
 *
 * Password-only login is retained for the original admin login form and is
 * deliberately never available to editors. Editor creation/reset rejects the
 * admin email and password so the credentials cannot become ambiguous.
 */
export function dashboardEditorConflictsWithAdminCredentials(
  email: string,
  password: string
): boolean {
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD

  return Boolean(
    (adminEmail && safeEqual(normalizeEmail(email), normalizeEmail(adminEmail)))
    || (adminPassword && safeEqual(password, adminPassword))
  )
}

export async function authenticateDashboardCredentials(
  email: string | undefined,
  password: string
): Promise<DashboardUser | null> {
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) return null

  const normalizedEmail = email ? normalizeEmail(email) : ''

  if (!normalizedEmail) {
    return safeEqual(password, adminPassword)
      ? { id: 'admin', name: 'Administrator', role: 'admin', sessionVersion: 1 }
      : null
  }

  const adminEmail = process.env.ADMIN_EMAIL
  if (adminEmail && safeEqual(normalizedEmail, normalizeEmail(adminEmail))) {
    if (safeEqual(password, adminPassword)) {
      return { id: 'admin', name: 'Administrator', role: 'admin', sessionVersion: 1 }
    }
    await consumeDummyDashboardPasswordCheck(password)
    return null
  }

  const editor = await findDashboardBlogEditorByEmail(normalizedEmail)
  if (!editor) {
    await consumeDummyDashboardPasswordCheck(password)
    return null
  }

  if (!(await verifyDashboardEditorPassword(password, editor.password_hash))) {
    return null
  }

  // Login remains valid even if this non-security metadata write fails.
  await recordDashboardBlogEditorLogin(editor.id).catch((error) => {
    console.error('Failed to record dashboard editor login:', error)
  })

  return {
    id: editor.id,
    name: editor.email,
    role: 'blog_editor',
    sessionVersion: editor.session_version,
  }
}

function getSessionSecret(): string | null {
  const secret = process.env.DASHBOARD_SESSION_SECRET
  return secret && secret.length >= MINIMUM_SESSION_SECRET_LENGTH ? secret : null
}

function encodePayload(payload: DashboardSession): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function signPayload(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest()
}

function isDashboardRole(value: unknown): value is DashboardRole {
  return value === 'admin' || value === 'blog_editor'
}

function parseSessionPayload(value: unknown): DashboardSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const payload = value as Record<string, unknown>
  if (
    typeof payload.sub !== 'string'
    || !payload.sub
    || typeof payload.name !== 'string'
    || !payload.name
    || !isDashboardRole(payload.role)
    || typeof payload.ver !== 'number'
    || !Number.isSafeInteger(payload.ver)
    || payload.ver < 1
    || typeof payload.exp !== 'number'
    || !Number.isSafeInteger(payload.exp)
    || payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null
  }

  return {
    sub: payload.sub,
    name: payload.name,
    role: payload.role,
    ver: payload.ver,
    exp: payload.exp,
  }
}

export function createDashboardSessionToken(user: DashboardUser): {
  token: string
  session: DashboardSession
} {
  const secret = getSessionSecret()
  if (!secret) {
    throw new Error(
      `DASHBOARD_SESSION_SECRET must be at least ${MINIMUM_SESSION_SECRET_LENGTH} characters`
    )
  }

  const session: DashboardSession = {
    sub: user.id,
    name: user.name,
    role: user.role,
    ver: user.sessionVersion,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  }
  const encodedPayload = encodePayload(session)
  const signature = signPayload(encodedPayload, secret).toString('base64url')

  return { token: `${encodedPayload}.${signature}`, session }
}

export function verifyDashboardSessionToken(token: string): DashboardSession | null {
  const secret = getSessionSecret()
  if (!secret || !token || token.length > 4096) return null

  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null

  try {
    const suppliedSignature = Buffer.from(parts[1], 'base64url')
    const expectedSignature = signPayload(parts[0], secret)

    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null
    }

    const decodedPayload = Buffer.from(parts[0], 'base64url').toString('utf8')
    return parseSessionPayload(JSON.parse(decodedPayload) as unknown)
  } catch {
    return null
  }
}

export async function getDashboardSession(): Promise<DashboardSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value
  const session = token ? verifyDashboardSessionToken(token) : null
  if (!session) return null

  if (session.role === 'admin') {
    return session.sub === 'admin' && session.ver === 1 && Boolean(process.env.ADMIN_PASSWORD)
      ? session
      : null
  }

  try {
    const editor = await findDashboardBlogEditorSessionById(session.sub)
    return editor && editor.session_version === session.ver ? session : null
  } catch (error) {
    console.error('Dashboard editor session lookup failed:', error)
    return null
  }
}

/**
 * Role-aware guard for dashboard API routes. Invalid or missing sessions are
 * 401; valid sessions lacking the required role are 403.
 */
export async function requireDashboardRole(
  allowedRoles: readonly DashboardRole[]
): Promise<DashboardAuthorization> {
  const session = await getDashboardSession()

  if (!session) {
    return { authorized: false, status: 401, error: 'Unauthorized' }
  }

  if (!allowedRoles.includes(session.role)) {
    return { authorized: false, status: 403, error: 'Forbidden' }
  }

  return { authorized: true, session }
}

// Existing non-blog admin routes use this guard. Keep it admin-only so adding
// blog editors cannot grant access to products, orders, inventory, or uploads.
export async function verifyAdminSession(): Promise<boolean> {
  const authorization = await requireDashboardRole(['admin'])
  return authorization.authorized
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE,
    path: '/',
  }
}

export { ADMIN_COOKIE_NAME, SESSION_MAX_AGE }
