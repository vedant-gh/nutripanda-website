// GetGabs WhatsApp Business API client.
// Docs: https://documenter.getpostman.com/view/40451098/2sAYJ1k2VV
// Note: the API key is sent in the request BODY (`api_key`), not a header.

const BASE_URL = 'https://app.getgabs.com'

export interface GetGabsResult {
  ok: boolean
  id?: string
  error?: string
}

export interface TemplateComponent {
  type: string
  sub_type?: string
  index?: number
  parameters?: Array<Record<string, unknown>>
}

/**
 * Normalise an Indian mobile number to WhatsApp wa_id form: country code + number,
 * no leading '+' (e.g. "9876543210" -> "919876543210").
 */
export function toWhatsAppNumber(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `91${d}`
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`
  if (d.length === 12 && d.startsWith('91')) return d
  return d
}

function extractMessageId(data: Record<string, unknown>): string | undefined {
  const messages = data?.messages as Array<{ id?: string }> | undefined
  return messages?.[0]?.id
}

/**
 * Free-text WhatsApp "service" message. Per WhatsApp policy this ONLY delivers
 * inside the 24-hour customer-service window (i.e. after the customer has messaged
 * the business). For business-initiated messages, use sendGetGabsTemplate().
 */
export async function sendGetGabsText(to: string, body: string): Promise<GetGabsResult> {
  const apiKey = process.env.GETGABS_API_KEY
  if (!apiKey) return { ok: false, error: 'GETGABS_API_KEY not set' }

  try {
    const res = await fetch(`${BASE_URL}/sendservicemessages/sendmessages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        type: 'text',
        to,
        text: { body, preview_url: true },
        api_key: apiKey,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || data?.status === false) {
      return { ok: false, error: String(data?.message ?? `HTTP ${res.status}`) }
    }
    return { ok: true, id: extractMessageId(data) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Request failed' }
  }
}

/**
 * Approved-template WhatsApp message. Required for business-initiated messages
 * (order confirmations, shipping updates, etc.). Needs an approved template name
 * plus the sender number and campaign id from the GetGabs account (env vars).
 */
export async function sendGetGabsTemplate(
  to: string,
  opts: { name: string; languageCode?: string; components?: TemplateComponent[] }
): Promise<GetGabsResult> {
  const apiKey = process.env.GETGABS_API_KEY
  const sender = process.env.GETGABS_SENDER
  const campaignId = process.env.GETGABS_CAMPAIGN_ID
  if (!apiKey) return { ok: false, error: 'GETGABS_API_KEY not set' }
  if (!sender) return { ok: false, error: 'GETGABS_SENDER not set' }

  try {
    const res = await fetch(`${BASE_URL}/whatsappbusiness/send-templated-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        sender,
        ...(campaignId ? { campaign_id: campaignId } : {}),
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: opts.name,
          language: { code: opts.languageCode ?? process.env.GETGABS_TEMPLATE_LANG ?? 'en' },
          ...(opts.components?.length ? { components: opts.components } : {}),
        },
      }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || data?.status === false) {
      return { ok: false, error: String(data?.message ?? `HTTP ${res.status}`) }
    }
    return { ok: true, id: extractMessageId(data) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Request failed' }
  }
}
