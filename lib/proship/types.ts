// Types for the Proship (Prozo) shipping integration.
//
// Request/response object fields use Proship's own snake_case contract exactly as
// the live API expects them — do not camelCase them. Enum values below were
// confirmed against the live API (e.g. shipment_type only accepts B2C | B2B).

export type ProshipShipmentType = 'B2C' | 'B2B'
export type ProshipOrderType = 'FORWARD' | 'REVERSE'
export type ProshipPaymentMode = 'COD' | 'PREPAID'

/** Standard Proship response envelope used by the *Ext / tools endpoints. */
export interface ProshipEnvelope<T> {
  meta: {
    status: number
    message: string
    success: boolean
    ayncResponse?: boolean // [sic] — the API misspells "async"
  }
  result: T
}

// ── Serviceability ──────────────────────────────────────────────────────────

/** One row of the POST /api/tools/serviceabilityExtN request body array. */
export interface ServiceabilityQuery {
  pickup_pincode: number
  drop_pincode: number
  optional?: {
    weight?: number // grams
    length?: number // cm
    breadth?: number // cm
    height?: number // cm
    invoice_value?: number // rupees
    order_type?: ProshipOrderType
    shipment_type?: ProshipShipmentType
    service_type?: string
    cp_id?: number
  }
}

/** One courier option returned by serviceability. */
export interface ServiceabilityOption {
  service_type: string | null
  parentName: string | null
  cp_id: number | null
  shipping_charge: number | null
  comitted_sla: string | null // [sic] — the API misspells "committed"
  zone: string | null
  serviceable: {
    COD: boolean
    PREPAID: boolean
    EXCHANGE: boolean
    PICKUP: boolean
  }
  service_type_primary: string | null
  service_type_secondary: string | null
  remarks: string | null
  dispatch_mode: string | null
}

// ── Create forward shipment ─────────────────────────────────────────────────

export interface ShipmentItem {
  item_name: string
  sku_id: string
  units: number
  selling_price: number // rupees per unit
  tax?: number // GST rate %, e.g. 5
  hsn?: string // HSN classification code
  item_url?: string // product URL, or "NA"
  item_description?: string
}

export interface ShipmentDimensions {
  item_length: number // cm
  item_breadth: number // cm
  item_height: number // cm
  item_weight: number // GRAMS (the live create API expects grams here, not kg)
}

export interface DeliveryDetails {
  to_name: string
  to_phone_number: string
  to_pincode: string
  to_address: string
  to_addressline?: string
  to_city?: string
  to_state?: string
  to_country?: string
  to_email?: string
}

export interface PickupDetails {
  from_name: string
  from_phone_number: string
  from_pincode: string
  from_address: string
  from_addressline?: string
  from_city?: string
  from_state?: string
  from_country?: string
  from_email?: string
  gstin?: string
}

/** Optional billing-customer block Proship echoes back on the order. */
export interface CustomerDetail {
  to_email?: string
  to_address?: string
  to_city?: string
  to_state?: string
  to_country?: string
}

/**
 * Payload for POST /api/order/create (forward B2C).
 *
 * Field names + shape validated against a real live booking (AWB returned) —
 * mirrors the "Create Forward Order" example in the Proship B2C Postman
 * collection. Notable quirks the live API requires:
 *  - order_type is the literal string "Forward Shipment" (NOT "FORWARD").
 *  - `reverse` / `is_reverse` booleans are required.
 *  - `client_order_id` and `channel_name` are required.
 *  - item_weight in shipment_detail is in GRAMS.
 *  - Provide full `pickup_details` (proven) — `warehouse_name` is a fallback.
 */
export interface CreateForwardShipmentPayload {
  reverse: boolean
  is_reverse: boolean
  order_type: 'Forward Shipment'
  payment_mode: ProshipPaymentMode
  reference: string
  client_order_id: string
  invoice_number?: string
  invoice_value: number // rupees
  cod_amount: number // rupees (0 for prepaid)
  transaction_charge?: number
  giftwrap_charge?: number
  channel_name?: string
  item_list: ShipmentItem[]
  shipment_detail: ShipmentDimensions[]
  delivery_details: DeliveryDetails
  customer_detail?: CustomerDetail
  /** Provide EITHER pickup_details (proven) OR warehouse_name (a registered Proship location). */
  pickup_details?: PickupDetails
  warehouse_name?: string
}

/** What POST /api/order/create returns in its `result` on success. */
export interface ProshipCreateResult {
  orderId: string
  reference: string
  awb_number: string
  label_url?: string
  invoice_url?: string
  courier_id?: number
  orderStatus?: string
  shipment_type?: string
}

// ── Order fetch (external view) ─────────────────────────────────────────────

/** Subset of GET /api/order/getOrderExt response items relevant to NutriPanda. */
export interface ProshipShipment {
  orderId: string
  reference: string
  clientOrderId: string
  awbNumber: string
  awbRegisteredDate: string
  currentStatus: string
  courierParentName: string
  labelUrl: string
  invoiceUrl: string
  invoiceNumber: string
  invoiceValue: number
  codAmount: number
  paymentMode: string
  orderDate: string
  orderType: string
  shipmentType: string
  merchantName: string
  merchantZone: string
  deliveryDetails: {
    to_name: string
    to_phone_number: string
    to_pincode: string
    to_address: string
    to_city?: string
    to_state?: string
    to_country?: string
    to_email?: string
  }
  orderHistory: Array<{
    orderStatusEnum: string
    orderStatusDescription: string
    currentLocation: string
    courierPartnerName: string
    remark: string
    timestamp: string
    waybill: string
  }>
}

// ── Manifest ────────────────────────────────────────────────────────────────

export interface GenerateManifestRequest {
  awb_numbers: string[]
  courierId?: string
  merchantId?: string
  pickupLocation?: string
  pickupPincode?: string
}
