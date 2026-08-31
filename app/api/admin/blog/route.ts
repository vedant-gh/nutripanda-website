import { NextResponse } from 'next/server'
import { requireDashboardRole } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import {
  parseNewBlogPostInput,
  readBlogJsonRequest,
} from '@/lib/blog/admin-input'
import {
  getAllBlogPostsAdmin,
  createBlogPost,
} from '@/lib/supabase/queries'

const BLOG_ROLES = ['admin', 'blog_editor'] as const

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

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// GET — list all blog posts, including drafts, for dashboard editors.
export async function GET(request: Request) {
  const unauthorized = await authorizeBlog(request)
  if (unauthorized) return unauthorized

  try {
    const posts = await getAllBlogPostsAdmin()
    return blogResponse(request, { posts })
  } catch (error) {
    console.error('Admin get blog posts error:', error)
    return blogResponse(request, { error: 'Failed to fetch blog posts' }, { status: 500 })
  }
}

// POST — create a blog post from a strictly allowlisted payload.
export async function POST(request: Request) {
  const unauthorized = await authorizeBlog(request)
  if (unauthorized) return unauthorized

  const body = await readBlogJsonRequest(request)
  if (!body.ok) {
    return blogResponse(request, { error: body.error }, { status: body.status })
  }

  const parsed = parseNewBlogPostInput(body.value)
  if (!parsed.ok) {
    return blogResponse(request, { error: parsed.error }, { status: 400 })
  }

  try {
    const post = await createBlogPost(parsed.data)
    return blogResponse(request, { post }, { status: 201 })
  } catch (error) {
    console.error('Admin create blog post error:', error)
    if ((error as { code?: string })?.code === '23505') {
      return blogResponse(
        request,
        { error: 'A post with that slug already exists' },
        { status: 409 }
      )
    }
    return blogResponse(request, { error: 'Failed to create blog post' }, { status: 500 })
  }
}
