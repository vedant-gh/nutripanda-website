import { NextResponse } from 'next/server'
import { createMagicToken } from '@/lib/customer-auth'
import { validateEmail } from '@/lib/utils/validators'

export async function POST(request: Request) {
  try {
    const { email } = (await request.json()) as { email?: string }
    if (!email || !validateEmail(email.trim())) {
      return NextResponse.json({ error: 'Please enter a valid email' }, { status: 400 })
    }

    const normalized = email.trim().toLowerCase()
    const token = createMagicToken(normalized)
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.headers.get('origin') ?? ''
    const link = `${baseUrl}/account/verify?token=${encodeURIComponent(token)}`

    const resendApiKey = process.env.RESEND_API_KEY
    if (!resendApiKey) {
      // No Resend configured yet — log the link so the flow can be tested in dev.
      // (We always respond ok so the existence of an email is never revealed.)
      console.log(`\n🔑 NutriPanda sign-in link for ${normalized}:\n${link}\n`)
      return NextResponse.json({ ok: true, dev: true })
    }

    const { Resend } = await import('resend')
    const resend = new Resend(resendApiKey)
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'NutriPanda <orders@nutripanda.com>'

    const { error } = await resend.emails.send({
      from: fromEmail,
      to: normalized,
      subject: 'Your NutriPanda sign-in link',
      html: magicLinkEmail(link),
    })

    if (error) {
      console.error('Resend error (magic link):', error)
      return NextResponse.json({ error: 'Could not send the email. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('send-link error:', err)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

function magicLinkEmail(link: string): string {
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
      <a href="${link}" style="display:inline-block;background:#12BC00;color:#fff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:999px;">View my orders</a>
      <p style="color:#999;margin:24px 0 0;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div>
</body></html>`
}
