import { createHmac, randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { validatePhone } from '@/lib/utils/validators'
import { COUPON_DISCOUNT_PERCENT } from '@/lib/utils/constants'
import { hasOnlyKeys, readBoundedJsonObject } from '@/lib/utils/request-input'
import type { Twilio } from 'twilio'

const MAX_BODY_BYTES = 4096
const MINIMUM_RATE_SECRET_LENGTH = 32
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
}

let twilioClient: Twilio | null = null

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...RESPONSE_HEADERS, ...extraHeaders },
  })
}

function getTwilioClient(): Twilio {
  if (twilioClient) return twilioClient
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) throw new Error('Twilio credentials are not configured')

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const twilio = require('twilio')
  twilioClient = twilio(accountSid, authToken) as Twilio
  return twilioClient
}

function generateCouponCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let index = 0; index < 8; index += 1) {
    suffix += alphabet[randomInt(alphabet.length)]
  }
  return `PANDA10-${suffix}`
}

function clientIp(request: Request): string | null {
  const netlifyIp = request.headers.get('x-nf-client-connection-ip')?.trim()
  if (netlifyIp) return netlifyIp.slice(0, 128)
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded ? forwarded.slice(0, 128) : null
}

function hmacRateKey(kind: 'phone' | 'ip', value: string, secret: string): string {
  return createHmac('sha256', secret).update(`${kind}:${value}`, 'utf8').digest('hex')
}

function sameOriginRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== 'production') return true

  const configuredSite = process.env.NEXT_PUBLIC_SITE_URL
  if (!configuredSite) return false
  try {
    const siteUrl = new URL(configuredSite)
    if (siteUrl.protocol !== 'https:') return false
    const expectedOrigin = siteUrl.origin
    const origin = request.headers.get('origin')
    const fetchSite = request.headers.get('sec-fetch-site')
    return origin === expectedOrigin && (!fetchSite || fetchSite === 'same-origin')
  } catch {
    return false
  }
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret || !token || token.length > 2048) return false

  const body = new URLSearchParams({ secret, response: token, remoteip: ip })
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) return false
  const result = await response.json().catch(() => null) as {
    success?: boolean
    action?: string
    hostname?: string
  } | null

  let expectedHostname: string | null = null
  try {
    expectedHostname = process.env.NEXT_PUBLIC_SITE_URL
      ? new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname
      : null
  } catch {
    return false
  }

  return result?.success === true
    && (!result.action || result.action === 'coupon_send')
    && Boolean(expectedHostname && result.hostname === expectedHostname)
}

async function couponCodeForPhone(phone: string): Promise<string> {
  const supabase = getSupabaseAdmin()
  const { data: existing, error: existingError } = await supabase
    .from('coupon_leads')
    .select('coupon_code')
    .eq('phone', phone)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing?.coupon_code) return String(existing.coupon_code)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const couponCode = generateCouponCode()
    const { error: insertError } = await supabase.from('coupon_leads').insert({
      phone,
      coupon_code: couponCode,
      discount_percent: COUPON_DISCOUNT_PERCENT,
    })
    if (!insertError) return couponCode
    if (insertError.code !== '23505') throw insertError

    // A concurrent request may have inserted this phone. Prefer its code;
    // otherwise the random code collided and the loop generates another.
    const { data: concurrent, error: concurrentError } = await supabase
      .from('coupon_leads')
      .select('coupon_code')
      .eq('phone', phone)
      .maybeSingle()
    if (concurrentError) throw concurrentError
    if (concurrent?.coupon_code) return String(concurrent.coupon_code)
  }

  throw new Error('Could not allocate a unique coupon code')
}

/**
 * Public coupon WhatsApp request. Disabled unless explicitly enabled, and in
 * production requires same-origin submission, Turnstile, and durable DB rate
 * limits (2/day/phone, 5/hour/IP).
 */
export async function POST(request: Request) {
  try {
    if (process.env.COUPON_SEND_ENABLED !== 'true') {
      return json({ error: 'Coupon delivery is not available' }, 404)
    }
    if (!sameOriginRequest(request)) {
      return json({ error: 'Invalid request origin' }, 403)
    }

    const parsed = await readBoundedJsonObject(request, { maxBytes: MAX_BODY_BYTES })
    if (!parsed.ok) return json({ error: parsed.error }, parsed.status)
    const body = parsed.value
    if (!hasOnlyKeys(body, ['phone', 'challenge_token'])) {
      return json({ error: 'Request contains unsupported fields' }, 400)
    }
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const challengeToken = typeof body.challenge_token === 'string'
      ? body.challenge_token
      : ''
    if (!validatePhone(phone)) {
      return json({ error: 'Please enter a valid 10-digit Indian phone number' }, 400)
    }

    const ip = clientIp(request)
    if (!ip) return json({ error: 'Could not validate request' }, 400)

    // A challenge is mandatory in production. Development can omit it only
    // while the endpoint is deliberately enabled for local testing.
    if (
      process.env.NODE_ENV === 'production'
      && !(await verifyTurnstile(challengeToken, ip))
    ) {
      return json({ error: 'Please complete the verification challenge' }, 400)
    }

    const rateSecret = process.env.COUPON_RATE_LIMIT_SECRET
    if (!rateSecret || rateSecret.length < MINIMUM_RATE_SECRET_LENGTH) {
      console.error('Coupon send is disabled: COUPON_RATE_LIMIT_SECRET is not configured')
      return json({ error: 'Coupon delivery is temporarily unavailable' }, 503)
    }

    const { data: rateRows, error: rateError } = await getSupabaseAdmin().rpc(
      'claim_coupon_send_request',
      {
        p_phone_key: hmacRateKey('phone', phone, rateSecret),
        p_ip_key: hmacRateKey('ip', ip, rateSecret),
      }
    )
    if (rateError) throw rateError

    const rate = Array.isArray(rateRows) ? rateRows[0] : rateRows
    if (!rate?.allowed) {
      const retryAfter = Math.max(1, Number(rate?.retry_after_seconds) || 3600)
      return json(
        { error: 'Too many coupon requests. Please try again later.' },
        429,
        { 'Retry-After': String(retryAfter) }
      )
    }

    const couponCode = await couponCodeForPhone(phone)
    const from = process.env.TWILIO_WHATSAPP_FROM ?? process.env.TWILIO_WHATSAPP_NUMBER
    if (!from) throw new Error('TWILIO_WHATSAPP_FROM is not configured')

    const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nutripanda.in')
    if (siteUrl.protocol !== 'https:' && siteUrl.hostname !== 'localhost') {
      throw new Error('NEXT_PUBLIC_SITE_URL must use HTTPS')
    }
    const normalizedFrom = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`
    await getTwilioClient().messages.create({
      from: normalizedFrom,
      to: `whatsapp:+91${phone}`,
      body: `Your NutriPanda first-order coupon is ${couponCode}. Use it at checkout on ${siteUrl.origin}.`,
    })

    const { error: updateError } = await getSupabaseAdmin().rpc(
      'mark_coupon_whatsapp_sent',
      { p_phone: phone }
    )
    if (updateError) throw updateError

    // Do not return the code or reveal whether this phone already had one.
    return json({ accepted: true }, 202)
  } catch (error) {
    console.error(
      'Coupon delivery failed:',
      error instanceof Error ? error.message : 'unknown error'
    )
    return json({ error: 'Coupon delivery is temporarily unavailable' }, 503)
  }
}
