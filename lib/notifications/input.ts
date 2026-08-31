export const EMAIL_NOTIFICATION_TEMPLATES = [
  'order_confirmation',
  'admin_new_order',
] as const

export const WHATSAPP_NOTIFICATION_TEMPLATES = [
  'order_confirmation',
  'shipping_update',
  'delivered',
] as const

export type EmailNotificationTemplate = typeof EMAIL_NOTIFICATION_TEMPLATES[number]
export type WhatsAppNotificationTemplate = typeof WHATSAPP_NOTIFICATION_TEMPLATES[number]
export type NotificationTemplate = EmailNotificationTemplate | WhatsAppNotificationTemplate
export type NotificationChannel = 'email' | 'whatsapp'

export interface NotificationPayload {
  tracking_link?: string
}
export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 8
    && value.length <= 200
    && /^[A-Za-z0-9:._-]+$/.test(value)
}

export function isTemplateForChannel(
  channel: NotificationChannel,
  template: unknown
): template is NotificationTemplate {
  if (typeof template !== 'string') return false
  return channel === 'email'
    ? (EMAIL_NOTIFICATION_TEMPLATES as readonly string[]).includes(template)
    : (WHATSAPP_NOTIFICATION_TEMPLATES as readonly string[]).includes(template)
}

export function sanitizeNotificationPayload(value: unknown): NotificationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const payload = value as Record<string, unknown>
  return typeof payload.tracking_link === 'string'
    ? { tracking_link: payload.tracking_link.slice(0, 2048) }
    : {}
}

export function safeTrackingUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}
