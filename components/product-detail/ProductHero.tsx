'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useCartStore } from '@/lib/cart/store'
import { formatPrice } from '@/lib/utils/format'
import type { Product } from '@/types/supabase'
import toast from 'react-hot-toast'
import { Minus, Plus } from 'lucide-react'

const TINT_MAP: Record<string, string> = {
  orange: 'from-orange-50 via-white to-orange-50/40',
  green: 'from-green-50 via-white to-green-50/40',
  purple: 'from-purple-50 via-white to-purple-50/40',
  yellow: 'from-yellow-50 via-white to-yellow-50/40',
  pink: 'from-pink-50 via-white to-pink-50/40',
  blue: 'from-blue-50 via-white to-blue-50/40',
}

const ACCENT_BG: Record<string, string> = {
  orange: 'bg-product-orange',
  green: 'bg-product-green',
  purple: 'bg-product-purple',
  yellow: 'bg-product-yellow',
  pink: 'bg-product-pink',
  blue: 'bg-product-blue',
}

function CheckIcon() {
  return (
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
  )
}

export default function ProductHero({ product }: { product: Product }) {
  const images = product.images?.length ? product.images : []
  const [selectedImage, setSelectedImage] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const { addItem, openCart } = useCartStore()

  const isComingSoon = product.is_coming_soon
  const outOfStock = product.inventory_count <= 0
  const tint = TINT_MAP[product.color_theme ?? ''] ?? 'from-gray-50 via-white to-gray-50/40'
  const accentBg = ACCENT_BG[product.color_theme ?? ''] ?? 'bg-brand-green'
  const url = images[selectedImage]
  const hasImage = !!url && !url.includes('placehold.co')

  const hasDiscount =
    product.compare_at_price && product.compare_at_price > product.price

  function handleAddToCart() {
    if (outOfStock) return
    addItem(product, quantity)
    openCart()
    toast.success(`${product.name} added to cart`)
  }

  return (
    <section className={`bg-gradient-to-br ${tint}`}>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Image gallery */}
          <div>
            <div className="relative aspect-square overflow-hidden rounded-2xl border border-gray-200 bg-white">
              {hasImage ? (
                <Image
                  src={url!}
                  alt={product.name}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  priority
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className={`flex h-16 w-16 items-center justify-center rounded-full ${accentBg} text-white shadow-sm`}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </span>
                </div>
              )}
              <div className="absolute left-4 top-4 flex flex-col items-start gap-1.5">
                {isComingSoon && (
                  <span className={`rounded-full ${accentBg} px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white`}>
                    Coming Soon
                  </span>
                )}
                {!isComingSoon && hasDiscount && (
                  <span className="rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold tracking-wide text-white">
                    {Math.round(
                      ((product.compare_at_price! - product.price) /
                        product.compare_at_price!) *
                        100,
                    )}
                    % OFF
                  </span>
                )}
                {!isComingSoon && outOfStock && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold tracking-wide text-gray-900 ring-1 ring-gray-200">
                    Out of stock
                  </span>
                )}
              </div>
            </div>
            {images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {images.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedImage(i)}
                    className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                      i === selectedImage ? 'border-gray-900' : 'border-transparent'
                    }`}
                  >
                    <Image
                      src={img}
                      alt={`${product.name} ${i + 1}`}
                      fill
                      className="object-cover"
                      sizes="64px"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product info */}
          <div className="flex flex-col justify-center">
            {/* Tags */}
            <div className="mb-4 flex w-max items-center gap-2">
              {isComingSoon && (
                <span className={`inline-flex items-center rounded-full ${accentBg} px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white`}>
                  Coming Soon
                </span>
              )}
              <span className="inline-flex items-center rounded-full bg-[#DCFDCC] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-800">
                Made in India
              </span>
            </div>

            <h1 className="font-heading text-3xl font-bold leading-[1.1] tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
              {product.name}
            </h1>

            {product.price > 0 && (
              <div className="mt-4 flex items-baseline gap-3">
                <span className="text-2xl font-bold text-gray-900 sm:text-3xl">
                  {formatPrice(product.price)}
                </span>
                {hasDiscount && (
                  <span className="text-base text-gray-400 line-through sm:text-lg">
                    {formatPrice(product.compare_at_price!)}
                  </span>
                )}
                {!isComingSoon && hasDiscount && (
                  <span className="rounded-full bg-[#DCFDCC] px-2.5 py-0.5 text-xs font-semibold text-gray-800">
                    Save {formatPrice(product.compare_at_price! - product.price)}
                  </span>
                )}
              </div>
            )}

            {product.short_description && (
              <p className="mt-5 text-base leading-relaxed text-gray-500 sm:text-lg">
                {product.short_description}
              </p>
            )}

            {product.description && (
              <p className="mt-3 text-sm leading-relaxed text-gray-500">
                {product.description}
              </p>
            )}

            {/* Bullet trust points */}
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
              {['Sugar-Free', '100% Vegan', 'FSSAI Compliant'].map((point) => (
                <div key={point} className="flex items-center gap-2">
                  <CheckIcon />
                  <span className="text-sm font-medium text-gray-600">{point}</span>
                </div>
              ))}
            </div>

            {/* Coming soon — no purchase yet */}
            {isComingSoon ? (
              <div className="mt-8 border-t border-gray-200 pt-6">
                <button
                  type="button"
                  disabled
                  className="w-full cursor-not-allowed rounded-full bg-gray-900 px-8 py-3.5 text-sm font-semibold text-white opacity-90 sm:text-base"
                >
                  Coming Soon
                </button>
                <p className="mt-3 text-sm text-gray-500">
                  This flavour is launching soon — check back shortly to order it here.
                </p>
              </div>
            ) : (
            /* Quantity selector + Add to Cart */
            <div className="mt-8 border-t border-gray-200 pt-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={outOfStock || quantity <= 1}
                    className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Decrease quantity"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="w-10 text-center text-base font-semibold text-gray-900">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setQuantity((q) => Math.min(q + 1, product.inventory_count))
                    }
                    disabled={outOfStock || quantity >= product.inventory_count}
                    className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Increase quantity"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={outOfStock}
                  className="flex-1 rounded-full bg-[#12BC00] px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#0fa600] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed sm:text-base"
                >
                  {outOfStock ? 'Out of Stock' : 'Add to Cart'}
                </button>
              </div>

              {!outOfStock && product.inventory_count <= 10 && (
                <p className="mt-3 text-sm font-medium text-orange-600">
                  Only {product.inventory_count} left in stock
                </p>
              )}
            </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
