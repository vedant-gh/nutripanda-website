import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import {
  getAllBlogPostsAdmin,
  createBlogPost,
  type BlogPostInput,
} from '@/lib/supabase/queries'

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// GET — list all blog posts (including drafts)
export async function GET(request: Request) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const posts = await getAllBlogPostsAdmin()
    return withCors(NextResponse.json({ posts }), request)
  } catch (err) {
    console.error('Admin get blog posts error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to fetch blog posts' }, { status: 500 }),
      request
    )
  }
}

// POST — create blog post
export async function POST(request: Request) {
  if (!(await verifyAdminSession())) {
    return withCors(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request
    )
  }

  try {
    const body = (await request.json()) as BlogPostInput

    // Basic validation
    if (typeof body.slug !== 'string' || !body.slug.trim() ||
        typeof body.title !== 'string' || !body.title.trim()) {
      return withCors(
        NextResponse.json({ error: 'Slug and title are required' }, { status: 400 }),
        request
      )
    }

    const post = await createBlogPost(body)
    return withCors(NextResponse.json({ post }, { status: 201 }), request)
  } catch (err) {
    console.error('Admin create blog post error:', err)
    if ((err as { code?: string })?.code === '23505') {
      return withCors(
        NextResponse.json(
          { error: 'A post with that slug already exists' },
          { status: 409 }
        ),
        request
      )
    }
    return withCors(
      NextResponse.json({ error: 'Failed to create blog post' }, { status: 500 }),
      request
    )
  }
}
