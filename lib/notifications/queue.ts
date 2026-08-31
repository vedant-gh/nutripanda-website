import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { formatPrice } from '@/lib/utils/format'
import { validateEmail } from '@/lib/utils/validators'
import {
  isIdempotencyKey,
  isTemplateForChannel,
  safeTrackingUrl,
  sanitizeNotificationPayload,
  type EmailNotificationTemplate,
  type NotificationChannel,
  type NotificationPayload,
  type NotificationTemplate,
  type WhatsAppNotificationTemplate,
} from './input'
import {
  renderAdminNewOrderEmail,
  renderOrderConfirmationEmail,
} from './email-templates'
import {
  sendGetGabsTemplate,
  toWhatsAppNumber,
  type TemplateComponent,
} from './getgabs'
import type { Order } from '@/types/supabase'

const MAX_BATCH_SIZE = 25
const MAX_DELIVERY_ATTEMPTS = 5

type DeliveryStatus = 'pending' | 'processing' | 'sent' | 'delivered' | 'failed' | 'skipped'

interface NotificationDeliveryRow {
  id: string
  order_id: string
  channel: NotificationChannel
  recipient: string
  template: NotificationTemplate
  status: DeliveryStatus
  idempotency_key: string
  payload: NotificationPayload | null
  attempts: number
}

interface PaymentOutboxRow {
  id: string
  order_id: string
  event_key: string
  event_type: string
  attempts: number
}

export interface EnqueueOrderNotificationInput {
  orderId: string
  channel: NotificationChannel
  template: NotificationTemplate
  idempotencyKey: string
  payload?: NotificationPayload
}

export type EnqueueOrderNotificationResult =
  | { status: 'queued'; deliveryId: string }
  | { status: 'duplicate'; deliveryId?: string }
  | { status: 'skipped'; deliveryId?: string; reason: 'not_opted_in' }

interface QueueProcessingSummary {
  paymentEventsClaimed: number
  paymentEventsCompleted: number
  paymentEventsFailed: number
  deliveriesClaimed: number
  deliveriesSent: number
  deliveriesSkipped: number
  deliveriesFailed: number
}

class PermanentNotificationError extends Error {}

function boundedBatchSize(limit: number): number {
  return Number.isSafeInteger(limit) ? Math.min(MAX_BATCH_SIZE, Math.max(1, limit)) : 10
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown notification error'
  return message.replace(/[\r\n\0-\x1f\x7f]+/gu, ' ').slice(0, 500)
}

function safeMessageText(value: unknown, maxLength = 200): string {
  return String(value ?? '')
    .replace(/[\r\n\0-\x1f\x7f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength)
}

function isConfirmableOrder(order: Order): boolean {
  if (order.order_status === 'cancelled') return false
  return order.payment_method === 'cod' || order.payment_status === 'paid'
}

async function fetchOrder(orderId: string): Promise<Order | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle()

  if (error) throw error
  return (data as Order | null) ?? null
}

function recipientFor(
  order: Order,
  channel: NotificationChannel,
  template: NotificationTemplate
): { recipient: string; skipped: boolean } {
  if (channel === 'email') {
    const recipient = template === 'admin_new_order'
      ? (process.env.ADMIN_NOTIFICATION_EMAIL ?? process.env.ADMIN_EMAIL ?? '').trim()
      : order.customer_email.trim().toLowerCase()

    if (!validateEmail(recipient)) {
      throw new Error(
        template === 'admin_new_order'
          ? 'ADMIN_NOTIFICATION_EMAIL or ADMIN_EMAIL is not configured'
          : 'Order has no valid customer email'
      )
    }
    return { recipient, skipped: false }
  }

  return {
    recipient: order.customer_phone,
    skipped: !order.customer_whatsapp_opted_in,
  }
}

/**
 * Persist one delivery request. The unique idempotency key makes retries safe;
 * this function never calls an external email or WhatsApp provider.
 */
