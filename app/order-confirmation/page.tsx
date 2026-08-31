'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Check, Mail, MessageCircle, ShoppingBag } from 'lucide-react'
import { useCartStore } from '@/lib/cart/store'
import { formatPrice } from '@/lib/utils/format'
import { trackPaymentCompleted } from '@/lib/posthog/events'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'

const CONFIRMATION_SESSION_KEY = 'nutripanda-order-confirmation'
const CHECKOUT_ATTEMPT_STORAGE_KEY = 'nutripanda-checkout-attempt'

interface ConfirmationAccess {
  orderId: string
  token: string
  tracked?: boolean
}

interface ConfirmationItem {
  name: string
  quantity: number
  unit_price: number
  line_total: number
}

interface ConfirmationOrder {
  order_number: string
  customer_first_name: string
  items: ConfirmationItem[]
  subtotal: number
  shipping_cost: number
  discount: number
  cod_fee: number
  total_amount: number
  payment_method: 'prepaid' | 'cod'
  payment_status: string
  order_status: string
  payment_review_required: boolean
  payment_review_reason: string | null
  created_at: string
}

function readConfirmationAccess(): ConfirmationAccess | null {
  try {
    const raw = sessionStorage.getItem(CONFIRMATION_SESSION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof value.orderId !== 'string' ||
      typeof value.token !== 'string' ||
      !value.orderId ||
      !value.token
    ) {
      return null
    }
    return {
      orderId: value.orderId,
      token: value.token,
      tracked: value.tracked === true,
    }
  } catch {
    return null
  }
}

function isConfirmationOrder(value: unknown): value is ConfirmationOrder {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const order = value as Record<string, unknown>
  if (
    typeof order.order_number !== 'string' ||
    typeof order.customer_first_name !== 'string' ||
    !Array.isArray(order.items) ||
    !['prepaid', 'cod'].includes(String(order.payment_method)) ||
    typeof order.payment_review_required !== 'boolean' ||
    (order.payment_review_reason !== null && typeof order.payment_review_reason !== 'string')
  ) {
    return false
  }

  const moneyFields = [
    order.subtotal,
    order.shipping_cost,
    order.discount,
    order.cod_fee,
    order.total_amount,
  ]
  if (!moneyFields.every((amount) => typeof amount === 'number' && Number.isSafeInteger(amount))) {
    return false
  }

  return order.items.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const entry = item as Record<string, unknown>
    return (
      typeof entry.name === 'string' &&
      typeof entry.quantity === 'number' &&
      Number.isSafeInteger(entry.quantity) &&
      typeof entry.unit_price === 'number' &&
      Number.isSafeInteger(entry.unit_price) &&
      typeof entry.line_total === 'number' &&
      Number.isSafeInteger(entry.line_total)
    )
  })
}

function LoadingState() {
  return (
    <>
      <Navbar />
      <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-gray-200 border-t-brand-green" />
          <p className="text-sm text-gray-500">Loading your order...</p>
        </div>
      </main>
      <Footer />
    </>
  )
}

