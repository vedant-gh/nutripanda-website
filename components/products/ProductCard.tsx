'use client'

import Image from 'next/image'
import Link from 'next/link'
import AddToCartButton from '@/components/AddToCartButton'
import { formatPrice } from '@/lib/utils/format'
import type { Product } from '@/types/supabase'

const PRODUCT_DOT: Record<string, string> = {
  orange: 'bg-product-orange',
  green: 'bg-product-green',
  purple: 'bg-product-purple',
  yellow: 'bg-product-yellow',
  pink: 'bg-product-pink',
  blue: 'bg-product-blue',
}

function hasUsableImage(product: Product) {
  const url = product.images?.[0]
  return !!url && !url.includes('placehold.co')
}

export default function ProductCard({ product }: { product: Product }) {
  const image = product.images?.[0]
  const hasImage = hasUsableImage(product)
  const hasDiscount =
    product.compare_at_price && product.compare_at_price > product.price
  const dot = PRODUCT_DOT[product.color_theme ?? ''] ?? 'bg-brand-green'
  const outOfStock = product.inventory_count <= 0

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-[#f3f3f3] pb-5 transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-white">
        <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-1.5">
          {hasDiscount && (
            <span className="rounded-full bg-gray-900 px-3 py-1 text-[10px] font-semibold tracking-wide text-white sm:text-xs">
              {Math.round(
                ((product.compare_at_price! - product.price) /
                  product.compare_at_price!) *
                  100,
              )}
              % OFF
            </span>
          )}
          {outOfStock && (
            <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold tracking-wide text-gray-900 ring-1 ring-gray-200 sm:text-xs">
              Sold out
            </span>
          )}
        </div>

        {hasImage ? (
          <Image
            src={image!}
            alt={product.name}
            fill
            className="object-contain p-3 transition-transform duration-500 ease-out group-hover:scale-[1.05] sm:p-4"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${dot} text-white`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </span>
              <span className="text-xs font-medium text-gray-500">Image coming soon</span>
            </div>
          </div>
        )}

        {!outOfStock && (
          <div
            className="absolute bottom-3 right-3 z-10"
            onClick={(e) => e.preventDefault()}
          >
            <AddToCartButton
              product={product}
              ariaLabel={`Add ${product.name} to cart`}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white shadow-md transition-all duration-300 ease-out hover:bg-black active:scale-95 sm:h-11 sm:w-11 sm:translate-y-1 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
            </AddToCartButton>
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
          {hasDiscount && (
            <span className="text-xs text-gray-400 line-through">
              {formatPrice(product.compare_at_price!)}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
