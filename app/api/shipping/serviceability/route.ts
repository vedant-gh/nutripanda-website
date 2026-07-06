import { NextResponse } from 'next/server'
import { isPincodeServiceable } from '@/lib/proship'
import { validatePincode } from '@/lib/utils/validators'

// Public serviceability check for checkout. Given a destination pincode and
// payment mode, asks Proship whether we can deliver there. Pickup pincode is our
// warehouse (PROSHIP_PICKUP_PINCODE env var).
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { pincode, paymentMode } = body as {
      pincode?: string
      paymentMode?: 'COD' | 'PREPAID'
    }

    if (!validatePincode(pincode ?? '')) {
      return NextResponse.json({ error: 'Invalid pincode' }, { status: 400 })
    }

    const pickupPincode = process.env.PROSHIP_PICKUP_PINCODE
    if (!pickupPincode) {
      console.error('Serviceability check: PROSHIP_PICKUP_PINCODE not configured')
      return NextResponse.json({ error: 'Serviceability check unavailable' }, { status: 503 })
    }

    const mode: 'COD' | 'PREPAID' = paymentMode === 'COD' ? 'COD' : 'PREPAID'
    const { serviceable, options } = await isPincodeServiceable({
      pickupPincode: Number(pickupPincode),
      dropPincode: Number(pincode),
      paymentMode: mode,
    })

    return NextResponse.json({
      serviceable,
      couriers: options
        .filter((o) => o.serviceable?.[mode])
        .map((o) => ({
          name: o.parentName,
          serviceType: o.service_type,
          sla: o.comitted_sla,
        })),
    })
  } catch (err) {
    console.error('Serviceability check error:', err)
    return NextResponse.json({ error: 'Serviceability check failed' }, { status: 500 })
  }
}
