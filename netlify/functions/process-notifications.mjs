// Netlify runs this once per minute on published production deploys. The
// scheduled function has no public URL; it invokes the authenticated Next.js
// worker so queue logic stays in one place.
export default async function processNotifications() {
  const siteUrl = process.env.URL
  const secret = process.env.NOTIFICATION_WORKER_SECRET
  if (!siteUrl || !secret) {
    throw new Error('URL and NOTIFICATION_WORKER_SECRET are required')
  }

  const response = await fetch(new URL('/api/notifications/process?limit=3', siteUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(25_000),
  })

  if (!response.ok) {
    throw new Error(`Notification worker returned HTTP ${response.status}`)
  }
}
export const config = {
  schedule: '* * * * *',
}
