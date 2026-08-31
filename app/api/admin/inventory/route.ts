import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { adjustInventoryAtomic, getInventoryLog } from '@/lib/supabase/queries'
import { hasOnlyKeys, readBoundedJsonObject } from '@/lib/utils/request-input'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHANGE_TYPES = new Set(['restock', 'adjustment', 'return'])
const MAX_BODY_BYTES = 8_192

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// GET — inventory overview (all products with stock) + recent log
export async function GET(request: Request) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const supabase = getSupabaseAdmin()
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('product_id') ?? undefined

    // Get all products with stock levels
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, slug, inventory_count, color_theme, is_active, is_coming_soon')
      .order('name')

    if (productsError) throw productsError

    // Get recent inventory log
    const log = await getInventoryLog(productId)

    return withCors(
      NextResponse.json({ products, log }),
      request
    )
  } catch (err) {
    console.error('Admin inventory error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to fetch inventory' }, { status: 500 }),
      request
    )
  }
}

// POST — stock adjustment
export async function POST(request: Request) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const parsed = await readBoundedJsonObject(request, { maxBytes: MAX_BODY_BYTES })
    if (!parsed.ok) {
      return withCors(
        NextResponse.json({ error: parsed.error }, { status: parsed.status }),
        request
      )
    }
    const body = parsed.value
    if (!hasOnlyKeys(body, ['product_id', 'quantity_change', 'change_type', 'notes'])) {
      return withCors(
        NextResponse.json({ error: 'Request contains unsupported fields' }, { status: 400 }),
        request
      )
    }
    const productId = typeof body.product_id === 'string' ? body.product_id.trim() : ''
    const quantityChange = body.quantity_change
    const changeType = typeof body.change_type === 'string' ? body.change_type : ''
    const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined

    if (!UUID_PATTERN.test(productId)) {
      return withCors(
        NextResponse.json({ error: 'A valid product_id is required' }, { status: 400 }),
        request
      )
    }
    if (
      !Number.isSafeInteger(quantityChange) ||
      Number(quantityChange) === 0 ||
      Math.abs(Number(quantityChange)) > 100_000
    ) {
      return withCors(
        NextResponse.json(
          { error: 'quantity_change must be a non-zero integer between -100000 and 100000' },
          { status: 400 }
        ),
        request
      )
    }
    if (!CHANGE_TYPES.has(changeType)) {
      return withCors(
        NextResponse.json(
          { error: 'change_type must be restock, adjustment, or return' },
          { status: 400 }
        ),
        request
      )
    }
    if (body.notes !== undefined && typeof body.notes !== 'string') {
      return withCors(
        NextResponse.json({ error: 'notes must be text' }, { status: 400 }),
        request
      )
    }
    if (notes && notes.length > 1000) {
      return withCors(
        NextResponse.json({ error: 'notes cannot exceed 1000 characters' }, { status: 400 }),
        request
      )
    }

    const result = await adjustInventoryAtomic({
      product_id: productId,
      quantity_change: Number(quantityChange),
      change_type: changeType as 'restock' | 'adjustment' | 'return',
      notes,
    })

    return withCors(
      NextResponse.json(result),
      request
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('PRODUCT_NOT_FOUND')) {
      return withCors(
        NextResponse.json({ error: 'Product not found' }, { status: 404 }),
        request
      )
    }
    if (message.includes('INSUFFICIENT_STOCK')) {
      return withCors(
        NextResponse.json({ error: 'Inventory cannot be reduced below zero' }, { status: 409 }),
        request
      )
    }
    if (message.includes('ACTIVE_RESERVATIONS_EXCEED_NEW_STOCK')) {
      return withCors(
        NextResponse.json(
          { error: 'Inventory cannot be reduced below active prepaid reservations' },
          { status: 409 }
        ),
        request
      )
    }
    console.error('Admin inventory adjustment error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to adjust inventory' }, { status: 500 }),
      request
    )
  }
}
