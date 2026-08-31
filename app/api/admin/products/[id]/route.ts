import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { getProductById, updateProduct, deleteProduct, hardDeleteProduct } from '@/lib/supabase/queries'
import { parseProductInput } from '@/lib/utils/product-input'
import { isUuid, readBoundedJsonObject } from '@/lib/utils/request-input'

const MAX_PRODUCT_BODY_BYTES = 256 * 1024

function invalidId(request: Request) {
  return withCors(NextResponse.json({ error: 'Invalid product ID' }, { status: 400 }), request)
}

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// GET — single product
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const { id } = await params
    if (!isUuid(id)) return invalidId(request)
    const product = await getProductById(id)

    if (!product) {
      return withCors(
        NextResponse.json({ error: 'Product not found' }, { status: 404 }),
        request
      )
    }

    return withCors(NextResponse.json({ product }), request)
  } catch (err) {
    console.error('Admin get product error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 }),
      request
    )
  }
}

// PUT — update product
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const { id } = await params
    if (!isUuid(id)) return invalidId(request)
    const input = await readBoundedJsonObject(request, { maxBytes: MAX_PRODUCT_BODY_BYTES })
    if (!input.ok) {
      return withCors(
        NextResponse.json({ error: input.error }, { status: input.status }),
        request
      )
    }
    const parsed = parseProductInput(input.value, {
      partial: true,
      allowInventory: false,
    })
    if (!parsed.ok) {
      return withCors(
        NextResponse.json({ error: parsed.error }, { status: 400 }),
        request
      )
    }

    const product = await updateProduct(id, parsed.value)
    return withCors(NextResponse.json({ product }), request)
  } catch (err) {
    console.error('Admin update product error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to update product' }, { status: 500 }),
      request
    )
  }
}

// DELETE — soft delete by default; ?permanent=true removes the row entirely
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const { id } = await params
    if (!isUuid(id)) return invalidId(request)
    const permanent = new URL(request.url).searchParams.get('permanent') === 'true'

    if (permanent) {
      await hardDeleteProduct(id)
    } else {
      await deleteProduct(id)
    }

    return withCors(NextResponse.json({ success: true, permanent }), request)
  } catch (err) {
    if (
      err
      && typeof err === 'object'
      && 'code' in err
      && String(err.code) === '23503'
    ) {
      return withCors(
        NextResponse.json(
          { error: 'Products with inventory or order history cannot be permanently deleted; archive them instead.' },
          { status: 409 }
        ),
        request
      )
    }
    console.error('Admin delete product error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to delete product' }, { status: 500 }),
      request
    )
  }
}
