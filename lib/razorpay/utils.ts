import crypto from 'crypto'

function timingSafeHexEqual(expectedHex: string, receivedHex: string): boolean {
  if (!/^[a-f0-9]+$/i.test(receivedHex) || expectedHex.length !== receivedHex.length) {
    return false
  }

  const expected = Buffer.from(expectedHex, 'hex')
  const received = Buffer.from(receivedHex, 'hex')
  return expected.length === received.length && crypto.timingSafeEqual(expected, received)
}

export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret) throw new Error('Missing RAZORPAY_KEY_SECRET')

  const body = `${orderId}|${paymentId}`
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  return timingSafeHexEqual(expectedSignature, signature)
}

export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) throw new Error('Missing RAZORPAY_WEBHOOK_SECRET')
  if (secret.length < 16 || secret === process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET must be a dedicated strong secret')
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  return timingSafeHexEqual(expectedSignature, signature)
}

let _razorpayInstance: unknown = null

export function getRazorpayInstance() {
  if (!_razorpayInstance) {
    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    if (!keyId || !keySecret) {
      throw new Error('Missing Razorpay credentials')
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Razorpay = require('razorpay')
    _razorpayInstance = new Razorpay({ key_id: keyId, key_secret: keySecret })
  }
  return _razorpayInstance as {
    orders: {
      create: (options: {
        amount: number
        currency: string
        receipt: string
        notes?: Record<string, string>
      }) => Promise<{ id: string; amount: number; currency: string; status: string }>
      fetch: (orderId: string) => Promise<{
        id: string
        amount: number | string
        amount_paid: number | string
        currency: string
        status: string
      }>
    }
    payments: {
      fetch: (paymentId: string) => Promise<{
        id: string
        order_id: string
        amount: number | string
        currency: string
        status: string
        captured?: boolean
        refund_status?: 'null' | 'partial' | 'full' | null
        amount_refunded?: number | string
      }>
    }
  }
}
