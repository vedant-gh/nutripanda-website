const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type JsonObject = Record<string, unknown>

export type RequestInputResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 413 | 415; error: string }

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function hasOnlyKeys(value: JsonObject, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(value).every((key) => allowed.has(key))
}

/**
 * Read a JSON object without trusting Content-Length. The declared and actual
 * byte counts are both enforced because chunked requests may omit the header.
 */
export async function readBoundedJsonObject(
  request: Request,
  options: { maxBytes: number; allowEmpty?: boolean }
): Promise<RequestInputResult<JsonObject>> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      return { ok: false, status: 400, error: 'Invalid Content-Length header' }
    }
    const bytes = Number(declaredLength)
    if (!Number.isSafeInteger(bytes)) {
      return { ok: false, status: 400, error: 'Invalid Content-Length header' }
    }
    if (bytes > options.maxBytes) {
      return { ok: false, status: 413, error: 'Request body is too large' }
    }
  }

  const contentType = request.headers.get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > options.maxBytes) {
    return { ok: false, status: 413, error: 'Request body is too large' }
  }

  if (!rawBody.trim()) {
    return options.allowEmpty
      ? { ok: true, value: {} }
      : { ok: false, status: 400, error: 'A JSON request body is required' }
  }

  if (contentType !== 'application/json') {
    return { ok: false, status: 415, error: 'Content-Type must be application/json' }
  }

  try {
    const value = JSON.parse(rawBody) as unknown
    return isJsonObject(value)
      ? { ok: true, value }
      : { ok: false, status: 400, error: 'JSON body must be an object' }
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON request body' }
  }
}
