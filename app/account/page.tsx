import { cookies } from 'next/headers'
import Link from 'next/link'
import type { Metadata } from 'next'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/customer-auth'
import { getOrdersByEmail } from '@/lib/supabase/queries'
import { formatPrice } from '@/lib/utils/format'
import LoginForm from './LoginForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'My Orders',
  robots: { index: false, follow: false },
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-amber-50 text-amber-700',
  shipped: 'bg-indigo-50 text-indigo-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
}

export default async function AccountPage() {
  const cookieStore = await cookies()
  const email = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto min-h-[60vh] max-w-3xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        {email ? <OrdersView email={email} /> : <LoginForm />}
      </main>
      <Footer />
    </div>
  )
}

async function OrdersView({ email }: { email: string }) {
  const orders = await getOrdersByEmail(email)

  return (
    <>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            My Orders
          </h1>
          <p className="mt-1 text-sm text-gray-500">{email}</p>
        </div>
        <form action="/api/account/logout" method="post">
          <button
            type="submit"
            className="shrink-0 rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
          >
            Log out
          </button>
        </form>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-[#fafafa] py-16 text-center">
          <p className="text-sm text-gray-500">No orders found for this email yet.</p>
          <Link
            href="/products"
            className="mt-4 inline-block rounded-full bg-[#12BC00] px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Shop now
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const itemCount = order.items.reduce((n, i) => n + i.quantity, 0)
            const date = new Date(order.created_at).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
            return (
              <article
                key={order.id}
                className="rounded-2xl border border-gray-200 bg-white p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-gray-900">#{order.order_number}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {date} · {itemCount} {itemCount === 1 ? 'item' : 'items'}
                      {order.payment_method === 'cod' ? ' · COD' : ''}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${
                      STATUS_STYLES[order.order_status] ?? 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {order.order_status}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                  <span className="truncate text-xs text-gray-500">
                    {order.items.map((i) => i.name).join(', ')}
                  </span>
                  <span className="shrink-0 text-sm font-bold text-gray-900">
                    {formatPrice(order.total_amount)}
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
