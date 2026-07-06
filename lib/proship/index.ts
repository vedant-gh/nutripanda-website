// High-level Proship (Prozo) shipping API for NutriPanda.
//
// Endpoints used (all validated against the live prod API unless noted):
//   checkServiceability   POST /api/tools/serviceabilityExtN   ✓ live-tested
//   createForwardShipment POST /api/order/create               (schema-derived — verify with a test order)
//   getShipment           GET  /api/order/getOrderExt          ✓ schema-confirmed
//   cancelShipment        POST /api/order/cancel_order         ✓ schema-confirmed
//   generateManifest      POST /api/order/generate_manifest    ✓ schema-confirmed
//
// Money in NutriPanda is stored in paise; Proship expects rupees — the mapper
// converts. Weight/dimensions are not tracked per product in NutriPanda, so the
// mapper applies configurable defaults (a gummies bottle ≈ 150g).

import { proshipFetch, getProshipMerchantId } from './client'
import type { Order } from '@/types/supabase'
import type {
  CreateForwardShipmentPayload,
  DeliveryDetails,
  GenerateManifestRequest,
  PickupDetails,
  ProshipCreateResult,
  ProshipEnvelope,
  ProshipPaymentMode,
  ProshipShipment,
  ServiceabilityOption,
  ServiceabilityQuery,
} from './types'

export { ProshipError } from './client'
export type * from './types'

// ── Serviceability ──────────────────────────────────────────────────────────

/** Raw serviceability check — returns every courier option for each query row. */
export async function checkServiceability(
  queries: ServiceabilityQuery[]
): Promise<ServiceabilityOption[]> {
  const merchantId = getProshipMerchantId()
  const res = await proshipFetch<ProshipEnvelope<ServiceabilityOption[]>>(
    `/api/tools/serviceabilityExtN?merchantId=${encodeURIComponent(merchantId)}`,
    { method: 'POST', body: JSON.stringify(queries) }
  )
  return res.result ?? []
}

/**
 * Convenience wrapper for the common checkout question: "can we deliver to this
 * pincode for this payment mode?" Returns the boolean plus the courier options
 * that support it.
 */
export async function isPincodeServiceable(input: {
  pickupPincode: number
  dropPincode: number
  paymentMode: ProshipPaymentMode
  weightGrams?: number
  invoiceValue?: number
  dimensionsCm?: { length: number; breadth: number; height: number }
}): Promise<{ serviceable: boolean; options: ServiceabilityOption[] }> {
  const options = await checkServiceability([
    {
      pickup_pincode: input.pickupPincode,
      drop_pincode: input.dropPincode,
      optional: {
        order_type: 'FORWARD',
        shipment_type: 'B2C',
        weight: input.weightGrams ?? 500,
        invoice_value: input.invoiceValue,
        length: input.dimensionsCm?.length,
        breadth: input.dimensionsCm?.breadth,
        height: input.dimensionsCm?.height,
      },
    },
  ])
  const serviceable = options.some((o) => o.serviceable?.[input.paymentMode])
  return { serviceable, options }
}

// ── Create / fetch / cancel ─────────────────────────────────────────────────

/**
 * Create a forward shipment. Proship books an AWB in real time and returns it
 * (plus the label URL) directly in the response `result` — no separate readback
 * needed. Validated against a live booking.
 */