export async function enqueueOrderNotification(
  input: EnqueueOrderNotificationInput
): Promise<EnqueueOrderNotificationResult> {
  if (!isIdempotencyKey(input.idempotencyKey)) {
    throw new Error('A valid notification idempotency key is required')
  }
  if (!isTemplateForChannel(input.channel, input.template)) {
    throw new Error('Notification template is not valid for this channel')
  }

  const order = await fetchOrder(input.orderId)
  if (!order) throw new PermanentNotificationError('Order not found')

  if (
    (input.template === 'order_confirmation' || input.template === 'admin_new_order')
    && !isConfirmableOrder(order)
  ) {
    throw new PermanentNotificationError('Order is not eligible for a confirmation notification')
  }
  if (input.template === 'shipping_update' && order.order_status !== 'shipped') {
    throw new PermanentNotificationError('Order is not shipped')
  }
  if (input.template === 'delivered' && order.order_status !== 'delivered') {
    throw new PermanentNotificationError('Order is not delivered')
  }

  const { recipient, skipped } = recipientFor(order, input.channel, input.template)
  const status: DeliveryStatus = skipped ? 'skipped' : 'pending'
  const payload = sanitizeNotificationPayload(input.payload)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('notifications_log')
    .insert({
      order_id: input.orderId,
      channel: input.channel,
      recipient,
      template: input.template,
      status,
      idempotency_key: input.idempotencyKey,
      payload,
      sent_at: null,
      available_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (!error && data?.id) {
    return skipped
      ? { status: 'skipped', deliveryId: String(data.id), reason: 'not_opted_in' }
      : { status: 'queued', deliveryId: String(data.id) }
  }

  if (error?.code !== '23505') throw error ?? new Error('Failed to queue notification')

  const { data: existing, error: existingError } = await supabase
    .from('notifications_log')
    .select('id,status')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
  if (existingError) throw existingError

  if (existing?.status === 'skipped') {
    return {
      status: 'skipped',
      deliveryId: existing.id ? String(existing.id) : undefined,
      reason: 'not_opted_in',
    }
  }
  return {
    status: 'duplicate',
    deliveryId: existing?.id ? String(existing.id) : undefined,
  }
}

async function enqueueConfirmedOrderNotifications(event: PaymentOutboxRow): Promise<void> {
  const baseKey = event.event_key
  const results = await Promise.allSettled([
    enqueueOrderNotification({
      orderId: event.order_id,
      channel: 'email',
      template: 'order_confirmation',
      idempotencyKey: `${baseKey}:email:order_confirmation`,
    }),
    enqueueOrderNotification({
      orderId: event.order_id,
      channel: 'email',
      template: 'admin_new_order',
      idempotencyKey: `${baseKey}:email:admin_new_order`,
    }),
    enqueueOrderNotification({
      orderId: event.order_id,
      channel: 'whatsapp',
      template: 'order_confirmation',
      idempotencyKey: `${baseKey}:whatsapp:order_confirmation`,
    }),
  ])
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  )
  if (failure) throw failure.reason
}

async function completePaymentEvent(eventId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc('complete_payment_outbox_event', {
    p_event_id: eventId,
  })
  if (error) throw error
}

async function failPaymentEvent(event: PaymentOutboxRow, error: unknown): Promise<void> {
  const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, event.attempts - 1)))
  const { error: updateError } = await getSupabaseAdmin().rpc('fail_payment_outbox_event', {
    p_event_id: event.id,
    p_error: errorMessage(error),
    p_retry_delay_seconds: delaySeconds,
  })
  if (updateError) throw updateError
}

