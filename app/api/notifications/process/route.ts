import { NextResponse } from 'next/server'
import {
  hasNotificationWorkerSecret,
  verifyNotificationWorkerRequest,
} from '@/lib/notifications/internal-auth'
import { processNotificationQueues } from '@/lib/notifications/queue'

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
}
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS })
}

/**
 * Bounded notification worker entry point. Configure the deployment scheduler
 * to POST here every minute using `Authorization: Bearer $NOTIFICATION_WORKER_SECRET`.
 */
export async function POST(request: Request) {
  if (!hasNotificationWorkerSecret()) {
    return json({ error: 'Notification worker is not configured' }, 503)
  }
  if (!verifyNotificationWorkerRequest(request)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  try {
    const rawLimit = new URL(request.url).searchParams.get('limit')
    const limit = rawLimit ? Number(rawLimit) : 10
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      return json({ error: 'limit must be an integer from 1 to 25' }, 400)
    }

    const summary = await processNotificationQueues(limit)
    return json({ success: true, ...summary })
  } catch (error) {
    console.error(
      'Notification worker failed:',
      error instanceof Error ? error.message : 'unknown error'
    )
    return json({ error: 'Notification worker failed' }, 500)
  }
}
