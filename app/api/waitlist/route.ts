import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { consumeRateLimit } from '@/lib/supabase/queries'
import { createRateLimitScope, getClientIp } from '@/lib/orders/checkout-validation'
import { hasOnlyKeys, readBoundedJsonObject } from '@/lib/utils/request-input'
import { validateEmail, validatePhone } from '@/lib/utils/validators'

const MAX_WAITLIST_BODY_BYTES = 4 * 1024

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request: Request) {
  try {
    const parsed = await readBoundedJsonObject(request, { maxBytes: MAX_WAITLIST_BODY_BYTES })
    if (!parsed.ok) {
      return noStore(NextResponse.json({ error: parsed.error }, { status: parsed.status }))
    }
    if (!hasOnlyKeys(parsed.value, ['email', 'phone'])) {
      return noStore(NextResponse.json({ error: 'Invalid request fields' }, { status: 400 }))
    }

    const rawEmail = parsed.value.email
    const rawPhone = parsed.value.phone
    if (rawEmail !== undefined && typeof rawEmail !== 'string') {
      return noStore(NextResponse.json({ error: 'Email must be a string' }, { status: 400 }))
    }
    if (rawPhone !== undefined && typeof rawPhone !== 'string') {
      return noStore(NextResponse.json({ error: 'Phone must be a string' }, { status: 400 }))
    }

    const email = rawEmail?.trim().toLowerCase() || null
    const phone = rawPhone?.trim() || null

    if (!email && !phone) {
      return noStore(NextResponse.json(
        { error: 'Please provide an email or phone number' },
        { status: 400 }
      ))
    }

    if (email && (email.length > 254 || !validateEmail(email))) {
      return noStore(NextResponse.json(
        { error: 'Please enter a valid email address' },
        { status: 400 }
      ))
    }

    if (phone && (phone.length > 10 || !validatePhone(phone))) {
      return noStore(NextResponse.json(
        { error: 'Please enter a valid 10-digit Indian phone number' },
        { status: 400 }
      ))
    }

    const identity = email ? `email:${email}` : `phone:${phone}`
    const [identityAllowed, ipAllowed] = await Promise.all([
      consumeRateLimit({
        scope_key: createRateLimitScope('waitlist_identity', identity),
        action: 'waitlist_signup',
        limit: 3,
        window_seconds: 24 * 60 * 60,
      }),
      consumeRateLimit({
        scope_key: createRateLimitScope('waitlist_ip', getClientIp(request)),
        action: 'waitlist_signup',
        limit: 10,
        window_seconds: 60 * 60,
      }),
    ])
    if (!identityAllowed || !ipAllowed) {
      const response = NextResponse.json(
        { error: 'Too many signup attempts. Please try again later.' },
        { status: 429 }
      )
      response.headers.set('Retry-After', '3600')
      return noStore(response)
    }

    const { error } = await getSupabaseAdmin()
      .from('waitlist_signups')
      .insert({ email, phone })

    if (error) {
      if (error.code === '23505') {
        return noStore(NextResponse.json(
          { message: "You're already on the list! We'll notify you when we launch." },
          { status: 200 }
        ))
      }
      throw error
    }

    return noStore(NextResponse.json(
      { message: "You're in! We'll notify you when we launch." },
      { status: 201 }
    ))
  } catch {
    return noStore(NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    ))
  }
}
