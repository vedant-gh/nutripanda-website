import 'server-only'

import type { Order, OrderItem } from '@/types/supabase'
import { validatePincode } from '@/lib/utils/validators'
import { isPincodeServiceable } from './index'
import { parcelProfileForItems } from './package'
import type { ProshipPaymentMode, ServiceabilityOption } from './types'

export class ServiceabilityError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ServiceabilityError'
    this.status = status
  }
}
export interface ServiceabilityInput {
  pincode: string
  paymentMethod: Order['payment_method']
  items: Pick<OrderItem, 'quantity'>[]
  totalAmountPaise: number
}

export interface ServiceabilityResult {
  serviceable: boolean
  mode: ProshipPaymentMode
  options: ServiceabilityOption[]
}

/**
 * Authoritative server helper for COD and prepaid order creation.
 * Call this only after items, quantities, and total have been rebuilt from the DB.
 */
export async function checkCheckoutServiceability(
  input: ServiceabilityInput
): Promise<ServiceabilityResult> {
  if (!validatePincode(input.pincode)) {
    throw new ServiceabilityError('Enter a valid 6-digit delivery pincode')
  }
  if (!Number.isSafeInteger(input.totalAmountPaise) || input.totalAmountPaise <= 0) {
    throw new ServiceabilityError('Order total is invalid')
  }

  const pickupPincode = process.env.PROSHIP_PICKUP_PINCODE
  if (!pickupPincode || !validatePincode(pickupPincode)) {
    throw new ServiceabilityError('Delivery serviceability is temporarily unavailable', 503)
  }

  const parcel = parcelProfileForItems(input.items)
  const mode: ProshipPaymentMode = input.paymentMethod === 'cod' ? 'COD' : 'PREPAID'
  const result = await isPincodeServiceable({
    pickupPincode: Number(pickupPincode),
    dropPincode: Number(input.pincode),
    paymentMode: mode,
    weightGrams: parcel.weightGrams,
    invoiceValue: input.totalAmountPaise / 100,
    dimensionsCm: parcel.dimensionsCm,
  })

  return { ...result, mode }
}

export async function assertCheckoutServiceable(
  input: ServiceabilityInput
): Promise<ServiceabilityResult> {
  const result = await checkCheckoutServiceability(input)
  if (!result.serviceable) {
    throw new ServiceabilityError(
      `Delivery is not available to this pincode for ${result.mode === 'COD' ? 'cash on delivery' : 'prepaid orders'}`,
      422
    )
  }
  return result
}

export function assertOrderServiceable(order: Order): Promise<ServiceabilityResult> {
  return assertCheckoutServiceable({
    pincode: order.shipping_address.pincode,
    paymentMethod: order.payment_method,
    items: order.items,
    totalAmountPaise: order.total_amount,
  })
}
