import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'

const MINIMUM_INTERNAL_SECRET_LENGTH = 32

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest()
  const rightDigest = createHash('sha256').update(right, 'utf8').digest()
  return timingSafeEqual(leftDigest, rightDigest)
}
function configuredSecret(): string | null {
  const secret = process.env.NOTIFICATION_WORKER_SECRET
  return secret && secret.length >= MINIMUM_INTERNAL_SECRET_LENGTH ? secret : null
}

export function hasNotificationWorkerSecret(): boolean {
  return configuredSecret() !== null
}

/** Authenticate internal enqueue/worker calls. Never accepts a fallback secret. */
export function verifyNotificationWorkerRequest(request: Request): boolean {
  const secret = configuredSecret()
  if (!secret) return false

  const authorization = request.headers.get('authorization')
  if (!authorization || authorization.length > 4096) return false
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization)
  return Boolean(match?.[1] && safeEqual(match[1], secret))
}
