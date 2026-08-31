import crypto from 'crypto'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const MAX_TOKEN_LENGTH = 2048

interface TurnstileResult {
  success?: boolean
  action?: string
  hostname?: string
  ['error-codes']?: unknown
}

export class TurnstileError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'TurnstileError'
    this.status = status
  }
}

export function checkoutTurnstileToken(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TurnstileError('Complete the checkout security check')
  }
  const token = (value as Record<string, unknown>).turnstileToken
  if (typeof token !== 'string' || !token.trim() || token.length > MAX_TOKEN_LENGTH) {
    throw new TurnstileError('Complete the checkout security check')
  }
  return token.trim()
}

export async function verifyCheckoutTurnstile(input: {
  token: string
  remoteIp?: string
}): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    throw new TurnstileError('Checkout security is not configured', 503)
  }

  const body = new URLSearchParams({
    secret,
    response: input.token,
    idempotency_key: crypto.randomUUID(),
  })
  if (input.remoteIp && input.remoteIp !== 'unknown') body.set('remoteip', input.remoteIp)

  let response: Response
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    })
  } catch {
    throw new TurnstileError('Checkout security could not be verified. Please try again.', 503)
  }
  if (!response.ok) {
    throw new TurnstileError('Checkout security could not be verified. Please try again.', 503)
  }

  const raw = await response.text()
  if (raw.length > 16_384) {
    throw new TurnstileError('Checkout security returned an invalid response', 503)
  }
  let result: TurnstileResult
  try {
    result = JSON.parse(raw) as TurnstileResult
  } catch {
    throw new TurnstileError('Checkout security returned an invalid response', 503)
  }

  const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim().toLowerCase()
  if (
    result.success !== true
    || result.action !== 'checkout'
    || (expectedHostname && result.hostname?.toLowerCase() !== expectedHostname)
  ) {
    throw new TurnstileError('Checkout security check expired or failed. Please try again.')
  }
}
