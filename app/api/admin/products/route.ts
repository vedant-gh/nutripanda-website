import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { getAllProductsAdmin, createProduct } from '@/lib/supabase/queries'
import { parseProductInput } from '@/lib/utils/product-input'
import { readBoundedJsonObject } from '@/lib/utils/request-input'

const MAX_PRODUCT_BODY_BYTES = 256 * 1024

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// GET — list all products (including inactive)
export async function GET(request: Request) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const products = await getAllProductsAdmin()
    return withCors(noStore(NextResponse.json({ products })), request)
  } catch (err) {
    console.error('Admin get products error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 }),
      request
    )
  }
}

// POST — create product
export async function POST(request: Request) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const input = await readBoundedJsonObject(request, { maxBytes: MAX_PRODUCT_BODY_BYTES })
    if (!input.ok) {
      return withCors(
        NextResponse.json({ error: input.error }, { status: input.status }),
        request
      )
    }
    const parsed = parseProductInput(input.value, {
      partial: false,
      allowInventory: true,
    })
    if (!parsed.ok) {
      return withCors(
        NextResponse.json({ error: parsed.error }, { status: 400 }),
        request
      )
    }

    const product = await createProduct({
      description: null,
      short_description: null,
      compare_at_price: null,
      images: null,
      color_theme: null,
      ingredients: null,
      nutrition_facts: null,
      trust_badges: null,
      category: null,
      is_active: true,
      is_featured: false,
      is_coming_soon: false,
      inventory_count: 0,
      seo_title: null,
      seo_description: null,
      ...parsed.value,
    } as Parameters<typeof createProduct>[0])

    return withCors(NextResponse.json({ product }, { status: 201 }), request)
  } catch (err) {
    console.error('Admin create product error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to create product' }, { status: 500 }),
      request
    )
  }
}