export default function OrderConfirmationPage() {
  const [order, setOrder] = useState<ConfirmationOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { clearCart } = useCartStore()

  useEffect(() => {
    const access = readConfirmationAccess()
    if (!access) {
      setError('missing')
      setLoading(false)
      return
    }
    const confirmationAccess = access

    const controller = new AbortController()

    async function fetchOrder() {
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(confirmationAccess.orderId)}`, {
          headers: { Authorization: `Bearer ${confirmationAccess.token}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await response.json().catch(() => ({})) as { order?: unknown }
        if (!response.ok || !isConfirmationOrder(data.order)) {
          throw new Error('Order not found')
        }

        setOrder(data.order)
        clearCart()
        localStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY)

        if (!data.order.payment_review_required && !confirmationAccess.tracked) {
          trackPaymentCompleted({
            total_amount: data.order.total_amount,
            item_count: data.order.items.reduce((sum, item) => sum + item.quantity, 0),
            payment_method: data.order.payment_method,
          })
          sessionStorage.setItem(
            CONFIRMATION_SESSION_KEY,
            JSON.stringify({ ...confirmationAccess, tracked: true })
          )
        }
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
        setError('unavailable')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void fetchOrder()
    return () => controller.abort()
  }, [clearCart])

  if (loading) return <LoadingState />

  if (error || !order) {
    return (
      <>
        <Navbar />
        <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <AlertCircle className="h-8 w-8" strokeWidth={1.5} />
          </span>
          <h1 className="font-heading mt-5 text-2xl font-bold text-gray-900 sm:text-3xl">
            We couldn&apos;t open that order
          </h1>
          <p className="mt-3 max-w-sm text-sm text-gray-500">
            {error === 'missing'
              ? 'Open this page immediately after placing your order to view its secure confirmation.'
              : 'The secure confirmation may have expired. Contact us and we will help with your order.'}
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/products"
              className="inline-flex items-center gap-2 rounded-full bg-[#12BC00] px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-[#0fa600] active:scale-[0.98]"
            >
              <ShoppingBag size={16} />
              Continue Shopping
            </Link>
            <a
              href="mailto:contact@nutripanda.in"
              className="inline-flex items-center gap-2 rounded-full border-2 border-gray-900 px-8 py-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-900 hover:text-white active:scale-[0.98]"
            >
              <Mail size={16} />
              Contact Support
            </a>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  const isCod = order.payment_method === 'cod'
  const needsRefundReview = order.payment_review_required

  return (
    <>
      <Navbar />

      <section className="bg-[#f7fdf6]">
        <div className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6 sm:py-16 lg:px-8">
          <span className={`mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full text-white ${needsRefundReview ? 'bg-amber-500' : 'bg-[#12BC00]'}`}>
            {needsRefundReview
              ? <AlertCircle className="h-7 w-7" strokeWidth={2.5} />
              : <Check className="h-7 w-7" strokeWidth={3} />}
          </span>
          <h1 className="font-heading mt-5 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
            {needsRefundReview
              ? `Payment received, ${order.customer_first_name}`
              : `Thank you, ${order.customer_first_name}!`}
          </h1>
          <p className="mt-3 text-base text-gray-500 sm:text-lg">
            {needsRefundReview
              ? 'This order cannot be fulfilled and will not be shipped. A full Razorpay refund must be reconciled.'
              : 'Your order is confirmed. We\'re packing it with love.'}
          </p>

          <div className="mx-auto mt-6 inline-flex flex-col items-center gap-1 rounded-2xl bg-white px-6 py-3 shadow-sm ring-1 ring-gray-200 sm:flex-row sm:gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Order
            </span>
            <span className="font-heading text-base font-bold text-gray-900">
              {order.order_number}
            </span>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="mb-8 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 bg-[#fafafa] px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Order Summary</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {order.items.map((item, index) => (
              <div key={`${item.name}-${index}`} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{item.name}</p>
                  <p className="text-sm text-gray-500">
                    Qty: {item.quantity} · {formatPrice(item.unit_price)} each
                  </p>
                </div>
                <p className="font-medium text-gray-900">{formatPrice(item.line_total)}</p>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 border-t border-gray-200 bg-[#fafafa] px-5 py-4">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span>{formatPrice(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Shipping</span>
              <span className="font-medium text-brand-green">
                {order.shipping_cost === 0 ? 'Free' : formatPrice(order.shipping_cost)}
              </span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-sm text-brand-green">
                <span>Discount</span>
                <span>-{formatPrice(order.discount)}</span>
              </div>
            )}
            {order.cod_fee > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>COD fee</span>
                <span>{formatPrice(order.cod_fee)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-bold text-gray-900">
              <span>{needsRefundReview ? 'Payment captured' : isCod ? 'Pay on Delivery' : 'Total Paid'}</span>
              <span>{formatPrice(order.total_amount)}</span>
            </div>
          </div>
        </div>

        {needsRefundReview && (
          <div className="mb-8 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-left">
            <p className="text-sm font-semibold text-amber-950">Do not retry this payment</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900/80">
              Your payment is recorded, but this order was safely stopped before fulfilment.
              Please contact support with order <strong>{order.order_number}</strong> so the
              completed full refund can be confirmed.
            </p>
            <a
              href="mailto:contact@nutripanda.in"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
            >
              <Mail className="h-4 w-4" />
              Contact Support
            </a>
          </div>
        )}

        {isCod && !needsRefundReview && (
          <div className="mb-8 flex items-center gap-3 rounded-2xl border border-[#12BC00]/30 bg-[#DCFDCC]/40 p-5">
            <span className="text-2xl" aria-hidden>💵</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Cash on Delivery</p>
              <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
                Please keep {formatPrice(order.total_amount)} ready when your order arrives.
              </p>
            </div>
          </div>
        )}

        {!needsRefundReview && <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-[#fafafa] p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-[#12BC00]">
              <Mail className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Email confirmation</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                Your receipt is being sent to the email used at checkout.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-[#fafafa] p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-[#12BC00]">
              <MessageCircle className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Tracking updates</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                We will share tracking once your order ships.
              </p>
            </div>
          </div>
        </div>}

        <div className="flex justify-center">
          <Link
            href="/products"
            className="inline-flex items-center gap-2 rounded-full bg-[#12BC00] px-10 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#0fa600] active:scale-[0.98]"
          >
            <ShoppingBag size={16} />
            Continue Shopping
          </Link>
        </div>
      </main>
      <Footer />
    </>
  )
}
