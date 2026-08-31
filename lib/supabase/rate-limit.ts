import 'server-only'

import { getSupabaseAdmin } from './admin'

interface RateLimitInput {
  scopeKey: string
  action: string
  limit: number
  windowSeconds: number
}

export async function isRateLimitAllowed(input: RateLimitInput): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc('rate_limit_allowed', {
    p_scope_key: input.scopeKey,
    p_action: input.action,
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  })
  if (error) throw error
  return data === true
}

export async function clearRateLimit(scopeKey: string, action: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc('clear_rate_limit', {
    p_scope_key: scopeKey,
    p_action: action,
  })
  if (error) throw error
}

/** Remove only the successful request's own pre-consumed attempt. */
export async function releaseRateLimitAttempt(scopeKey: string, action: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc('release_rate_limit_attempt', {
    p_scope_key: scopeKey,
    p_action: action,
  })
  if (error) throw error
}
