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
  return { baseUrl: baseUrl.replace(/\/+$/, ''), username, password, merchantId }
}

export function getProshipMerchantId(): string {
  return getConfig().merchantId
}

export class ProshipError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ProshipError'
    this.status = status
    this.body = body
  }
}

// ── Token cache ───────────────────────────────────────────────────────────────

let cachedToken: { accessToken: string; expiresAt: number } | null = null

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
  const res = await fetch(`${cfg.baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new ProshipError(`Proship signin failed (${res.status})`, res.status, text.slice(0, 300))
  }
  const data = JSON.parse(text) as { accessToken?: string }
  if (!data.accessToken) {
    throw new ProshipError('Proship signin returned no accessToken', res.status, data)
  }
  // Refresh 60s before the JWT expires; fall back to ~55min if the claim is absent.
  const exp = jwtExpiryMs(data.accessToken) ?? Date.now() + 55 * 60_000
  return { accessToken: data.accessToken, expiresAt: exp - 60_000 }
}

async function getToken(cfg: ProshipConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken
  }
  cachedToken = await signIn(cfg)
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

  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(headers || {}),
    },
  })

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
    throw new ProshipError(`Proship ${path} failed (${res.status}): ${message}`, res.status, body)
  }

  return body as T
}
