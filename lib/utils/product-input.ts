import type { Product } from '@/types/supabase'

type ProductWrite = Partial<Omit<Product, 'id' | 'created_at' | 'updated_at'>>

export type ProductInputResult =
  | { ok: true; value: ProductWrite }
  | { ok: false; error: string }

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_JSON_BYTES = 100_000
const PRODUCT_FIELDS = new Set([
  'name',
  'slug',
  'description',
  'short_description',
  'price',
  'compare_at_price',
  'images',
  'color_theme',
  'ingredients',
  'nutrition_facts',
  'trust_badges',
  'category',
  'is_active',
  'is_featured',
  'is_coming_soon',
  'inventory_count',
  'seo_title',
  'seo_description',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nullableString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number
): { present: boolean; value?: string | null; error?: string } {
  if (!(key in source)) return { present: false }
  const raw = source[key]
  if (raw === null || raw === '') return { present: true, value: null }
  if (typeof raw !== 'string' || raw.length > maxLength) {
    return { present: true, error: `${key} must be a string of at most ${maxLength} characters` }
  }
  return { present: true, value: raw.trim() || null }
}

function jsonValueWithinLimit(value: unknown): boolean {
  if (value === null) return true
  try {
    return JSON.stringify(value).length <= MAX_JSON_BYTES
  } catch {
    return false
  }
}

export function parseProductInput(
  body: unknown,
  options: { partial: boolean; allowInventory: boolean }
): ProductInputResult {
  if (!isRecord(body)) return { ok: false, error: 'Invalid request body' }
  if (Object.keys(body).some((key) => !PRODUCT_FIELDS.has(key))) {
    return { ok: false, error: 'Request contains unsupported product fields' }
  }

  if (!options.allowInventory && 'inventory_count' in body) {
    return {
      ok: false,
      error: 'Inventory must be changed through the inventory adjustment endpoint',
    }
  }

  const value: ProductWrite = {}

  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 160) {
      return { ok: false, error: 'name must be between 1 and 160 characters' }
    }
    value.name = body.name.trim()
  }

  if ('slug' in body) {
    if (
      typeof body.slug !== 'string'
      || body.slug.length > 160
      || !SLUG_PATTERN.test(body.slug.trim().toLowerCase())
    ) {
      return { ok: false, error: 'slug must contain only lowercase letters, numbers, and hyphens' }
    }
    value.slug = body.slug.trim().toLowerCase()
  }

  for (const [key, maxLength] of [
    ['description', 20_000],
    ['short_description', 1_000],
    ['color_theme', 40],
    ['category', 120],
    ['seo_title', 200],
    ['seo_description', 500],
  ] as const) {
    const parsed = nullableString(body, key, maxLength)
    if (parsed.error) return { ok: false, error: parsed.error }
    if (parsed.present) Object.assign(value, { [key]: parsed.value ?? null })
  }

  for (const key of ['price', 'compare_at_price'] as const) {
    if (!(key in body)) continue
    if (body[key] === null && key === 'compare_at_price') {
      value[key] = null
      continue
    }
    const number = body[key]
    if (!Number.isSafeInteger(number) || Number(number) < 0 || Number(number) > 100_000_000) {
      return { ok: false, error: `${key} must be a non-negative integer amount in paise` }
    }
    value[key] = Number(number)
  }

  if ('inventory_count' in body) {
    if (!Number.isSafeInteger(body.inventory_count) || Number(body.inventory_count) < 0 || Number(body.inventory_count) > 1_000_000) {
      return { ok: false, error: 'inventory_count must be a non-negative integer' }
    }
    value.inventory_count = Number(body.inventory_count)
  }

  for (const key of ['is_active', 'is_featured', 'is_coming_soon'] as const) {
    if (!(key in body)) continue
    if (typeof body[key] !== 'boolean') return { ok: false, error: `${key} must be boolean` }
    value[key] = body[key]
  }

  for (const key of ['images', 'trust_badges'] as const) {
    if (!(key in body)) continue
    const raw = body[key]
    if (raw === null) {
      value[key] = null
      continue
    }
    if (
      !Array.isArray(raw)
      || raw.length > 20
      || raw.some((entry) => typeof entry !== 'string' || entry.length > 2_000)
    ) {
      return { ok: false, error: `${key} must be an array of at most 20 strings` }
    }
    value[key] = raw.map((entry) => entry.trim()).filter(Boolean)
  }

  for (const key of ['ingredients', 'nutrition_facts'] as const) {
    if (!(key in body)) continue
    const raw = body[key]
    if (!jsonValueWithinLimit(raw)) {
      return { ok: false, error: `${key} payload is too large or invalid` }
    }
    if (key === 'ingredients') {
      if (raw !== null && !Array.isArray(raw)) {
        return { ok: false, error: 'ingredients must be an array or null' }
      }
      value.ingredients = raw as Product['ingredients']
    } else {
      if (raw !== null && !isRecord(raw)) {
        return { ok: false, error: 'nutrition_facts must be an object or null' }
      }
      value.nutrition_facts = raw as Product['nutrition_facts']
    }
  }

  if (!options.partial && (!value.name || !value.slug || value.price === undefined)) {
    return { ok: false, error: 'Name, slug, and price are required' }
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, error: 'No editable product fields were provided' }
  }

  return { ok: true, value }
}
