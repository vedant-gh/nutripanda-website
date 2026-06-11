import Link from 'next/link'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import ProductCard from '@/components/products/ProductCard'
import { getAllProducts, getComingSoonProducts } from '@/lib/supabase/queries'
import type { Product } from '@/types/supabase'

const PRODUCT_TINT: Record<string, string> = {
  orange: 'from-orange-50 to-orange-100/40',
  green: 'from-green-50 to-green-100/40',
  purple: 'from-purple-50 to-purple-100/40',
  yellow: 'from-yellow-50 to-yellow-100/40',
  pink: 'from-pink-50 to-pink-100/40',
  blue: 'from-blue-50 to-blue-100/40',
}

const PRODUCT_DOT: Record<string, string> = {
  orange: 'bg-product-orange',
  green: 'bg-product-green',
  purple: 'bg-product-purple',
  yellow: 'bg-product-yellow',
  pink: 'bg-product-pink',
  blue: 'bg-product-blue',
}

function ComingSoonCard({ product }: { product: Product }) {
  const tint = PRODUCT_TINT[product.color_theme ?? ''] ?? 'from-gray-50 to-gray-100/40'
  const dot = PRODUCT_DOT[product.color_theme ?? ''] ?? 'bg-brand-green'

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-[#f3f3f3] pb-5">
      <div
        className={`relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden bg-gradient-to-br ${tint}`}
      >
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-full ${dot} text-white shadow-sm`}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </span>
          <span className="rounded-full bg-gray-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
            Coming Soon
          </span>
        </div>
      </div>
      <div className="mt-3 px-4 sm:mt-4 sm:px-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 sm:text-sm">
          {product.name}
        </h3>
        {product.short_description && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-500 sm:text-xs">
            {product.short_description}
          </p>
        )}
      </div>
    </div>
  )
}

const TRUST_POINTS = [
  { label: 'Free shipping on prepaid orders' },
  { label: '30-day satisfaction guarantee' },
  { label: 'Made in India · FSSAI Compliant' },
]

export default async function ProductsPage() {
  const [products, comingSoon] = await Promise.all([
    getAllProducts(),
    getComingSoonProducts(),
  ])

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* Hero band */}
      <section className="bg-[#f7fdf6]">
        <div className="mx-auto max-w-7xl px-4 pt-10 pb-12 sm:px-6 sm:pt-14 sm:pb-16 lg:px-8">
          <nav className="mb-6 text-xs text-gray-400 sm:text-sm">
            <Link href="/" className="transition-colors hover:text-gray-600">
              Home
            </Link>
            <span className="mx-2">/</span>
            <span className="text-gray-700">Products</span>
          </nav>

          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#DCFDCC] px-4 py-1.5">
            <span className="text-xs font-semibold tracking-wide text-gray-800">
              Shop the range
            </span>
          </div>

          <h1 className="font-heading text-4xl font-bold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            Pick your daily
            <br />
            <span className="text-[#12BC00]">good-for-you.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-gray-500 sm:text-lg">
            Real ingredients, real doses, real flavour. Every NutriPanda gummy is made
            in India with no added sugar, no gelatin, and no compromises.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2">
            {TRUST_POINTS.map((p) => (
              <div key={p.label} className="flex items-center gap-2">
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
                <span className="text-sm font-medium text-gray-600">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <div className="mb-10 flex items-end justify-between sm:mb-14">
          <div>
            <h2 className="font-heading text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              In stock now
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {products.length} {products.length === 1 ? 'gummy' : 'gummies'} ready to ship
            </p>
          </div>
        </div>

        {products.length > 0 ? (
          <div className="grid grid-cols-2 gap-5 sm:gap-7 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-[#fafafa] py-16 text-center">
            <p className="text-sm text-gray-500">We are restocking. Check back soon.</p>
          </div>
        )}

        {comingSoon.length > 0 && (
          <section className="mt-20 sm:mt-24">
            <div className="mb-10 sm:mb-14">
              <h2 className="font-heading text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
                On the way
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Six more flavours dropping soon. Be the first to know.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-5 sm:gap-7 lg:grid-cols-3">
              {comingSoon.map((product) => (
                <ComingSoonCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  )
}
