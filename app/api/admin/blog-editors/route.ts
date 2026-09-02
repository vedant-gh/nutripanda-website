import { NextResponse } from 'next/server'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { requireDashboardRole, dashboardEditorConflictsWithAdminCredentials } from '@/lib/utils/admin-auth'
import { readBoundedJsonObject } from '@/lib/utils/request-input'
import {
  MAX_DASHBOARD_EDITOR_BODY_BYTES,
  parseDashboardEditorCreateInput,
} from '@/lib/dashboard-auth/editor-input'
import { hashDashboardEditorPassword } from '@/lib/dashboard-auth/editor-password'
import {
  createDashboardBlogEditor,
  listDashboardBlogEditors,
} from '@/lib/supabase/dashboard-blog-editors'

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

async function requireAdmin(request: Request): Promise<NextResponse | null> {
  const authorization = await requireDashboardRole(['admin'])
  return authorization.authorized
    ? null
    : withCors(
        noStore(NextResponse.json(
          { error: authorization.error },
          { status: authorization.status }
        )),
        request
      )
}

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request)
  if (unauthorized) return unauthorized

  try {
    const editors = await listDashboardBlogEditors()
    return withCors(noStore(NextResponse.json({ editors })), request)
  } catch (error) {
    console.error('Admin list blog editors error:', error)
    return withCors(
      noStore(NextResponse.json({ error: 'Failed to fetch blog editors' }, { status: 500 })),
      request
    )
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request)
  if (unauthorized) return unauthorized

  try {
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_DASHBOARD_EDITOR_BODY_BYTES,
    })
    if (!body.ok) {
      return withCors(
        noStore(NextResponse.json({ error: body.error }, { status: body.status })),
        request
      )
    }

    const input = parseDashboardEditorCreateInput(body.value)
    if (!input.ok) {
      return withCors(
        noStore(NextResponse.json({ error: input.error }, { status: 400 })),
        request
      )
    }

    if (dashboardEditorConflictsWithAdminCredentials(input.value.email, input.value.password)) {
      return withCors(
        noStore(NextResponse.json(
          { error: 'Editor email and password must be different from the admin credentials' },
          { status: 409 }
        )),
        request
      )
    }

    const passwordHash = await hashDashboardEditorPassword(input.value.password)
    const editor = await createDashboardBlogEditor({
      email: input.value.email,
      passwordHash,
    })

    return withCors(
      noStore(NextResponse.json({ editor }, { status: 201 })),
      request
    )
  } catch (error) {
    const databaseError = error as { code?: string }
    if (databaseError.code === '23505') {
      return withCors(
        noStore(NextResponse.json(
          { error: 'A blog editor with that email already exists' },
          { status: 409 }
        )),
        request
      )
    }

    console.error('Admin create blog editor error:', error)
    return withCors(
      noStore(NextResponse.json({ error: 'Failed to create blog editor' }, { status: 500 })),
      request
    )
  }
}

