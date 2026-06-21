import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import ProductHero from '@/components/product-detail/ProductHero'
import TrackProductView from '@/components/product-detail/TrackProductView'
import { getProductBySlug, getAllProducts } from '@/lib/supabase/queries'
import { formatPrice } from '@/lib/utils/format'
import type { Product, Ingredient } from '@/types/supabase'

// Always render from the live database so product/status changes show immediately.
export const dynamic = 'force-dynamic'

// ── Color maps ──

const BG_MAP: Record<string, string> = {
  orange: 'bg-product-orange',
  green: 'bg-product-green',
  purple: 'bg-product-purple',
  yellow: 'bg-product-yellow',
  pink: 'bg-product-pink',
  blue: 'bg-product-blue',
}

const TEXT_MAP: Record<string, string> = {
  orange: 'text-product-orange',
  green: 'text-product-green',
  purple: 'text-product-purple',
  yellow: 'text-product-yellow',
  pink: 'text-product-pink',
  blue: 'text-product-blue',
}

// ── Trust badge icons (inline SVG) ──

const BADGE_ICONS: Record<string, { label: string; icon: React.ReactNode }> = {
  FSSAI: {
    label: 'FSSAI Certified',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  NoSugar: {
    label: 'No Added Sugar',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </svg>
    ),
  },
  TransFatFree: {
    label: 'Trans Fat Free',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  AntioxidantRich: {
    label: 'Antioxidant Rich',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  Vegetarian: {
    label: '100% Vegan',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 8c.7-1 1-2.2 1-3.5C18 2 16 0 16 0s-2 2-2 4.5c0 1.3.3 2.5 1 3.5" />
        <path d="M12 19c-4.4 0-8-1.8-8-4V9c0 2.2 3.6 4 8 4s8-1.8 8-4v6c0 2.2-3.6 4-8 4z" />
        <path d="M12 13c4.4 0 8-1.8 8-4s-3.6-4-8-4-8 1.8-8 4 3.6 4 8 4z" />
      </svg>
    ),
  },
}

// ── SEO Metadata ──

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) return { title: 'Product Not Found' }

  return {
    title: product.seo_title ?? `${product.name} | NutriPanda`,
    description: product.seo_description ?? product.short_description ?? product.description ?? undefined,
    openGraph: {
      title: product.seo_title ?? product.name,
      description: product.seo_description ?? product.short_description ?? undefined,
      images: product.images?.[0] ? [{ url: product.images[0] }] : undefined,
    },
  }
}

// ── Sub-sections ──

function IngredientsSection({
  ingredients,
  colorTheme,
}: {
  ingredients: Ingredient[]
  colorTheme: string | null
}) {
  const textColor = TEXT_MAP[colorTheme ?? ''] ?? 'text-brand-green'

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {ingredients.map((ing, i) => (
        <div
          key={i}
          className="rounded-2xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md"
        >
          <div className="flex items-baseline gap-2">
            <h4 className="text-base font-bold text-gray-900">{ing.name}</h4>
            {ing.amount && (
              <span className={`text-sm font-semibold ${textColor}`}>
                {ing.amount}
                {ing.unit}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">{ing.description}</p>
        </div>
      ))}
    </div>
  )
}

function TrustBadgesRow({
  badges,
  colorTheme,
}: {
  badges: string[]
  colorTheme: string | null
}) {
  const textColor = TEXT_MAP[colorTheme ?? ''] ?? 'text-brand-green'

  return (
    <div className="flex flex-wrap justify-center gap-6 sm:gap-8">
      {badges.map((badge) => {
        const config = BADGE_ICONS[badge]
        if (!config) return null
        return (
          <div key={badge} className="flex flex-col items-center gap-2">
            <div className={`${textColor}`}>{config.icon}</div>
            <span className="text-xs font-medium text-gray-600 text-center">
              {config.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function RelatedProductCard({ product }: { product: Product }) {
  const url = product.images?.[0]
  const hasImage = !!url && !url.includes('placehold.co')
  const dot = BG_MAP[product.color_theme ?? ''] ?? 'bg-brand-green'

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-[#f3f3f3] pb-5 transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-white">
        {hasImage ? (
          <Image
            src={url!}
            alt={product.name}
            fill
            className="object-contain p-3 transition-transform duration-500 ease-out group-hover:scale-[1.05] sm:p-4"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className={`flex h-10 w-10 items-center justify-center rounded-full ${dot} text-white`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </span>
          </div>
        )}
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
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-gray-900 sm:text-base">
            {formatPrice(product.price)}
          </span>
          {product.compare_at_price && (
            <span className="text-xs text-gray-400 line-through">
              {formatPrice(product.compare_at_price)}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── JSON-LD Structured Data ──

function ProductJsonLd({ product }: { product: Product }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.short_description ?? product.description ?? '',
    image: product.images?.[0] ?? undefined,
    brand: {
      '@type': 'Brand',
      name: 'NutriPanda',
    },
    offers: {
      '@type': 'Offer',
      price: (product.price / 100).toFixed(2),
      priceCurrency: 'INR',
      availability: product.is_coming_soon
        ? 'https://schema.org/PreOrder'
        : product.inventory_count > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      seller: {
        '@type': 'Organization',
        name: 'NutriPanda',
      },
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

// ── Main Page ──

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) notFound()

  const allProducts = await getAllProducts()
  const relatedProducts = allProducts.filter((p) => p.id !== product.id)

  return (
    <div className="min-h-screen bg-white">
      <ProductJsonLd product={product} />
      <TrackProductView
        productId={product.id}
        productName={product.name}
        price={product.price}
        colorTheme={product.color_theme}
        slug={product.slug}
      />
      <Navbar />

      {/* Breadcrumbs */}
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <nav className="text-xs text-gray-400 sm:text-sm">
          <Link href="/" className="hover:text-gray-600 transition-colors">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/products" className="hover:text-gray-600 transition-colors">Products</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-700">{product.name}</span>
        </nav>
      </div>

      {/* Hero: image + info + add to cart */}
      <ProductHero product={product} />

      {/* Ingredients */}
      {product.ingredients && product.ingredients.length > 0 && (
        <section className="bg-gray-50 py-12 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="font-heading mb-8 text-3xl font-bold text-gray-900 sm:text-4xl">
              Key Ingredients
            </h2>
            <IngredientsSection
              ingredients={product.ingredients}
              colorTheme={product.color_theme}
            />
          </div>
        </section>
      )}

      {/* Trust Badges */}
      {product.trust_badges && product.trust_badges.length > 0 && (
        <section className="bg-white py-12 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="font-heading mb-8 text-center text-3xl font-bold text-gray-900 sm:text-4xl">
              Quality You Can Trust
            </h2>
            <TrustBadgesRow
              badges={product.trust_badges}
              colorTheme={product.color_theme}
            />
          </div>
        </section>
      )}

      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <section className="bg-gray-50 py-12 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="font-heading mb-8 text-3xl font-bold text-gray-900 sm:text-4xl">
              More from NutriPanda
            </h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {relatedProducts.slice(0, 3).map((p) => (
                <RelatedProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </div>
  )
}
