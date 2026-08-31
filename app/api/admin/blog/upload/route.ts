import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireDashboardRole } from '@/lib/utils/admin-auth'
import { handleCors, withCors } from '@/lib/utils/api-helpers'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

const BLOG_ROLES = ['admin', 'blog_editor'] as const
const BUCKET = 'product-images'
const BLOG_PREFIX = 'blog/'
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_TOTAL_FILE_SIZE = 25 * 1024 * 1024
const MAX_MULTIPART_SIZE = MAX_TOTAL_FILE_SIZE + 512 * 1024
const MAX_FILES = 10
const FILE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

function blogResponse(
  request: Request,
  data: unknown,
  { status = 200 }: { status?: number } = {}
) {
  const response = NextResponse.json(data, { status })
  response.headers.set('Cache-Control', 'no-store')
  return withCors(response, request)
}

function hasBytes(buffer: Buffer, offset: number, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => buffer[offset + index] === byte)
}

function hasValidImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && hasBytes(buffer, 0, [0xff, 0xd8, 0xff])
  }
  if (mimeType === 'image/png') {
    return buffer.length >= 8
      && hasBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  if (mimeType === 'image/avif') {
    if (buffer.length < 16 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') return false
    for (let offset = 8; offset + 4 <= Math.min(buffer.length, 64); offset += offset === 8 ? 8 : 4) {
      const brand = buffer.subarray(offset, offset + 4).toString('ascii')
      if (brand === 'avif' || brand === 'avis') return true
    }
  }
  return false
}

export async function OPTIONS(request: Request) {
  return handleCors(request)
}

export async function POST(request: Request) {
  const authorization = await requireDashboardRole(BLOG_ROLES)
  if (!authorization.authorized) {
    return blogResponse(
      request,
      { error: authorization.error },
      { status: authorization.status }
    )
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    return blogResponse(
      request,
      { error: 'Expected a multipart image upload' },
      { status: 415 }
    )
  }

  const declaredLength = request.headers.get('content-length')
  if (
    declaredLength
    && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > MAX_MULTIPART_SIZE
  ) {
    return blogResponse(request, { error: 'Image upload is too large' }, { status: 413 })
  }

  try {
    const formData = await request.formData()
    const unexpectedField = Array.from(new Set(formData.keys())).find((key) => key !== 'files')
    if (unexpectedField) {
      return blogResponse(
        request,
        { error: `Unsupported upload field "${unexpectedField}"` },
        { status: 400 }
      )
    }

    const rawFiles = formData.getAll('files')
    if (rawFiles.length === 0) {
      return blogResponse(request, { error: 'No files provided' }, { status: 400 })
    }
    if (rawFiles.length > MAX_FILES) {
      return blogResponse(
        request,
        { error: `Upload no more than ${MAX_FILES} images at once` },
        { status: 400 }
      )
    }
    if (!rawFiles.every((value): value is File => value instanceof File)) {
      return blogResponse(request, { error: 'Every files field must be an image' }, { status: 400 })
    }

    const totalSize = rawFiles.reduce((sum, file) => sum + file.size, 0)
    if (totalSize > MAX_TOTAL_FILE_SIZE) {
      return blogResponse(request, { error: 'Combined image upload exceeds 25MB' }, { status: 413 })
    }

    const preparedFiles: Array<{ buffer: Buffer; extension: string; mimeType: string }> = []
    for (const file of rawFiles) {
      const extension = FILE_EXTENSIONS[file.type]
      if (!extension) {
        return blogResponse(
          request,
          { error: 'Only JPEG, PNG, WebP, and AVIF images are allowed' },
          { status: 400 }
        )
      }
      if (file.size === 0) {
        return blogResponse(request, { error: 'Empty image files are not allowed' }, { status: 400 })
      }
      if (file.size > MAX_FILE_SIZE) {
        return blogResponse(
          request,
          { error: `File "${file.name}" exceeds the 5MB limit` },
          { status: 413 }
        )
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      if (!hasValidImageSignature(buffer, file.type)) {
        return blogResponse(
          request,
          { error: `File "${file.name}" does not match its image type` },
          { status: 400 }
        )
      }
      preparedFiles.push({ buffer, extension, mimeType: file.type })
    }

    const supabase = getSupabaseAdmin()
    const uploadedPaths: string[] = []
    const urls: string[] = []

    try {
      for (const file of preparedFiles) {
        const path = `${BLOG_PREFIX}${randomUUID()}.${file.extension}`
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, file.buffer, {
            cacheControl: '31536000',
            contentType: file.mimeType,
            upsert: false,
          })

        if (error) throw error

        uploadedPaths.push(path)
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
        urls.push(data.publicUrl)
      }
    } catch (error) {
      if (uploadedPaths.length > 0) {
        const { error: rollbackError } = await supabase.storage.from(BUCKET).remove(uploadedPaths)
        if (rollbackError) console.error('Blog image rollback error:', rollbackError)
      }
      throw error
    }

    return blogResponse(request, { urls })
  } catch (error) {
    console.error('Blog image upload error:', error)
    return blogResponse(request, { error: 'Image upload failed' }, { status: 500 })
  }
}
