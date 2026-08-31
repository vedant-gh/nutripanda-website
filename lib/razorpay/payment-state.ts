import { getRazorpayInstance } from './utils'
import {
  assertFullyRefundedRazorpayPaymentRecord,
  gatewayAmount,
  RazorpayPaymentStateError,
  type VerifiedRazorpayRefund,
} from './payment-state-core'

export {
  assertFullyRefundedRazorpayPaymentRecord,
  RazorpayPaymentStateError,
  type VerifiedRazorpayRefund,
} from './payment-state-core'

export interface VerifiedRazorpayPayment {
  orderId: string
  paymentId: string
  amount: number
  currency: 'INR'
}

export async function verifyCapturedRazorpayPayment(input: {
  storedOrderId: string
  paymentId: string
  expectedAmount: number
  expectedCurrency?: 'INR'
}): Promise<VerifiedRazorpayPayment> {
  const razorpay = getRazorpayInstance()
  const [payment, gatewayOrder] = await Promise.all([
    razorpay.payments.fetch(input.paymentId),
    razorpay.orders.fetch(input.storedOrderId),
  ])

  const expectedCurrency = input.expectedCurrency ?? 'INR'
  const paymentAmount = gatewayAmount(payment.amount, 'payment amount')
  const orderAmount = gatewayAmount(gatewayOrder.amount, 'order amount')
  const orderAmountPaid = gatewayAmount(gatewayOrder.amount_paid, 'paid amount')

  if (payment.id !== input.paymentId || payment.order_id !== input.storedOrderId) {
    throw new RazorpayPaymentStateError('Payment does not belong to this order')
  }
  if (gatewayOrder.id !== input.storedOrderId) {
    throw new RazorpayPaymentStateError('Razorpay order mismatch')
  }
  if (payment.status !== 'captured' || payment.captured === false) {
    throw new RazorpayPaymentStateError('Payment has not been captured')
  }
  if (gatewayOrder.status !== 'paid') {
    throw new RazorpayPaymentStateError('Razorpay order is not paid')
  }
  if (payment.currency !== expectedCurrency || gatewayOrder.currency !== expectedCurrency) {
    throw new RazorpayPaymentStateError('Payment currency mismatch')
  }
  if (
    paymentAmount !== input.expectedAmount ||
    orderAmount !== input.expectedAmount ||
    orderAmountPaid !== input.expectedAmount
  ) {
    throw new RazorpayPaymentStateError('Payment amount mismatch')
  }

  return {
    orderId: input.storedOrderId,
    paymentId: input.paymentId,
    amount: paymentAmount,
    currency: expectedCurrency,
  }
}

/**
 * Read-only reconciliation for refunds initiated in Razorpay. This never
 * creates a refund; it only confirms that the full captured amount is already
 * refunded before the local order can be cancelled.
 */
export async function verifyFullyRefundedRazorpayPayment(input: {
  storedOrderId: string
  paymentId: string
  expectedAmount: number
}): Promise<VerifiedRazorpayRefund> {
  const payment = await getRazorpayInstance().payments.fetch(input.paymentId)
  return assertFullyRefundedRazorpayPaymentRecord(payment, input)
}