async function expandPaymentEvents(limit: number): Promise<{
  claimed: number
  completed: number
  failed: number
}> {
  const { data, error } = await getSupabaseAdmin().rpc('claim_payment_outbox_events', {
    p_limit: boundedBatchSize(limit),
  })
  if (error) throw error

  const events = (Array.isArray(data) ? data : []) as PaymentOutboxRow[]
  let completed = 0
  let failed = 0

  for (const event of events) {
    try {
      if (event.event_type === 'order.confirmed') {
        await enqueueConfirmedOrderNotifications(event)
      }
      await completePaymentEvent(event.id)
      completed += 1
    } catch (eventError) {
      await failPaymentEvent(event, eventError)
      failed += 1
    }
  }

  return { claimed: events.length, completed, failed }
}

function whatsappTemplate(
  order: Order,
  template: WhatsAppNotificationTemplate,
  payload: NotificationPayload
): { name: string; components: TemplateComponent[] } {
  const envName = {
    order_confirmation: 'GETGABS_TEMPLATE_ORDER_CONFIRMATION',
    shipping_update: 'GETGABS_TEMPLATE_SHIPPING_UPDATE',
    delivered: 'GETGABS_TEMPLATE_DELIVERED',
  }[template]
  const name = process.env[envName]
  if (!name) throw new Error(`${envName} is not configured`)

  const customerName = safeMessageText(order.customer_name, 80)
  const orderNumber = safeMessageText(order.order_number, 80)
  let parameters: Array<Record<string, unknown>>

  if (template === 'order_confirmation') {
    parameters = [
      { type: 'text', text: customerName },
      { type: 'text', text: orderNumber },
      { type: 'text', text: formatPrice(order.total_amount) },
    ]
  } else if (template === 'shipping_update') {
    const trackingLink = safeTrackingUrl(order.tracking_url)
      ?? safeTrackingUrl(payload.tracking_link)
    if (!trackingLink) {
      throw new PermanentNotificationError('A valid tracking link is required for shipping updates')
    }
    parameters = [
      { type: 'text', text: customerName },
      { type: 'text', text: orderNumber },
      { type: 'text', text: trackingLink },
    ]
  } else {
    parameters = [
      { type: 'text', text: customerName },
      { type: 'text', text: orderNumber },
    ]
  }

  return {
    name,
    components: [{ type: 'BODY', parameters }],
  }
}

async function sendEmail(
  delivery: NotificationDeliveryRow,
  order: Order,
  template: EmailNotificationTemplate
): Promise<string | undefined> {
  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) throw new Error('RESEND_API_KEY is not configured')

  const recipient = recipientFor(order, 'email', template).recipient
  const rendered = template === 'order_confirmation'
    ? renderOrderConfirmationEmail(order)
    : renderAdminNewOrderEmail(order)
  const { Resend } = await import('resend')
  const resend = new Resend(resendApiKey)
  const { data, error } = await resend.emails.send(
    {
      from: process.env.RESEND_FROM_EMAIL ?? 'NutriPanda <orders@nutripanda.in>',
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
    },
    { idempotencyKey: delivery.idempotency_key }
  )

  if (error) throw new Error(`Resend rejected notification: ${String(error.message ?? error)}`)
  return data?.id
}

async function sendWhatsApp(
  order: Order,
  template: WhatsAppNotificationTemplate,
  payload: NotificationPayload
): Promise<string | undefined> {
  if (!order.customer_whatsapp_opted_in) {
    throw new PermanentNotificationError('Customer is not opted in to WhatsApp updates')
  }
  const config = whatsappTemplate(order, template, payload)
  const result = await sendGetGabsTemplate(toWhatsAppNumber(order.customer_phone), config)
  if (!result.ok) throw new Error(`GetGabs rejected notification: ${result.error ?? 'unknown error'}`)
  return result.id
}

async function markDeliverySent(deliveryId: string, providerMessageId?: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('notifications_log')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      locked_at: null,
      error_message: null,
      provider_message_id: providerMessageId ?? null,
    })
    .eq('id', deliveryId)
    .eq('status', 'processing')
  if (error) throw error
}

