// Low-level Proship (Prozo) API client: config, auth-token caching, and an
// authenticated fetch wrapper. All server-side only — never import from client
// components (credentials live in non-public env vars).
//
// Auth model (validated against the live API):
//   POST /api/auth/signin { username, password } -> { accessToken (JWT, ~1h), refreshToken, ... }
//   Downstream calls send:  Authorization: Bearer <accessToken>
//
// The token is cached in-process and reused until shortly before its JWT `exp`.
// On a serverless/edge instance this cache is best-effort per instance; a cache
// miss simply triggers a fresh sign-in.

interface ProshipConfig {
  baseUrl: string
  username: string
  password: string
  merchantId: string
}

const DEFAULT_TIMEOUT_MS = 12_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 30_000

function requestTimeoutMs(): number {
  const configured = Number(process.env.PROSHIP_REQUEST_TIMEOUT_MS)
  if (!Number.isFinite(configured)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(configured)))
}

function requestSignal(signal?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMs())
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function redactProviderText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined

  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/g, '[redacted-phone]')
    .replace(/(?:token|secret|password|authorization)\s*[:=]\s*[^\s,;}]+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 180)
}

function getConfig(): ProshipConfig {
  const baseUrl = process.env.PROSHIP_BASE_URL
  const username = process.env.PROSHIP_USERNAME
  const password = process.env.PROSHIP_PASSWORD
  const merchantId = process.env.PROSHIP_MERCHANT_ID
  if (!baseUrl || !username || !password || !merchantId) {
    throw new Error(
      'Missing Proship config — set PROSHIP_BASE_URL, PROSHIP_USERNAME, PROSHIP_PASSWORD, PROSHIP_MERCHANT_ID'
    )
  }
  let parsedUrl: URL
  try {
    parsedUrl = new URL(baseUrl)
  } catch {
    throw new Error('PROSHIP_BASE_URL must be a valid URL')
  }
  const localHttp = parsedUrl.protocol === 'http:'
    && (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1')
  if (parsedUrl.protocol !== 'https:' && !localHttp) {
    throw new Error('PROSHIP_BASE_URL must use HTTPS')
  }
  return { baseUrl: parsedUrl.toString().replace(/\/+$/, ''), username, password, merchantId }
}

export function getProshipMerchantId(): string {
  return getConfig().merchantId
}

export class ProshipError extends Error {
  status: number
  operation: string
  retryable: boolean
  /** A create request may have reached Proship even though its response was lost. */
  outcomeUnknown: boolean
  providerMessage?: string

  constructor(input: {
    message: string
    status: number
    operation: string
    retryable?: boolean
    outcomeUnknown?: boolean
    providerMessage?: unknown
  }) {
    const { message, status, operation, retryable, outcomeUnknown, providerMessage } = input
    super(message)
    this.name = 'ProshipError'
    this.status = status
    this.operation = operation
    this.retryable = retryable ?? false
    this.outcomeUnknown = outcomeUnknown ?? false
    this.providerMessage = redactProviderText(providerMessage)
  }

  toSafeLog(): Record<string, unknown> {
    return {
      name: this.name,
      operation: this.operation,
      status: this.status,
      retryable: this.retryable,
      outcomeUnknown: this.outcomeUnknown,
      providerMessage: this.providerMessage,
    }
  }
}

// ── Token cache ───────────────────────────────────────────────────────────────

let cachedToken: { accessToken: string; expiresAt: number } | null = null
let tokenRequest: Promise<{ accessToken: string; expiresAt: number }> | null = null

/** Read the `exp` claim (ms epoch) out of a JWT without verifying the signature. */
function jwtExpiryMs(jwt: string): number | null {
  try {
    const payload = jwt.split('.')[1]
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof json.exp === 'number' ? json.exp * 1000 : null
  } catch {
    return null
  }
}

async function signIn(cfg: ProshipConfig): Promise<{ accessToken: string; expiresAt: number }> {
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
      signal: requestSignal(),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    throw new ProshipError({
      message: timedOut ? 'Shipping provider authentication timed out' : 'Shipping provider is unavailable',
      status: timedOut ? 504 : 502,
      operation: 'signin',
      retryable: true,
    })
  }
  const text = await res.text()
  if (!res.ok) {
    throw new ProshipError({
      message: 'Shipping provider authentication failed',
      status: res.status,
      operation: 'signin',
      retryable: res.status >= 500 || res.status === 429,
      providerMessage: text,
    })
  }
  let data: { accessToken?: string }
  try {
    data = JSON.parse(text) as { accessToken?: string }
  } catch {
    throw new ProshipError({
      message: 'Shipping provider returned an invalid authentication response',
      status: 502,
      operation: 'signin',
      retryable: true,
    })
  }
  if (!data.accessToken) {
    throw new ProshipError({
      message: 'Shipping provider returned an invalid authentication response',
      status: 502,
      operation: 'signin',
      retryable: true,
    })
  }
  // Refresh 60s before the JWT expires; fall back to ~55min if the claim is absent.
  const exp = jwtExpiryMs(data.accessToken) ?? Date.now() + 55 * 60_000
  return { accessToken: data.accessToken, expiresAt: exp - 60_000 }
}

async function getToken(cfg: ProshipConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken
  }
  tokenRequest ??= signIn(cfg).finally(() => {
    tokenRequest = null
  })
  cachedToken = await tokenRequest
  return cachedToken.accessToken
}

// ── Authenticated request ──────────────────────────────────────────────────────

/**
 * Make an authenticated request to the Proship API and return the parsed JSON
 * body. Retries once on a 401 with a freshly minted token. Throws ProshipError
 * on any non-2xx response.
 */
export async function proshipFetch<T = unknown>(
  path: string,
  init: RequestInit & { retryOnAuth?: boolean } = {}
): Promise<T> {
  const cfg = getConfig()
  const token = await getToken(cfg)
  const { retryOnAuth, headers, ...rest } = init

  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      ...rest,
      signal: requestSignal(rest.signal),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(headers || {}),
      },
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    throw new ProshipError({
      message: timedOut ? 'Shipping provider request timed out' : 'Shipping provider is unavailable',
      status: timedOut ? 504 : 502,
      operation: `${rest.method ?? 'GET'} ${path.split('?')[0]}`,
      retryable: true,
      // For a POST, a network failure can happen after Proship accepted the booking.
      outcomeUnknown: (rest.method ?? 'GET').toUpperCase() === 'POST',
    })
  }

  // Token expired / revoked mid-flight — drop the cache and retry once.
  if (res.status === 401 && retryOnAuth !== false && cachedToken) {
    cachedToken = null
    return proshipFetch<T>(path, { ...init, retryOnAuth: false })
  }

  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message?: unknown }).message)
        : text.slice(0, 300)
    throw new ProshipError({
      message: 'Shipping provider rejected the request',
      status: res.status,
      operation: `${rest.method ?? 'GET'} ${path.split('?')[0]}`,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
      // A 5xx response to a create/cancel request does not prove it was not applied.
      outcomeUnknown:
        (rest.method ?? 'GET').toUpperCase() === 'POST'
        && (res.status >= 500 || res.status === 408 || res.status === 429),
      providerMessage: message,
    })
  }

  return body as T
}
