"use client";

import Image from "next/image";
import Link from "next/link";
import AddToCartButton from "@/components/AddToCartButton";
import type { Product } from "@/types/supabase";

function formatPrice(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default function ProductCards({ products }: { products: Product[] }) {
  return (
    <section className="w-full bg-white px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-3xl">
        {/* Section heading */}
        <div className="mb-10 flex items-end justify-between sm:mb-14">
          <h2 className="font-heading text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Best Sellers
          </h2>
          <Link href="/products" className="hidden text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 sm:block">
            View all &rarr;
          </Link>
        </div>

        {/* Product grid */}
        <div className="grid grid-cols-2 gap-5 sm:gap-8">
          {products.map((product) => {
            const image =
              product.images?.[0] ??
              "https://placehold.co/400x400/f5f5f5/999?text=No+Image";
            const hasDiscount =
              product.compare_at_price &&
              product.compare_at_price > product.price;
            const isComingSoon = product.is_coming_soon;

            return (
              <Link
                key={product.id}
                href={`/products/${product.slug}`}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-[#f3f3f3] pb-5"
              >
                {/* Image card */}
                <div className="relative aspect-[4/5] w-full overflow-hidden">
                  {isComingSoon ? (
                    <span className="absolute left-3 top-3 z-10 rounded-full bg-gray-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white sm:text-xs">
                      Coming Soon
                    </span>
                  ) : hasDiscount ? (
                    <span className="absolute left-3 top-3 z-10 rounded-full bg-gray-900 px-3 py-1 text-[10px] font-semibold tracking-wide text-white sm:text-xs">
                      {Math.round(
                        ((product.compare_at_price! - product.price) /
                          product.compare_at_price!) *
                          100,
                      )}
                      % OFF
                    </span>
                  ) : null}
                  <Image
                    src={image}
                    alt={product.name}
                    fill
                    className="object-contain p-3 transition-transform duration-500 ease-out group-hover:scale-[1.05] sm:p-4"
                    sizes="(max-width: 640px) 50vw, 320px"
                  />
                  {/* Quick-add — corner button (fades in on hover, always shown on mobile) */}
                  {!isComingSoon && product.inventory_count > 0 && (
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

                {/* Product info */}
                <div className="mt-3 px-4 sm:mt-4 sm:px-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 sm:text-sm">
                    {product.name}
                  </h3>
                  {isComingSoon ? (
                    <p className="mt-1 text-sm font-medium text-gray-400">
                      Coming Soon
                    </p>
                  ) : (
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-sm font-medium text-gray-900 sm:text-base">
                        {formatPrice(product.price)}
                      </span>
                      {hasDiscount && (
                        <span className="text-xs text-gray-400 line-through">
                          {formatPrice(product.compare_at_price!)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
