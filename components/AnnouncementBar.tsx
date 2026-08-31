'use client'

import { useState, useSyncExternalStore } from 'react'
import { getActivePublicCoupon } from '@/lib/utils/coupons'

const DISMISS_KEY = 'nutripanda-promo-dismissed'
const PROMO_STORE_EVENT = 'nutripanda-promo-store-change'

function subscribeToPromoStore(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange)
  window.addEventListener(PROMO_STORE_EVENT, onStoreChange)
  return () => {
    window.removeEventListener('storage', onStoreChange)
    window.removeEventListener(PROMO_STORE_EVENT, onStoreChange)
  }
}

export default function AnnouncementBar() {
  const coupon = getActivePublicCoupon()
  const [copied, setCopied] = useState(false)
  const dismissed = useSyncExternalStore(
    subscribeToPromoStore,
    () => Boolean(coupon && localStorage.getItem(`${DISMISS_KEY}:${coupon.code}`)),
    () => false
  )

  if (!coupon || dismissed) return null

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(coupon!.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may be blocked; the code is still readable on screen.
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(`${DISMISS_KEY}:${coupon!.code}`, '1')
      window.dispatchEvent(new Event(PROMO_STORE_EVENT))
    } catch {}
  }

  return (
    <div className="relative bg-[#12BC00] text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-center px-10 py-2 text-center text-xs font-medium sm:text-sm">
        <span className="leading-snug">
          {coupon.label} — use code{' '}
          <button
            type="button"
            onClick={copyCode}
            aria-label={`Copy code ${coupon.code}`}
            className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 align-middle font-bold tracking-wide transition-colors hover:bg-white/30"
          >
            {coupon.code}
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <span aria-live="polite" className="ml-1.5 font-semibold">
            {copied ? 'Copied!' : ''}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss offer"
        className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
