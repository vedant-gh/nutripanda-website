import { hasOnlyKeys, type JsonObject } from '../utils/request-input.ts'

export const MAX_DASHBOARD_EDITOR_BODY_BYTES = 2 * 1024
export const MIN_DASHBOARD_EDITOR_PASSWORD_LENGTH = 12
export const MAX_DASHBOARD_EDITOR_PASSWORD_LENGTH = 128

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CREATE_KEYS = ['email', 'password'] as const
const PASSWORD_KEYS = ['password'] as const
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export interface DashboardEditorCreateInput {
  email: string
  password: string
}

export interface DashboardEditorPasswordInput {
  password: string
}

export function normalizeDashboardEditorEmail(value: string): string {
  return value.trim().toLowerCase()
}

function parseEmail(value: unknown): Parsed<string> {
  const email = typeof value === 'string' ? normalizeDashboardEditorEmail(value) : ''
  return email.length >= 3 && email.length <= 254 && EMAIL_PATTERN.test(email)
    ? { ok: true, value: email }
    : { ok: false, error: 'Enter a valid email address' }
}

function parsePassword(value: unknown): Parsed<string> {
  if (
    typeof value !== 'string'
    || value.length < MIN_DASHBOARD_EDITOR_PASSWORD_LENGTH
    || value.length > MAX_DASHBOARD_EDITOR_PASSWORD_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return {
      ok: false,
      error: `Password must be ${MIN_DASHBOARD_EDITOR_PASSWORD_LENGTH}-${MAX_DASHBOARD_EDITOR_PASSWORD_LENGTH} characters with no control characters`,
    }
  }

  return { ok: true, value }
}

export function parseDashboardEditorCreateInput(
  body: JsonObject
): Parsed<DashboardEditorCreateInput> {
  if (!hasOnlyKeys(body, CREATE_KEYS)) {
    return { ok: false, error: 'Request contains unsupported editor fields' }
  }

  const email = parseEmail(body.email)
  if (!email.ok) return email
  const password = parsePassword(body.password)
  if (!password.ok) return password
  if (password.value.toLowerCase().includes(email.value)) {
    return { ok: false, error: 'Password must not contain the editor email' }
  }

  return { ok: true, value: { email: email.value, password: password.value } }
}

export function parseDashboardEditorPasswordInput(
  body: JsonObject
): Parsed<DashboardEditorPasswordInput> {
  if (!hasOnlyKeys(body, PASSWORD_KEYS)) {
    return { ok: false, error: 'Only a new password may be changed' }
  }

  const password = parsePassword(body.password)
  return password.ok ? { ok: true, value: { password: password.value } } : password
}

