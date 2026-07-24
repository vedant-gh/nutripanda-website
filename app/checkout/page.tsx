'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import toast from 'react-hot-toast'
import { useCartStore } from '@/lib/cart/store'
import { SHIPPING_COST, COD_FEE } from '@/lib/utils/constants'
import OrderSummary from '@/components/checkout/OrderSummary'
import CheckoutForm, { type CheckoutFormData } from '@/components/checkout/CheckoutForm'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { trackCheckoutStarted, trackPaymentInitiated, trackPaymentFailed, trackCouponApplied } from '@/lib/posthog/events'

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance
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

export default function CheckoutPage() {
  const router = useRouter()
  const { items, isHydrated, getSubtotal } = useCartStore()
  const [isLoading, setIsLoading] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'prepaid' | 'cod'>('prepaid')
  const [couponInput, setCouponInput] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [discount, setDiscount] = useState(0)
  const [couponApplied, setCouponApplied] = useState(false)
  const [couponLoading, setCouponLoading] = useState(false)

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
        trackCouponApplied(data.code, data.discountPercent ?? 0)
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
    setIsLoading(true)

    try {
      // Cash on Delivery — no payment gateway; create the order directly.
      if (paymentMethod === 'cod') {
        const codRes = await fetch('/api/orders/cod', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items.map((item) => ({
              productId: item.productId,
              name: item.name,
              slug: item.slug,
              price: item.price,
              image: item.image,
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
          }),
        })

        if (!codRes.ok) {
          const err = await codRes.json().catch(() => ({}))
          throw new Error(err.error || 'Failed to place order')
        }

        const { order_id } = await codRes.json()
        // Don't clearCart() here — it would trip the empty-cart guard and bounce
        // to /products. The confirmation page clears the cart on mount.
        router.push(`/order-confirmation?order_id=${order_id}`)
        return
      }

      // 1. Create Razorpay order via our API
      const orderPayload = {
        items: items.map((item) => ({
          productId: item.productId,
          name: item.name,
          slug: item.slug,
          price: item.price,
          image: item.image,
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
        subtotal,
        shippingCost: SHIPPING_COST,
        discount,
        couponCode: couponCode || undefined,
        total,
      }

      const createRes = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload),
      })

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to create order')
      }

      const { razorpay_order_id, order_id } = await createRes.json()

      // 2. Open Razorpay checkout modal
      const options: RazorpayOptions = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
        amount: total,
        currency: 'INR',
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

            if (!verifyRes.ok) {
              throw new Error('Payment verification failed')
            }

            router.push(`/order-confirmation?order_id=${order_id}`)
          } catch {
            toast.error('Payment verification failed. Please contact support.')
            setIsLoading(false)
          }
        },
        prefill: {
          name: formData.name.trim(),
          email: formData.email.trim(),
          contact: formData.phone.trim(),
        },
        theme: { color: '#12BC00' },
        modal: {
          ondismiss: () => {
            setIsLoading(false)
          },
        },
      }

      const rzp = new window.Razorpay(options)
      rzp.on('payment.failed', () => {
        toast.error('Payment failed. Please try again.')
        trackPaymentFailed(order_id)
        setIsLoading(false)
      })
      trackPaymentInitiated(order_id, total)
      rzp.open()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
      setIsLoading(false)
    }
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <Navbar />

      {/* Hero band */}
      <section className="bg-[#f7fdf6]">
        <div className="mx-auto max-w-7xl px-4 pt-10 pb-10 sm:px-6 sm:pt-14 sm:pb-12 lg:px-8">
          <nav className="mb-5 text-xs text-gray-400 sm:text-sm">
            <a href="/products" className="transition-colors hover:text-gray-600">
              Products
            </a>
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
