import Image from 'next/image'
import type { CartItem } from '@/lib/cart/store'
import { formatPrice } from '@/lib/utils/format'
import { SHIPPING_COST } from '@/lib/utils/constants'

interface OrderSummaryProps {
  items: CartItem[]
  subtotal: number
  discount?: number
  couponCode?: string
  codFee?: number
}

export default function OrderSummary({ items, subtotal, discount = 0, couponCode, codFee = 0 }: OrderSummaryProps) {
  const total = subtotal + SHIPPING_COST + codFee - discount

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 sm:p-6">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>

      <div className="space-y-3 mb-5">
        {items.map((item) => (
          <div key={item.productId} className="flex items-center gap-3">
            <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-white border border-gray-100">
              {item.image ? (
                <Image
                  src={item.image}
                  alt={item.name}
                  fill
                  className="object-contain p-1"
                  sizes="56px"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                  No img
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
              <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
            </div>
            <span className="text-sm font-semibold text-gray-900 flex-shrink-0">
              {formatPrice(item.price * item.quantity)}
            </span>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 pt-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Subtotal</span>
          <span className="font-medium text-gray-900">{formatPrice(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Shipping</span>
          <span className="font-medium text-brand-green">
            {SHIPPING_COST === 0 ? 'Free' : formatPrice(SHIPPING_COST)}
          </span>
        </div>
        {discount > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">
              Discount{couponCode ? ` (${couponCode})` : ''}
            </span>
            <span className="font-medium text-brand-green">
              -{formatPrice(discount)}
            </span>
          </div>
        )}
        {codFee > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">COD fee</span>
            <span className="font-medium text-gray-900">{formatPrice(codFee)}</span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-gray-200 pt-3 mt-3">
          <span className="text-base font-bold text-gray-900">Total</span>
          <span className="text-lg font-bold text-gray-900">{formatPrice(total)}</span>
        </div>
      </div>
    </div>
  )
}
