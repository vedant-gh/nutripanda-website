import { NextResponse } from 'next/server'
import {
  hasNotificationWorkerSecret,
  verifyNotificationWorkerRequest,
} from '@/lib/notifications/internal-auth'
import {
  isIdempotencyKey,
  isTemplateForChannel,
  isUuid,
} from '@/lib/notifications/input'
import { enqueueOrderNotification } from '@/lib/notifications/queue'

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
}
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS })
}

/** Internal-only durable email enqueue endpoint. This route never sends inline. */
export async function POST(request: Request) {
  try {
    if (!hasNotificationWorkerSecret()) {
      return json({ error: 'Notification worker is not configured' }, 503)
    }
    if (!verifyNotificationWorkerRequest(request)) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const contentLength = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > 4096) {
      return json({ error: 'Request body is too large' }, 413)
    }

    const idempotencyKey = request.headers.get('idempotency-key')
    if (!isIdempotencyKey(idempotencyKey)) {
      return json({ error: 'A valid Idempotency-Key header is required' }, 400)
    }

    const body = await request.json() as Record<string, unknown>
    const orderId = body.order_id
    const template = body.template
    if (!isUuid(orderId) || !isTemplateForChannel('email', template)) {
      return json({ error: 'Invalid order_id or email template' }, 400)
    }

    const result = await enqueueOrderNotification({
      orderId,
      channel: 'email',
      template,
      idempotencyKey,
    })

    return json(result, result.status === 'duplicate' ? 200 : 202)
  } catch (error) {
    console.error(
      'Email enqueue failed:',
      error instanceof Error ? error.message : 'unknown error'
    )
    return json({ error: 'Failed to queue email notification' }, 500)
  }
}
