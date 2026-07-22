import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import {
  getBlogPostById,
  updateBlogPost,
  deleteBlogPost,
  type BlogPostInput,
} from '@/lib/supabase/queries'

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

// GET — single blog post
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
    const post = await getBlogPostById(id)

    if (!post) {
      return withCors(
        NextResponse.json({ error: 'Post not found' }, { status: 404 }),
        request
      )
    }

    return withCors(NextResponse.json({ post }), request)
  } catch (err) {
    console.error('Admin get blog post error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to fetch blog post' }, { status: 500 }),
      request
    )
  }
}

// PUT — update blog post
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
    const body = (await request.json()) as Partial<BlogPostInput>

    const post = await updateBlogPost(id, body)
    return withCors(NextResponse.json({ post }), request)
  } catch (err) {
    console.error('Admin update blog post error:', err)
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
      NextResponse.json({ error: 'Failed to update blog post' }, { status: 500 }),
      request
    )
  }
}

// DELETE — permanently remove a blog post
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
    await deleteBlogPost(id)
    return withCors(NextResponse.json({ success: true }), request)
  } catch (err) {
    console.error('Admin delete blog post error:', err)
    return withCors(
      NextResponse.json({ error: 'Failed to delete blog post' }, { status: 500 }),
      request
    )
  }
}
