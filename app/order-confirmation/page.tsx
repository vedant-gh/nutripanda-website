'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Check, ShoppingBag, AlertCircle, Mail, MessageCircle } from 'lucide-react'
import { useCartStore } from '@/lib/cart/store'
import { formatPrice } from '@/lib/utils/format'
import { trackPaymentCompleted } from '@/lib/posthog/events'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import type { Order, OrderItem } from '@/types/supabase'

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
  return (
    <Suspense fallback={<LoadingState />}>
      <OrderConfirmationContent />
    </Suspense>
  )
}

function OrderConfirmationContent() {
  const searchParams = useSearchParams()
  const orderId = searchParams.get('order_id')
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { clearCart } = useCartStore()

  // Clear cart on mount (in case it wasn't cleared during redirect)
  useEffect(() => {
    clearCart()
  }, [clearCart])

  useEffect(() => {
    if (!orderId) {
      setError('No order ID provided')
      setLoading(false)
      return
    }

    async function fetchOrder() {
      try {
        const res = await fetch(`/api/orders/${orderId}`)
        if (!res.ok) throw new Error('Order not found')
        const data = await res.json()
        setOrder(data.order)

        // Track payment completion + identify user
        if (data.order) {
          const o = data.order
          trackPaymentCompleted({
            order_id: o.id,
            order_number: o.order_number,
            total_amount: o.total_amount,
            item_count: (o.items as { quantity: number }[]).reduce((sum: number, i: { quantity: number }) => sum + i.quantity, 0),
            customer_email: o.customer_email,
          })
        }
      } catch {
        setError('Could not load order details')
      } finally {
        setLoading(false)
      }
    }

    fetchOrder()
  }, [orderId])

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
            We couldn&apos;t find that order
          </h1>
          <p className="mt-3 max-w-sm text-sm text-gray-500">
            {error === 'No order ID provided'
              ? 'Looks like you landed here without an order reference.'
              : 'The order you are looking for might have moved or expired. Reach out and we will help.'}
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

  const items = order.items as OrderItem[]
  const address = order.shipping_address

  return (
    <>
      <Navbar />

      {/* Hero band — reward the customer */}
      <section className="bg-[#f7fdf6]">
        <div className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6 sm:py-16 lg:px-8">
          <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#12BC00] text-white">
            <Check className="h-7 w-7" strokeWidth={3} />
          </span>
          <h1 className="font-heading mt-5 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
            Thank you, {order.customer_name.split(' ')[0]}!
          </h1>
          <p className="mt-3 text-base text-gray-500 sm:text-lg">
            Your order is confirmed. We&apos;re packing it with love.
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
        {/* Order items */}
        <div className="mb-8 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 bg-[#fafafa] px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Order Summary</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <div key={item.productId} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{item.name}</p>
                  <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                </div>
                <p className="font-medium text-gray-900">
                  {formatPrice(item.price * item.quantity)}
                </p>
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
            <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-bold text-gray-900">
              <span>Total Paid</span>
              <span>{formatPrice(order.total_amount)}</span>
            </div>
          </div>
        </div>

        {/* Shipping details */}
        <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Shipping To</h2>
          <p className="font-medium text-gray-900">{order.customer_name}</p>
          <p className="mt-1 text-sm text-gray-500">
            {[address.line1, address.line2, address.city, address.state, address.pincode]
              .filter(Boolean)
              .join(', ')}
          </p>
          <p className="mt-3 text-sm text-gray-500">{order.customer_email}</p>
          <p className="text-sm text-gray-500">{order.customer_phone}</p>
        </div>

        {/* What happens next */}
        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-[#fafafa] p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-[#12BC00]">
              <Mail className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Email confirmation</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                A receipt is on its way to {order.customer_email}.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-[#fafafa] p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-[#12BC00]">
              <MessageCircle className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {order.customer_whatsapp_opted_in
                  ? 'WhatsApp updates on'
                  : 'Tracking updates'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                {order.customer_whatsapp_opted_in
                  ? 'We will ping you on WhatsApp as your order ships.'
                  : 'Watch your inbox — we will share tracking once it ships.'}
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
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