export async function createForwardShipment(
  payload: CreateForwardShipmentPayload
): Promise<ProshipCreateResult> {
  const res = await proshipFetch<ProshipEnvelope<ProshipCreateResult>>('/api/order/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return res.result
}

/** Fetch shipment(s) by our reference (order number), Proship orderId, or AWB(s). */
export async function getShipment(query: {
  reference?: string
  orderId?: string
  waybills?: string
}): Promise<ProshipShipment[]> {
  const qs = new URLSearchParams()
  if (query.reference) qs.set('reference', query.reference)
  if (query.orderId) qs.set('orderId', query.orderId)
  if (query.waybills) qs.set('waybills', query.waybills)
  return proshipFetch<ProshipShipment[]>(`/api/order/getOrderExt?${qs.toString()}`, {
    method: 'GET',
  })
}

/** Cancel a shipment by AWB / waybill number. */
export async function cancelShipment(waybill: string): Promise<unknown> {
  return proshipFetch('/api/order/cancel_order', {
    method: 'POST',
    body: JSON.stringify({ waybill }),
  })
}

/** Generate a manifest for one or more AWBs (hands the parcels over to the courier). */
export async function generateManifest(
  awbNumbers: string[],
  extra?: Omit<GenerateManifestRequest, 'awb_numbers' | 'merchantId'>
): Promise<unknown> {
  const req: GenerateManifestRequest = {
    awb_numbers: awbNumbers,
    merchantId: getProshipMerchantId(),
    ...extra,
  }
  return proshipFetch('/api/order/generate_manifest', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

// ── Mapper: NutriPanda Order → Proship payload ──────────────────────────────

const paiseToRupees = (paise: number) => Math.round(paise) / 100

/** Build the registered pickup warehouse (Bhan Nagar) from env vars. */
function pickupFromEnv(): PickupDetails | undefined {
  const from_name = process.env.PROSHIP_PICKUP_NAME
  const from_phone_number = process.env.PROSHIP_PICKUP_PHONE
  const from_address = process.env.PROSHIP_PICKUP_ADDRESS
  const from_pincode = process.env.PROSHIP_PICKUP_PINCODE
  if (!from_name || !from_phone_number || !from_address || !from_pincode) return undefined
  return {
    from_name,
    from_phone_number,
    from_address,
    from_addressline: from_address,
    from_pincode,
    from_city: process.env.PROSHIP_PICKUP_CITY,
    from_state: process.env.PROSHIP_PICKUP_STATE,
    from_country: 'IN',
    from_email: process.env.PROSHIP_PICKUP_EMAIL,
    gstin: process.env.PROSHIP_PICKUP_GSTIN,
  }
}

/**
 * Build a Proship forward-shipment payload from a NutriPanda order.
 *
 * Assumptions (override via `opts` when better data exists):
 *  - `invoice_value` = order total (what the customer paid, in rupees).
 *  - `cod_amount`    = order total for COD, 0 for prepaid.
 *  - parcel weight   = `perItemWeightGrams` (default 150g) × total units, in GRAMS.
 *  - parcel dimensions default to a small gummies carton (15×12×8 cm).
 *  - item tax/hsn default to 5% GST / PROSHIP_DEFAULT_HSN (gummies food supplement).
 *  - pickup comes from `opts.pickup`, else the PROSHIP_PICKUP_* env vars, else a
 *    bare `warehouse_name` (PROSHIP_PICKUP_WAREHOUSE) as a last resort.
 */
export function orderToForwardShipment(
  order: Order,
  opts?: {
    pickup?: PickupDetails
    warehouseName?: string
    perItemWeightGrams?: number
    parcelDimensionsCm?: { length: number; breadth: number; height: number }
  }
): CreateForwardShipmentPayload {
  const isCod = order.payment_method === 'cod'
  const addr = order.shipping_address
  const fullAddress = [addr.line1, addr.line2].filter(Boolean).join(', ')
  const addressLine = [fullAddress, addr.city, addr.state].filter(Boolean).join(', ')

  const totalUnits = order.items.reduce((n, item) => n + item.quantity, 0)
  const perItemWeightGrams = opts?.perItemWeightGrams ?? 150
  const dims = opts?.parcelDimensionsCm ?? { length: 15, breadth: 12, height: 8 }
  const pickup = opts?.pickup ?? pickupFromEnv()
  const warehouseName = opts?.warehouseName ?? process.env.PROSHIP_PICKUP_WAREHOUSE
  const hsn = process.env.PROSHIP_DEFAULT_HSN || '21069099'

  const delivery_details: DeliveryDetails = {
    to_name: order.customer_name,
    to_phone_number: order.customer_phone,
    to_pincode: addr.pincode,
    to_address: fullAddress,
    to_addressline: addressLine,
    to_city: addr.city,
    to_state: addr.state,
    to_country: 'IN',
    to_email: order.customer_email,
  }

  return {
    reverse: false,
    is_reverse: false,
    order_type: 'Forward Shipment',
    payment_mode: isCod ? 'COD' : 'PREPAID',
    reference: order.order_number,
    client_order_id: order.order_number,
    invoice_number: order.order_number,
    invoice_value: paiseToRupees(order.total_amount),
    cod_amount: isCod ? paiseToRupees(order.total_amount) : 0,
    transaction_charge: 0,
    giftwrap_charge: 0,
    channel_name: process.env.PROSHIP_CHANNEL_NAME || 'WMS',
    item_list: order.items.map((item) => ({
      item_name: item.name,
      sku_id: item.slug || item.productId,
      units: item.quantity,
      selling_price: paiseToRupees(item.price),
      tax: 5,
      hsn,
      item_url: 'NA',
    })),
    shipment_detail: [
      {
        item_length: dims.length,
        item_breadth: dims.breadth,
        item_height: dims.height,
        item_weight: perItemWeightGrams * totalUnits, // grams
      },
    ],
    delivery_details,
    customer_detail: {
      to_email: order.customer_email,
      to_address: addressLine,
      to_city: addr.city,
      to_state: addr.state,
      to_country: 'IN',
    },
    // Prefer full pickup_details (proven against the live API); fall back to a
    // bare warehouse_name only if the PROSHIP_PICKUP_* vars aren't set.
    ...(pickup ? { pickup_details: pickup } : warehouseName ? { warehouse_name: warehouseName } : {}),
  }
}
