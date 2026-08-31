import { NextResponse } from 'next/server'
import { ProshipError } from '@/lib/proship/client'
import {
  checkCheckoutServiceability,
  ServiceabilityError,
} from '@/lib/proship/serviceability'
import { consumeCheckoutRateLimit } from '@/lib/supabase/queries'
import { createRateLimitScope, getClientIp } from '@/lib/orders/checkout-validation'
import { hasOnlyKeys, readBoundedJsonObject } from '@/lib/utils/request-input'

const MAX_BODY_BYTES = 4 * 1024
const MAX_TOTAL_PAISE = 10_000_000
const SERVICEABILITY_FIELDS = ['pincode', 'paymentMode', 'items', 'totalAmountPaise'] as const

export async function POST(request: Request) {
  try {
    const input = await readBoundedJsonObject(request, { maxBytes: MAX_BODY_BYTES })
    if (!input.ok) {
      return NextResponse.json({ error: input.error }, { status: input.status })
    }
    const body = input.value
    if (!hasOnlyKeys(body, SERVICEABILITY_FIELDS)) {
      return NextResponse.json({ error: 'Request contains unsupported fields' }, { status: 400 })
    }
    const pincode = typeof body.pincode === 'string' ? body.pincode.trim() : ''
    const paymentMethod = body.paymentMode === 'COD' || body.paymentMode === 'cod'
      ? 'cod'
      : body.paymentMode === 'PREPAID' || body.paymentMode === 'prepaid'
        ? 'prepaid'
        : null
    const items = Array.isArray(body.items) ? body.items : []
    const totalAmountPaise = body.totalAmountPaise

    if (!paymentMethod) {
      return NextResponse.json({ error: 'paymentMode must be COD or PREPAID' }, { status: 400 })
    }
    if (items.length === 0 || items.length > 25) {
      return NextResponse.json({ error: 'Between 1 and 25 order items are required' }, { status: 400 })
    }
    const quantities = items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const quantity = (item as { quantity?: unknown }).quantity
      return Number.isSafeInteger(quantity) && Number(quantity) > 0 && Number(quantity) <= 10
        ? { quantity: Number(quantity) }
        : null
    })
    if (quantities.some((item) => item === null)) {
      return NextResponse.json({ error: 'Item quantities must be integers from 1 to 10' }, { status: 400 })
    }
    if (quantities.reduce((sum, item) => sum + (item?.quantity ?? 0), 0) > 200) {
      return NextResponse.json({ error: 'Order quantity is too large' }, { status: 400 })
    }
    if (
      !Number.isSafeInteger(totalAmountPaise)
      || Number(totalAmountPaise) <= 0
      || Number(totalAmountPaise) > MAX_TOTAL_PAISE
    ) {
      return NextResponse.json({ error: 'Order total is invalid' }, { status: 400 })
    }
    const totalAmount = Number(totalAmountPaise)

    const allowed = await consumeCheckoutRateLimit({
      scope_key: createRateLimitScope('serviceability_ip', getClientIp(request)),
      action: 'shipping_serviceability',
      limit: 30,
      window_seconds: 60 * 60,
    })
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many serviceability checks. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '3600' } }
      )
    }

    const result = await checkCheckoutServiceability({
      pincode,
      paymentMethod,
      items: quantities as { quantity: number }[],
      totalAmountPaise: totalAmount,
    })

    return NextResponse.json(
      {
        serviceable: result.serviceable,
        paymentMode: result.mode,
        couriers: result.options
          .filter((option) => option.serviceable?.[result.mode])
          .map((option) => ({
            name: option.parentName,
            serviceType: option.service_type,
            sla: option.comitted_sla,
          })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    if (error instanceof ServiceabilityError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof ProshipError) {
      console.error('Serviceability provider error', error.toSafeLog())
      return NextResponse.json({ error: 'Delivery serviceability is temporarily unavailable' }, { status: 502 })
    }
    console.error('Serviceability check failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return NextResponse.json({ error: 'Serviceability check failed' }, { status: 500 })
  }
}
