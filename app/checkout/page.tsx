'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Script from 'next/script'
import toast from 'react-hot-toast'
import { useCartStore } from '@/lib/cart/store'
import { SHIPPING_COST, COD_FEE } from '@/lib/utils/constants'
import OrderSummary from '@/components/checkout/OrderSummary'
import CheckoutForm, { type CheckoutFormData } from '@/components/checkout/CheckoutForm'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { trackCheckoutStarted, trackPaymentInitiated, trackPaymentFailed, trackCouponApplied } from '@/lib/posthog/events'

const CONFIRMATION_SESSION_KEY = 'nutripanda-order-confirmation'
const CHECKOUT_ATTEMPT_STORAGE_KEY = 'nutripanda-checkout-attempt'
const CHECKOUT_ATTEMPT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

interface CheckoutAttempt {
  key: string
  createdAt: number
  paymentMethod: 'prepaid' | 'cod'
}

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string
        action: string
        callback: (token: string) => void
        'expired-callback': () => void
        'error-callback': () => void
      }) => string
      reset: (widgetId?: string) => void
      remove: (widgetId: string) => void
    }
  }
}

interface RazorpayOptions {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  handler: (response: RazorpayResponse) => void
  prefill: { name: string; email: string; contact: string }
  theme: { color: string }
  timeout?: number
  modal?: { ondismiss?: () => void }
}

interface RazorpayInstance {
  open: () => void
  on: (event: string, callback: () => void) => void
}

interface RazorpayResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

interface CheckoutResponse {
  order_id?: unknown
  confirmation_token?: unknown
  razorpay_order_id?: unknown
  amount?: unknown
  currency?: unknown
  key_id?: unknown
  error?: unknown
  code?: unknown
  recovery_state?: unknown
}

function checkoutError(data: CheckoutResponse, fallback: string): string {
  return typeof data.error === 'string' && data.error.trim() ? data.error : fallback
}

function saveConfirmation(orderId: unknown, token: unknown) {
  if (typeof orderId !== 'string' || typeof token !== 'string' || !orderId || !token) {
    throw new Error(
      'The order was placed, but its secure confirmation could not be opened. Please contact support.'
    )
  }

  sessionStorage.setItem(
    CONFIRMATION_SESSION_KEY,
    JSON.stringify({ orderId, token })
  )
}

function readStoredCheckoutAttempt(): CheckoutAttempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) ?? 'null') as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const attempt = value as Record<string, unknown>
    if (
      typeof attempt.key !== 'string'
      || typeof attempt.createdAt !== 'number'
      || !Number.isFinite(attempt.createdAt)
      || !['prepaid', 'cod'].includes(String(attempt.paymentMethod))
    ) {
      return null
    }
    if (
      attempt.createdAt > Date.now() + 5 * 60 * 1000
      || Date.now() - attempt.createdAt > CHECKOUT_ATTEMPT_MAX_AGE_MS
    ) {
      localStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY)
      return null
    }
    return attempt as unknown as CheckoutAttempt
  } catch {
    return null
  }
}

function persistCheckoutAttempt(attempt: CheckoutAttempt): boolean {
  try {
    localStorage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt))
    const stored = readStoredCheckoutAttempt()
    return Boolean(
      stored
      && stored.key === attempt.key
      && stored.createdAt === attempt.createdAt
      && stored.paymentMethod === attempt.paymentMethod
    )
  } catch {
    return false
  }
}

function clearStoredCheckoutAttempt() {
  try {
    localStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY)
  } catch {
    // The in-memory copy is cleared by the caller.
  }
}

