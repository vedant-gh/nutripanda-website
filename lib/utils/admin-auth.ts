import 'server-only'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

const ADMIN_COOKIE_NAME = 'nutripanda_admin_session'
const SESSION_MAX_AGE = 60 * 60 * 24 // 24 hours
const MINIMUM_SESSION_SECRET_LENGTH = 32

export type DashboardRole = 'admin' | 'blog_editor'

export interface DashboardUser {
  id: string
  name: string
  role: DashboardRole
}

export interface DashboardSession {
  sub: string
  name: string
  role: DashboardRole
  exp: number
}

export type DashboardAuthorization =
  | { authorized: true; session: DashboardSession }
  | { authorized: false; status: 401 | 403; error: 'Unauthorized' | 'Forbidden' }

interface DashboardCredential extends DashboardUser {
  email?: string
  password: string
}

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

function getDashboardCredentials(): DashboardCredential[] {
  const credentials: DashboardCredential[] = []
  const adminPassword = process.env.ADMIN_PASSWORD

  if (adminPassword) {
    credentials.push({
      id: 'admin',
      name: 'Administrator',
      role: 'admin',
      email: process.env.ADMIN_EMAIL
        ? normalizeEmail(process.env.ADMIN_EMAIL)
        : undefined,
      password: adminPassword,
    })
  }

  for (const editorNumber of [1, 2] as const) {
    const email = process.env[`BLOG_EDITOR_${editorNumber}_EMAIL`]
    const password = process.env[`BLOG_EDITOR_${editorNumber}_PASSWORD`]

    // An editor account is enabled only when both parts are configured.
    if (email && password) {
      credentials.push({
        id: `blog-editor-${editorNumber}`,
        name: `Blog Editor ${editorNumber}`,
        role: 'blog_editor',
        email: normalizeEmail(email),
        password,
      })
    }
  }

  return credentials
}

export function hasDashboardCredentials(): boolean {
  return getDashboardCredentials().length > 0
}

export function hasDashboardSessionSecret(): boolean {
  return (process.env.DASHBOARD_SESSION_SECRET?.length ?? 0) >= MINIMUM_SESSION_SECRET_LENGTH
}

/**
 * Match configured dashboard credentials without using ordinary string
 * equality for either the email or password.
 *
 * Password-only login is retained for the original admin login form. It is
 * deliberately never available to editors, and is disabled if an editor was
 * accidentally configured with the same password as the admin.
 */
export function authenticateDashboardCredentials(
  email: string | undefined,
  password: string
): DashboardUser | null {
  const credentials = getDashboardCredentials()
  const normalizedEmail = email ? normalizeEmail(email) : ''

  if (!normalizedEmail) {
    const admin = credentials.find((credential) => credential.role === 'admin')
    if (!admin) return null

    const passwordIsSharedWithEditor = credentials
      .filter((credential) => credential.role === 'blog_editor')
      .some((credential) => safeEqual(password, credential.password))

    if (passwordIsSharedWithEditor || !safeEqual(password, admin.password)) {
      return null
    }

    return { id: admin.id, name: admin.name, role: admin.role }
  }

  const matches = credentials.filter((credential) => {
    // A legacy admin without ADMIN_EMAIL is password-only. Never let arbitrary
    // supplied emails become aliases for that privileged credential.
    const emailMatches = Boolean(credential.email)
      && safeEqual(normalizedEmail, credential.email ?? '')
    const passwordMatches = safeEqual(password, credential.password)

    return emailMatches && passwordMatches
  })

  // Refuse ambiguous configuration instead of selecting a more privileged
  // account when two accounts have identical credentials.
  if (matches.length !== 1) return null

  const match = matches[0]
  return { id: match.id, name: match.name, role: match.role }
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

  // Re-check that the account still exists in configuration. Removing either
  // editor variable therefore revokes that editor on the next deployment,
  // even if they still hold an otherwise valid 24-hour cookie.
  const accountIsStillConfigured = getDashboardCredentials().some(
    (credential) => credential.id === session.sub && credential.role === session.role
  )

  return accountIsStillConfigured ? session : null
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
