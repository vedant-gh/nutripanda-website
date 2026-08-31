export class RazorpayPaymentStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RazorpayPaymentStateError'
  }
}

export function gatewayAmount(value: number | string, label: string): number {
  const amount = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RazorpayPaymentStateError(`Razorpay returned an invalid ${label}`)
  }
  return amount
}

export interface VerifiedRazorpayRefund {
  orderId: string
  paymentId: string
  amount: number
  currency: 'INR'
}

interface RazorpayRefundRecord {
  id: string
  order_id: string
  amount: number | string
  currency: string
  status: string
  refund_status?: 'null' | 'partial' | 'full' | null
  amount_refunded?: number | string
}

export function assertFullyRefundedRazorpayPaymentRecord(
  payment: RazorpayRefundRecord,
  input: { storedOrderId: string; paymentId: string; expectedAmount: number }
): VerifiedRazorpayRefund {
  const paymentAmount = gatewayAmount(payment.amount, 'payment amount')
  const refundedAmount = gatewayAmount(payment.amount_refunded ?? 0, 'refunded amount')

  if (payment.id !== input.paymentId || payment.order_id !== input.storedOrderId) {
    throw new RazorpayPaymentStateError('Refunded payment does not belong to this order')
  }
  if (payment.currency !== 'INR' || paymentAmount !== input.expectedAmount) {
    throw new RazorpayPaymentStateError('Refunded payment amount or currency mismatch')
  }
  if (
    payment.status !== 'refunded' ||
    payment.refund_status !== 'full' ||
    refundedAmount !== input.expectedAmount
  ) {
    throw new RazorpayPaymentStateError('Razorpay does not show a completed full refund')
  }

  return {
    orderId: input.storedOrderId,
    paymentId: input.paymentId,
    amount: paymentAmount,
    currency: 'INR',
  }
}
