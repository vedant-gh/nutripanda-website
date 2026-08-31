import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { getOrders } from '@/lib/supabase/queries'
import { parseAdminOrderFilters } from '@/lib/orders/admin-list-input'

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// GET — list orders with pagination, filters, search
export async function GET(request: Request) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const filters = parseAdminOrderFilters(searchParams)
    if (!filters.ok) {
      return withCors(
        NextResponse.json({ error: filters.error }, { status: 400 }),
        request
      )
    }

    const { orders, count } = await getOrders(filters.value)

    return withCors(
      NextResponse.json(
        {
          orders,
          count,
          limit: filters.value.limit,
          offset: filters.value.offset,
        },
        { headers: { 'Cache-Control': 'private, no-store' } }
      ),
      request
    )
  } catch (err) {
    console.error('Admin get orders error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 }),
      request
    )
  }
}