async function markDeliverySkipped(deliveryId: string, reason: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('notifications_log')
    .update({
      status: 'skipped',
      locked_at: null,
      error_message: reason.slice(0, 500),
    })
    .eq('id', deliveryId)
    .eq('status', 'processing')
  if (error) throw error
}

async function markDeliveryFailed(
  delivery: NotificationDeliveryRow,
  error: unknown
): Promise<void> {
  const delaySeconds = Math.min(3600, 60 * (2 ** Math.max(0, delivery.attempts - 1)))
  const { error: updateError } = await getSupabaseAdmin()
    .from('notifications_log')
    .update({
      status: 'failed',
      available_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      locked_at: null,
      error_message: errorMessage(error),
    })
    .eq('id', delivery.id)
    .eq('status', 'processing')
  if (updateError) throw updateError
}

async function processDelivery(delivery: NotificationDeliveryRow): Promise<'sent' | 'skipped' | 'failed'> {
  try {
    if (!isTemplateForChannel(delivery.channel, delivery.template)) {
      throw new PermanentNotificationError('Invalid channel/template combination')
    }

    const order = await fetchOrder(delivery.order_id)
    if (!order) throw new PermanentNotificationError('Order no longer exists')
    if (
      (delivery.template === 'order_confirmation' || delivery.template === 'admin_new_order')
      && !isConfirmableOrder(order)
    ) {
      throw new PermanentNotificationError('Order is no longer eligible for confirmation')
    }
    if (delivery.template === 'shipping_update' && order.order_status !== 'shipped') {
      throw new PermanentNotificationError('Order is not currently shipped')
    }
    if (delivery.template === 'delivered' && order.order_status !== 'delivered') {
      throw new PermanentNotificationError('Order is not currently delivered')
    }

    const payload = sanitizeNotificationPayload(delivery.payload)
    const providerMessageId = delivery.channel === 'email'
      ? await sendEmail(delivery, order, delivery.template as EmailNotificationTemplate)
      : await sendWhatsApp(order, delivery.template as WhatsAppNotificationTemplate, payload)

    await markDeliverySent(delivery.id, providerMessageId)
    return 'sent'
  } catch (deliveryError) {
    if (deliveryError instanceof PermanentNotificationError) {
      await markDeliverySkipped(delivery.id, errorMessage(deliveryError))
      return 'skipped'
    }
    await markDeliveryFailed(delivery, deliveryError)
    return 'failed'
  }
}

async function processDeliveries(limit: number): Promise<{
  claimed: number
  sent: number
  skipped: number
  failed: number
}> {
  const { data, error } = await getSupabaseAdmin().rpc('claim_notification_deliveries', {
    p_limit: boundedBatchSize(limit),
  })
  if (error) throw error

  const deliveries = (Array.isArray(data) ? data : []) as NotificationDeliveryRow[]
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const delivery of deliveries) {
    const outcome = await processDelivery(delivery)
    if (outcome === 'sent') sent += 1
    if (outcome === 'skipped') skipped += 1
    if (outcome === 'failed') failed += 1
  }

  return { claimed: deliveries.length, sent, skipped, failed }
}

/**
 * Expand durable commerce events into durable per-channel deliveries, then
 * process a bounded delivery batch. Safe to call from a scheduled worker and
 * from an opportunistic post-checkout invocation.
 */
export async function processNotificationQueues(limit = 10): Promise<QueueProcessingSummary> {
  const batchSize = boundedBatchSize(limit)
  const events = await expandPaymentEvents(batchSize)
  const deliveries = await processDeliveries(batchSize)

  return {
    paymentEventsClaimed: events.claimed,
    paymentEventsCompleted: events.completed,
    paymentEventsFailed: events.failed,
    deliveriesClaimed: deliveries.claimed,
    deliveriesSent: deliveries.sent,
    deliveriesSkipped: deliveries.skipped,
    deliveriesFailed: deliveries.failed,
  }
}

export const NOTIFICATION_MAX_DELIVERY_ATTEMPTS = MAX_DELIVERY_ATTEMPTS