export default function CheckoutPage() {
  const router = useRouter()
  const { items, isHydrated, getSubtotal } = useCartStore()
  const [isLoading, setIsLoading] = useState(false)
  const [razorpayReady, setRazorpayReady] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'prepaid' | 'cod'>('prepaid')
  const [couponInput, setCouponInput] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [discount, setDiscount] = useState(0)
  const [couponApplied, setCouponApplied] = useState(false)
  const [couponLoading, setCouponLoading] = useState(false)
  const [turnstileReady, setTurnstileReady] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const checkoutAttempt = useRef<CheckoutAttempt | null>(null)
  const turnstileContainer = useRef<HTMLDivElement | null>(null)
  const turnstileWidgetId = useRef<string | null>(null)

  useEffect(() => {
    const storedAttempt = readStoredCheckoutAttempt()
    if (!storedAttempt) return
    checkoutAttempt.current = storedAttempt
    setPaymentMethod(storedAttempt.paymentMethod)
  }, [])

  useEffect(() => {
    if (!turnstileReady || !TURNSTILE_SITE_KEY || !turnstileContainer.current) return
    const turnstile = window.turnstile
    if (!turnstile) return

    if (turnstileWidgetId.current) turnstile.remove(turnstileWidgetId.current)
    turnstileWidgetId.current = turnstile.render(turnstileContainer.current, {
      sitekey: TURNSTILE_SITE_KEY,
      action: 'checkout',
      callback: (token) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(null),
      'error-callback': () => setTurnstileToken(null),
    })

    return () => {
      if (turnstileWidgetId.current) turnstile.remove(turnstileWidgetId.current)
      turnstileWidgetId.current = null
    }
  }, [turnstileReady])

  // Redirect to products if cart is empty after hydration
  useEffect(() => {
    if (isHydrated && items.length === 0) {
      router.replace('/products')
    }
    if (isHydrated && items.length > 0) {
      trackCheckoutStarted(items.reduce((sum, i) => sum + i.quantity, 0), getSubtotal())
    }
  }, [isHydrated, items, router, getSubtotal])

  // Don't render until hydrated
  if (!isHydrated) {
    return (
      <>
        <Navbar />
        <main className="mx-auto min-h-[60vh] max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 w-48 rounded bg-gray-200" />
            <div className="h-64 rounded-2xl bg-gray-100" />
          </div>
        </main>
        <Footer />
      </>
    )
  }

  // If cart is empty (before redirect fires), show nothing
  if (items.length === 0) return null

  const subtotal = getSubtotal()
  const codFee = paymentMethod === 'cod' ? COD_FEE : 0
  const total = subtotal + SHIPPING_COST + codFee - discount

  async function handleApplyCoupon(codeArg?: string) {
    const code = (codeArg ?? couponInput).trim()
    if (!code) return

    setCouponLoading(true)
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, subtotal }),
      })

      const data = await res.json()

      if (data.valid) {
        setDiscount(data.discount)
        setCouponCode(data.code)
        setCouponApplied(true)
        setCouponInput('')
        toast.success(`Coupon applied! You saved ₹${(data.discount / 100).toFixed(0)}`)
        trackCouponApplied(data.discountPercent ?? 0)
      } else {
        toast.error(data.error || 'Invalid coupon code')
      }
    } catch {
      toast.error('Failed to validate coupon')
    } finally {
      setCouponLoading(false)
    }
  }

  function handleRemoveCoupon() {
    setDiscount(0)
    setCouponCode('')
    setCouponApplied(false)
    setCouponInput('')
  }

  async function handleCheckout(formData: CheckoutFormData) {
    if (!TURNSTILE_SITE_KEY || !turnstileToken) {
      toast.error(
        TURNSTILE_SITE_KEY
          ? 'Complete the checkout security check first.'
          : 'Checkout security is temporarily unavailable.'
      )
      return
    }
    if (paymentMethod === 'prepaid' && (!razorpayReady || !window.Razorpay)) {
      toast.error('Secure payment is still loading. Please try again in a moment.')
      return
    }

    setIsLoading(true)

    try {
      const checkoutPayload = {
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        customer: {
          name: formData.name.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          whatsappOptIn: formData.whatsappOptIn,
        },
        shippingAddress: {
          line1: formData.addressLine1.trim(),
          line2: formData.addressLine2.trim() || undefined,
          city: formData.city.trim(),
          state: formData.state,
          pincode: formData.pincode.trim(),
        },
        couponCode: couponCode || undefined,
        turnstileToken,
      }
      // Reuse the durable key until the server proves the previous attempt is
      // terminal. Only the opaque key and non-sensitive bookkeeping are kept
      // locally; the server owns the canonical payload hash and comparison.
      const reusableAttempt = checkoutAttempt.current ?? readStoredCheckoutAttempt()
      if (reusableAttempt) {
        if (!persistCheckoutAttempt(reusableAttempt)) {
          throw new Error(
            'Checkout cannot start because this browser is blocking durable payment safety storage. Enable site storage or use another browser.'
          )
        }
        checkoutAttempt.current = reusableAttempt
      } else {
        const newAttempt: CheckoutAttempt = {
          key: `checkout_${crypto.randomUUID()}`,
          createdAt: Date.now(),
          paymentMethod,
        }
        if (!persistCheckoutAttempt(newAttempt)) {
          throw new Error(
            'Checkout cannot start because this browser is blocking durable payment safety storage. Enable site storage or use another browser.'
          )
        }
        checkoutAttempt.current = newAttempt
      }
      const idempotencyKey = checkoutAttempt.current.key

      // Cash on Delivery — no payment gateway; create the order directly.
      if (paymentMethod === 'cod') {
        const codRes = await fetch('/api/orders/cod', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(checkoutPayload),
        })
        const data = await codRes.json().catch(() => ({})) as CheckoutResponse

        if (!codRes.ok) {
          if (
            data.code === 'checkout_not_payable'
            || data.code === 'checkout_refunded'
            || data.code === 'checkout_previous_terminal'
          ) {
            checkoutAttempt.current = null
            clearStoredCheckoutAttempt()
          }
          throw new Error(checkoutError(data, 'Failed to place order'))
        }

        saveConfirmation(data.order_id, data.confirmation_token)
        router.push('/order-confirmation')
        return
      }

      // 1. Create Razorpay order via our API
      const createRes = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(checkoutPayload),
      })
      const createData = await createRes.json().catch(() => ({})) as CheckoutResponse

      if (!createRes.ok) {
        if (
          createData.code === 'checkout_refunded'
          || createData.code === 'checkout_previous_terminal'
        ) {
          checkoutAttempt.current = null
          clearStoredCheckoutAttempt()
        }
        throw new Error(checkoutError(createData, 'Failed to create order'))
      }

      // If payment finalization succeeded but the earlier browser response was
      // lost, the idempotency replay recovers the paid order instead of ever
      // opening a second Razorpay checkout.
      if (
        createData.recovery_state === 'paid'
        || createData.recovery_state === 'payment_review'
      ) {
        saveConfirmation(createData.order_id, createData.confirmation_token)
        router.push('/order-confirmation')
        return
      }

      const { razorpay_order_id, order_id, amount, currency, key_id } = createData
      if (
        typeof razorpay_order_id !== 'string' ||
        typeof order_id !== 'string' ||
        typeof amount !== 'number' ||
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        currency !== 'INR' ||
        typeof key_id !== 'string' ||
        !key_id
      ) {
        throw new Error('Payment provider returned an invalid checkout session')
      }

      if (amount !== total) {
        toast('Your total was refreshed using current prices and availability.')
      }

      // 2. Open Razorpay checkout modal
      const options: RazorpayOptions = {
        key: key_id,
        amount,
        currency,
        name: 'NutriPanda',
        description: 'Order Payment',
        order_id: razorpay_order_id,
        handler: async (response: RazorpayResponse) => {
          // 3. Verify payment with our API
          try {
            const verifyRes = await fetch('/api/razorpay/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                order_id,
              }),
            })
            const verifyData = await verifyRes.json().catch(() => ({})) as CheckoutResponse

            if (!verifyRes.ok) {
              throw new Error(checkoutError(verifyData, 'Payment verification failed'))
            }

            saveConfirmation(verifyData.order_id, verifyData.confirmation_token)
            router.push('/order-confirmation')
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : 'Payment verification failed. Please contact support.'
            )
            setIsLoading(false)
          }
        },
        prefill: {
          name: formData.name.trim(),
          email: formData.email.trim(),
          contact: formData.phone.trim(),
        },
        theme: { color: '#12BC00' },
        // UX guard only; the database independently rejects captures after the
        // 30-minute inventory reservation expires.
        timeout: 30 * 60,
        modal: {
          ondismiss: () => {
            setIsLoading(false)
          },
        },
      }

      const rzp = new window.Razorpay(options)
      rzp.on('payment.failed', () => {
        toast.error('Payment failed. Please try again.')
        trackPaymentFailed()
        setIsLoading(false)
      })
      trackPaymentInitiated(amount)
      rzp.open()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
      if (turnstileWidgetId.current) window.turnstile?.reset(turnstileWidgetId.current)
      setTurnstileToken(null)
      setIsLoading(false)
    }
  }

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onLoad={() => setRazorpayReady(true)}
        onReady={() => setRazorpayReady(true)}
        onError={() => setRazorpayReady(false)}
      />
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setTurnstileReady(true)}
        onReady={() => setTurnstileReady(true)}
        onError={() => setTurnstileReady(false)}
      />
      <Navbar />

      {/* Hero band */}
      <section className="bg-[#f7fdf6]">
        <div className="mx-auto max-w-7xl px-4 pt-10 pb-10 sm:px-6 sm:pt-14 sm:pb-12 lg:px-8">
          <nav className="mb-5 text-xs text-gray-400 sm:text-sm">
            <Link href="/products" className="transition-colors hover:text-gray-600">
              Products
            </Link>
            <span className="mx-2">/</span>
            <span className="text-gray-700">Checkout</span>
          </nav>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
            Checkout
          </h1>
          <p className="mt-3 max-w-xl text-sm text-gray-500 sm:text-base">
            Enter your details below. Payment is secured by Razorpay.
          </p>
        </div>
      </section>

      <main className="mx-auto min-h-[60vh] max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="flex flex-col-reverse gap-8 lg:flex-row lg:items-start lg:gap-12">
          {/* Form — left on desktop, bottom on mobile */}
          <div className="flex-1 lg:max-w-[60%]">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
              <CheckoutForm
                onSubmit={handleCheckout}
                isLoading={isLoading}
                paymentMethod={paymentMethod}
                onPaymentMethodChange={setPaymentMethod}
                codFee={codFee}
                verificationSlot={(
                  <div className="pt-2">
                    <div ref={turnstileContainer} className="min-h-[65px]" />
                    {!TURNSTILE_SITE_KEY && (
                      <p className="text-sm text-red-600">
                        Checkout security is not configured. Please contact support.
                      </p>
                    )}
                  </div>
                )}
              />
            </div>
          </div>

          {/* Order summary — right on desktop, top on mobile */}
          <div className="w-full lg:w-[40%]">
            <div className="lg:sticky lg:top-20 space-y-4">
              <OrderSummary
                items={items}
                subtotal={subtotal}
                discount={discount}
                couponCode={couponCode}
                codFee={codFee}
              />

              {/* Coupon code input */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Have a coupon?</h3>
                {couponApplied ? (
                  <div className="flex items-center justify-between rounded-xl border border-[#12BC00]/30 bg-[#DCFDCC]/50 px-4 py-3">
                    <div>
                      <span className="text-sm font-semibold text-gray-900">{couponCode}</span>
                      <span className="ml-2 text-xs font-medium text-[#0fa600]">Applied</span>
                    </div>
                    <button
                      onClick={handleRemoveCoupon}
                      className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-900"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter coupon code"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
                      />
                      <button
                        onClick={() => handleApplyCoupon()}
                        disabled={couponLoading || !couponInput.trim()}
                        className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {couponLoading ? '...' : 'Apply'}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Trust strip */}
              <div className="rounded-2xl border border-gray-200 bg-[#fafafa] p-5 sm:p-6">
                <ul className="space-y-2.5 text-xs text-gray-600 sm:text-sm">
                  {[
                    'Free shipping on prepaid orders',
                    '30-day satisfaction guarantee',
                    'Secure payment via Razorpay',
                  ].map((point) => (
                    <li key={point} className="flex items-center gap-2.5">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        className="h-4 w-4 shrink-0"
                        stroke="#12BC00"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
