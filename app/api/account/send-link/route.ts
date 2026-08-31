import { createHmac } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createMagicToken } from '@/lib/customer-auth'
import { escapeHtml } from '@/lib/notifications/html'
import { getClientIp } from '@/lib/orders/checkout-validation'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { validateEmail } from '@/lib/utils/validators'

const MAX_REQUEST_BYTES = 2 * 1024
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60
const EMAIL_RATE_LIMIT = 3
const IP_RATE_LIMIT = 10
const GENERIC_SUCCESS_MESSAGE =
  'If that address can receive NutriPanda emails, a sign-in link will arrive shortly.'

function jsonResponse(
  body: Record<string, unknown>,
  init?: ResponseInit
): NextResponse {
  const response = NextResponse.json(body, init)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

function acceptedResponse(): NextResponse {
  return jsonResponse({ ok: true, message: GENERIC_SUCCESS_MESSAGE })
}

function createCustomerRateLimitScope(kind: 'email' | 'ip', value: string): string {
  const secret = process.env.RATE_LIMIT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('RATE_LIMIT_SECRET must be at least 32 characters')
  }

  const digest = createHmac('sha256', secret)
    .update(`customer-magic-${kind}:${value}`, 'utf8')
    .digest('hex')
  return `customer_magic_${kind}:${digest}`
}

async function consumeMagicLinkRateLimit(scopeKey: string, limit: number): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc('consume_rate_limit', {
    p_scope_key: scopeKey,
    p_action: 'customer_magic_link',
    p_limit: limit,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  })
  if (error) throw error
  return data === true
}

async function readEmail(request: Request): Promise<string | null> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
    return null
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return null

  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) return null

  try {
    const body = JSON.parse(raw) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const email = (body as Record<string, unknown>).email
    if (typeof email !== 'string') return null

    const normalized = email.trim().toLowerCase()
    return normalized.length <= 254 && validateEmail(normalized) ? normalized : null
  } catch {
    return null
  }
}

function getSiteOrigin(request: Request): string {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!configuredUrl && process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL is required for customer magic links')
  }

  const url = new URL(configuredUrl ?? request.url)
  const isLocalDevelopment =
    process.env.NODE_ENV !== 'production'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')

  if (url.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('Customer magic-link origin must use HTTPS')
  }

  return url.origin
}

export async function POST(request: Request) {
  try {
    const normalized = await readEmail(request)
    if (!normalized) {
      return jsonResponse(
        { error: 'Unable to process this sign-in request.' },
        { status: 400 }
      )
    }

    const [emailAllowed, ipAllowed] = await Promise.all([
      consumeMagicLinkRateLimit(
        createCustomerRateLimitScope('email', normalized),
        EMAIL_RATE_LIMIT
      ),
      consumeMagicLinkRateLimit(
        createCustomerRateLimitScope('ip', getClientIp(request)),
        IP_RATE_LIMIT
      ),
    ])

    // Keep the response identical so this endpoint cannot be used as an
    // account-existence or throttling oracle.
    if (!emailAllowed || !ipAllowed) return acceptedResponse()

    const resendApiKey = process.env.RESEND_API_KEY
    if (!resendApiKey) {
      console.error('Customer magic-link email is unavailable: RESEND_API_KEY is not configured')
      return jsonResponse(
        { error: 'Sign-in email is temporarily unavailable. Please try again later.' },
        { status: 503 }
      )
    }

    const siteOrigin = getSiteOrigin(request)
    const token = await createMagicToken(normalized)
    const link = `${siteOrigin}/account/verify?token=${encodeURIComponent(token)}`
    const { Resend } = await import('resend')
    const resend = new Resend(resendApiKey)
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'NutriPanda <orders@nutripanda.com>'

    const { error } = await resend.emails.send({
      from: fromEmail,
      to: normalized,
      subject: 'Your NutriPanda sign-in link',
      html: magicLinkEmail(link),
      text: `Use this link to view your NutriPanda orders. It expires in 15 minutes:\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
    })

    if (error) {
      // Do not log the provider payload: it may contain recipient information.
      console.error('Customer magic-link email delivery failed')
      return jsonResponse(
        { error: 'Sign-in email is temporarily unavailable. Please try again later.' },
        { status: 503 }
      )
    }

    return acceptedResponse()
  } catch {
    // Never log the request body, email address, token, or generated link.
    console.error('Customer magic-link request failed')
    return jsonResponse(
      { error: 'Sign-in email is temporarily unavailable. Please try again later.' },
      { status: 503 }
    )
  }
}

function magicLinkEmail(link: string): string {
  const safeLink = escapeHtml(link)
  return `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;">
    <div style="background:#12BC00;padding:22px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">NutriPanda</h1>
    </div>
    <div style="padding:32px 24px;text-align:center;">
      <h2 style="color:#333;margin:0 0 8px;">Sign in to your orders</h2>
      <p style="color:#666;margin:0 0 24px;">Tap the button below to view your past orders. This link expires in 15 minutes.</p>
      <a href="${safeLink}" style="display:inline-block;background:#12BC00;color:#fff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:999px;">View my orders</a>
      <p style="color:#999;margin:24px 0 0;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div>
</body></html>`
}
