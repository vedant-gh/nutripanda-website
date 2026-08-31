import 'server-only'

import {
  createOrderAccessTokenWithSecret,
  MINIMUM_ORDER_ACCESS_SECRET_LENGTH,
  verifyOrderAccessTokenWithSecret,
  type VerifiedOrderAccess,
} from './access-token-core'

function getOrderAccessSecret(): string | null {
  const secret = process.env.ORDER_ACCESS_SECRET
  return secret && secret.length >= MINIMUM_ORDER_ACCESS_SECRET_LENGTH ? secret : null
}
export function hasOrderAccessSecret(): boolean {
  return getOrderAccessSecret() !== null
}

/** Create a one-hour bearer token scoped to one order confirmation. */
export function createOrderAccessToken(orderId: string): string {
  const secret = getOrderAccessSecret()
  if (!secret) {
    throw new Error(
      `ORDER_ACCESS_SECRET must be at least ${MINIMUM_ORDER_ACCESS_SECRET_LENGTH} characters`
    )
  }
  return createOrderAccessTokenWithSecret(orderId, secret)
}

export function verifyOrderAccessToken(
  token: string,
  expectedOrderId: string
): VerifiedOrderAccess | null {
  const secret = getOrderAccessSecret()
  if (!secret) return null
  return verifyOrderAccessTokenWithSecret(token, secret, expectedOrderId)
}
