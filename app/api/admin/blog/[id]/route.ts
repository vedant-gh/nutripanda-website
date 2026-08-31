import { NextResponse } from 'next/server'
import { requireDashboardRole } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import {
  isValidBlogPostId,
  parseBlogPostUpdate,
  readBlogJsonRequest,
} from '@/lib/blog/admin-input'
import {
  getBlogPostById,
  updateBlogPost,
  deleteBlogPost,
} from '@/lib/supabase/queries'

const BLOG_ROLES = ['admin', 'blog_editor'] as const
type RouteContext = { params: Promise<{ id: string }> }

function blogResponse(
  request: Request,
  data: unknown,
  { status = 200 }: { status?: number } = {}
) {
  const response = NextResponse.json(data, { status })
  response.headers.set('Cache-Control', 'no-store')
  return withCors(response, request)
}

async function authorizeBlog(request: Request): Promise<NextResponse | null> {
  const authorization = await requireDashboardRole(BLOG_ROLES)
  return authorization.authorized
    ? null
    : blogResponse(
        request,
        { error: authorization.error },
        { status: authorization.status }
      )
}

async function readPostId(
  request: Request,
  context: RouteContext
): Promise<{ id: string } | { response: NextResponse }> {
  const { id } = await context.params
  return isValidBlogPostId(id)
    ? { id }
    : { response: blogResponse(request, { error: 'Invalid post id' }, { status: 400 }) }
}

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// GET — fetch a single draft or published post for the dashboard editor.
export async function GET(request: Request, context: RouteContext) {
  const unauthorized = await authorizeBlog(request)
  if (unauthorized) return unauthorized

  const identifier = await readPostId(request, context)
  if ('response' in identifier) return identifier.response

  try {
    const post = await getBlogPostById(identifier.id)
    return post
      ? blogResponse(request, { post })
      : blogResponse(request, { error: 'Post not found' }, { status: 404 })
  } catch (error) {
    console.error('Admin get blog post error:', error)
    return blogResponse(request, { error: 'Failed to fetch blog post' }, { status: 500 })
  }
}

// PUT — update only explicitly supported blog fields.
export async function PUT(request: Request, context: RouteContext) {
  const unauthorized = await authorizeBlog(request)
  if (unauthorized) return unauthorized

  const identifier = await readPostId(request, context)
  if ('response' in identifier) return identifier.response

  const body = await readBlogJsonRequest(request)
  if (!body.ok) {
    return blogResponse(request, { error: body.error }, { status: body.status })
  }

  const parsed = parseBlogPostUpdate(body.value)
  if (!parsed.ok) {
    return blogResponse(request, { error: parsed.error }, { status: 400 })
  }

  try {
    const existing = await getBlogPostById(identifier.id)
    if (!existing) {
      return blogResponse(request, { error: 'Post not found' }, { status: 404 })
    }

    const post = await updateBlogPost(identifier.id, parsed.data)
    return blogResponse(request, { post })
  } catch (error) {
    console.error('Admin update blog post error:', error)
    if ((error as { code?: string })?.code === '23505') {
      return blogResponse(
        request,
        { error: 'A post with that slug already exists' },
        { status: 409 }
      )
    }
    return blogResponse(request, { error: 'Failed to update blog post' }, { status: 500 })
  }
}

// DELETE — permanently remove a blog post.
export async function DELETE(request: Request, context: RouteContext) {
  const unauthorized = await authorizeBlog(request)
  if (unauthorized) return unauthorized

  const identifier = await readPostId(request, context)
  if ('response' in identifier) return identifier.response

  try {
    const existing = await getBlogPostById(identifier.id)
    if (!existing) {
      return blogResponse(request, { error: 'Post not found' }, { status: 404 })
    }

    await deleteBlogPost(identifier.id)
    return blogResponse(request, { success: true })
  } catch (error) {
    console.error('Admin delete blog post error:', error)
    return blogResponse(request, { error: 'Failed to delete blog post' }, { status: 500 })
  }
}
