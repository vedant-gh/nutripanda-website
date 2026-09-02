import { NextResponse } from 'next/server'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { requireDashboardRole, dashboardEditorConflictsWithAdminCredentials } from '@/lib/utils/admin-auth'
import { isUuid, readBoundedJsonObject } from '@/lib/utils/request-input'
import {
  MAX_DASHBOARD_EDITOR_BODY_BYTES,
  parseDashboardEditorPasswordInput,
} from '@/lib/dashboard-auth/editor-input'
import { hashDashboardEditorPassword } from '@/lib/dashboard-auth/editor-password'
import {
  deleteDashboardBlogEditor,
  updateDashboardBlogEditorPassword,
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

function invalidId(request: Request): NextResponse {
  return withCors(
    noStore(NextResponse.json({ error: 'Invalid editor ID' }, { status: 400 })),
    request
  )
}

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAdmin(request)
  if (unauthorized) return unauthorized

  const { id } = await params
  if (!isUuid(id)) return invalidId(request)

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

    const input = parseDashboardEditorPasswordInput(body.value)
    if (!input.ok) {
      return withCors(
        noStore(NextResponse.json({ error: input.error }, { status: 400 })),
        request
      )
    }

    if (dashboardEditorConflictsWithAdminCredentials('', input.value.password)) {
      return withCors(
        noStore(NextResponse.json(
          { error: 'Editor password must be different from the admin password' },
          { status: 409 }
        )),
        request
      )
    }

    const passwordHash = await hashDashboardEditorPassword(input.value.password)
    const editor = await updateDashboardBlogEditorPassword({ id, passwordHash })
    if (!editor) {
      return withCors(
        noStore(NextResponse.json({ error: 'Blog editor not found' }, { status: 404 })),
        request
      )
    }

    return withCors(noStore(NextResponse.json({ editor })), request)
  } catch (error) {
    console.error('Admin update blog editor password error:', error)
    return withCors(
      noStore(NextResponse.json({ error: 'Failed to update blog editor password' }, { status: 500 })),
      request
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAdmin(request)
  if (unauthorized) return unauthorized

  const { id } = await params
  if (!isUuid(id)) return invalidId(request)

  try {
    const deleted = await deleteDashboardBlogEditor(id)
    if (!deleted) {
      return withCors(
        noStore(NextResponse.json({ error: 'Blog editor not found' }, { status: 404 })),
        request
      )
    }

    return withCors(noStore(NextResponse.json({ success: true })), request)
  } catch (error) {
    console.error('Admin delete blog editor error:', error)
    return withCors(
      noStore(NextResponse.json({ error: 'Failed to delete blog editor' }, { status: 500 })),
      request
    )
  }
}

