import type {
  BlogBlock,
  BlogPostInput,
  CalloutBlock,
  CtaBlock,
  EmbedBlock,
  HeadingBlock,
  ImageBlock,
  ImageGridBlock,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
} from '@/types/blog'
import { youtubeEmbedUrl } from '@/lib/blog/content'

export const MAX_BLOG_REQUEST_BYTES = 1024 * 1024

const MAX_CONTENT_BYTES = 900 * 1024
const MAX_BLOCKS = 200
const MAX_GRID_IMAGES = 12
const MAX_LIST_ITEMS = 100
const BLOG_INPUT_FIELDS = new Set([
  'slug',
  'title',
  'excerpt',
  'cover_image_url',
  'content',
  'author',
  'tags',
  'category',
  'status',
  'is_featured',
  'seo_title',
  'seo_description',
])
const BLOG_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export type BlogJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; status: 400 | 413 | 415 }

export type ParsedBlogInput<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function onlyAllowsKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string
): ValidationResult<true> {
  const allowedKeys = new Set(allowed)
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key))
  return unexpected
    ? { ok: false, error: `${context} contains unsupported field "${unexpected}"` }
    : { ok: true, value: true }
}

function textValue(
  value: unknown,
  field: string,
  maxLength: number,
  { required = false }: { required?: boolean } = {}
): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, error: `${field} must be text` }
  }
  if (required && !value.trim()) {
    return { ok: false, error: `${field} is required` }
  }
  if (value.length > maxLength) {
    return { ok: false, error: `${field} must be ${maxLength} characters or fewer` }
  }
  return { ok: true, value }
}

function optionalBlockText(
  value: unknown,
  field: string,
  maxLength: number
): ValidationResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  return textValue(value, field, maxLength)
}

function optionalPostText(
  value: unknown,
  field: string,
  maxLength: number
): ValidationResult<string | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null) return { ok: true, value: null }
  const parsed = textValue(value, field, maxLength)
  if (!parsed.ok) return parsed
  const trimmed = parsed.value.trim()
  return { ok: true, value: trimmed || null }
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function isSafeInternalPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
}

function isAllowedImageUrl(value: string): boolean {
  if (isSafeInternalPath(value)) return true
  if (!isSafeHttpsUrl(value)) return false

  const hostname = new URL(value).hostname.toLowerCase()
  return hostname === 'placehold.co' || hostname.endsWith('.supabase.co')
}

function isAllowedLink(value: string): boolean {
  return isSafeInternalPath(value) || isSafeHttpsUrl(value)
}

function addOptionalText<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined
) {
  if (value !== undefined) target[key] = value
}

function parseBlock(raw: unknown, index: number): ValidationResult<BlogBlock> {
  const context = `Content block ${index + 1}`
  if (!isRecord(raw)) {
    return { ok: false, error: `${context} must be an object` }
  }

  const id = textValue(raw.id, `${context} id`, 100, { required: true })
  if (!id.ok) return id
  if (!BLOCK_ID_PATTERN.test(id.value)) {
    return { ok: false, error: `${context} id contains unsupported characters` }
  }
  if (typeof raw.type !== 'string') {
    return { ok: false, error: `${context} type is required` }
  }

  switch (raw.type) {
    case 'heading': {
      const keys = onlyAllowsKeys(raw, ['id', 'type', 'level', 'text'], context)
      if (!keys.ok) return keys
      if (raw.level !== 2 && raw.level !== 3) {
        return { ok: false, error: `${context} level must be 2 or 3` }
      }
      const text = textValue(raw.text, `${context} text`, 500)
      if (!text.ok) return text
      const block: HeadingBlock = { id: id.value, type: 'heading', level: raw.level, text: text.value }
      return { ok: true, value: block }
    }

    case 'paragraph': {
      const keys = onlyAllowsKeys(raw, ['id', 'type', 'text'], context)
      if (!keys.ok) return keys
      const text = textValue(raw.text, `${context} text`, 20_000)
      if (!text.ok) return text
      const block: ParagraphBlock = { id: id.value, type: 'paragraph', text: text.value }
      return { ok: true, value: block }
    }

    case 'image': {
      const keys = onlyAllowsKeys(raw, ['id', 'type', 'url', 'alt', 'caption', 'width'], context)
      if (!keys.ok) return keys
      const url = textValue(raw.url, `${context} URL`, 2048, { required: true })
      if (!url.ok) return url
      if (!isAllowedImageUrl(url.value)) {
        return { ok: false, error: `${context} URL must be a trusted HTTPS image URL` }
      }
      const alt = optionalBlockText(raw.alt, `${context} alt text`, 500)
      if (!alt.ok) return alt
      const caption = optionalBlockText(raw.caption, `${context} caption`, 1000)
      if (!caption.ok) return caption
      if (raw.width !== undefined && !['normal', 'wide', 'full'].includes(String(raw.width))) {
        return { ok: false, error: `${context} width is invalid` }
      }
      const block: ImageBlock = { id: id.value, type: 'image', url: url.value }
      addOptionalText(block, 'alt', alt.value)
      addOptionalText(block, 'caption', caption.value)
      addOptionalText(block, 'width', raw.width as ImageBlock['width'] | undefined)
      return { ok: true, value: block }
    }

    case 'imageGrid': {
      const keys = onlyAllowsKeys(raw, ['id', 'type', 'columns', 'images'], context)
      if (!keys.ok) return keys
      if (raw.columns !== 2 && raw.columns !== 3) {
        return { ok: false, error: `${context} columns must be 2 or 3` }
      }
      if (!Array.isArray(raw.images) || raw.images.length > MAX_GRID_IMAGES) {
        return { ok: false, error: `${context} must contain at most ${MAX_GRID_IMAGES} images` }
      }

      const images: ImageGridBlock['images'] = []
      for (const [imageIndex, rawImage] of raw.images.entries()) {
        if (!isRecord(rawImage)) {
          return { ok: false, error: `${context} image ${imageIndex + 1} must be an object` }
        }
        const imageKeys = onlyAllowsKeys(
          rawImage,
          ['url', 'caption'],
          `${context} image ${imageIndex + 1}`
        )
        if (!imageKeys.ok) return imageKeys
        const url = textValue(rawImage.url, `${context} image ${imageIndex + 1} URL`, 2048, {
          required: true,
        })
        if (!url.ok) return url
        if (!isAllowedImageUrl(url.value)) {
          return { ok: false, error: `${context} image ${imageIndex + 1} URL is not allowed` }
        }
        const caption = optionalBlockText(
          rawImage.caption,
          `${context} image ${imageIndex + 1} caption`,
          1000
        )
        if (!caption.ok) return caption
        images.push(caption.value === undefined ? { url: url.value } : { url: url.value, caption: caption.value })
      }

      const block: ImageGridBlock = {
        id: id.value,
        type: 'imageGrid',
        columns: raw.columns,
        images,
      }
      return { ok: true, value: block }
    }

    case 'quote': {
      const keys = onlyAllowsKeys(raw, ['id', 'type', 'text', 'attribution'], context)
      if (!keys.ok) return keys
      const text = textValue(raw.text, `${context} text`, 5000)
      if (!text.ok) return text
      const attribution = optionalBlockText(raw.attribution, `${context} attribution`, 500)
      if (!attribution.ok) return attribution
      const block: QuoteBlock = { id: id.value, type: 'quote', text: text.value }
      addOptionalText(block, 'attribution', attribution.value)
      return { ok: true, value: block }
    }

    case 'list': {
      const keys = onlyAllowsKeys(raw, ['id', 'type', 'style', 'items'], context)
      if (!keys.ok) return keys
      if (raw.style !== 'bullet' && raw.style !== 'number') {
        return { ok: false, error: `${context} list style is invalid` }
      }
      if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > MAX_LIST_ITEMS) {
        return { ok: false, error: `${context} must contain 1-${MAX_LIST_ITEMS} list items` }
      }
      const items: string[] = []
      for (const [itemIndex, item] of raw.items.entries()) {
        const parsed = textValue(item, `${context} item ${itemIndex + 1}`, 5000)
        if (!parsed.ok) return parsed
        items.push(parsed.value)
      }
      const block: ListBlock = { id: id.value, type: 'list', style: raw.style, items }
      return { ok: true, value: block }
    }

    case 'callout': {
      const keys = onlyAllowsKeys(raw, ['id', 'type', 'emoji', 'title', 'text', 'tone'], context)
      if (!keys.ok) return keys
      const emoji = optionalBlockText(raw.emoji, `${context} emoji`, 16)
      if (!emoji.ok) return emoji
      const title = optionalBlockText(raw.title, `${context} title`, 500)
      if (!title.ok) return title
      const text = textValue(raw.text, `${context} text`, 10_000)
      if (!text.ok) return text
      if (raw.tone !== 'green' && raw.tone !== 'yellow' && raw.tone !== 'neutral') {
        return { ok: false, error: `${context} tone is invalid` }
      }
      const block: CalloutBlock = {
        id: id.value,
        type: 'callout',
        text: text.value,
        tone: raw.tone,
      }
      addOptionalText(block, 'emoji', emoji.value)
      addOptionalText(block, 'title', title.value)
      return { ok: true, value: block }
    }

    case 'divider': {
      const keys = onlyAllowsKeys(raw, ['id', 'type'], context)
      if (!keys.ok) return keys
      return { ok: true, value: { id: id.value, type: 'divider' } }
    }

    case 'cta': {
      const keys = onlyAllowsKeys(raw, ['id', 'type', 'label', 'href', 'style'], context)
      if (!keys.ok) return keys
      const label = textValue(raw.label, `${context} label`, 200, { required: true })
      if (!label.ok) return label
      const href = textValue(raw.href, `${context} link`, 2048, { required: true })
      if (!href.ok) return href
      if (!isAllowedLink(href.value)) {
        return { ok: false, error: `${context} link must be an internal path or HTTPS URL` }
      }
      if (raw.style !== undefined && raw.style !== 'primary' && raw.style !== 'secondary') {
        return { ok: false, error: `${context} style is invalid` }
      }
      const block: CtaBlock = { id: id.value, type: 'cta', label: label.value, href: href.value }
      addOptionalText(block, 'style', raw.style as CtaBlock['style'] | undefined)
      return { ok: true, value: block }
    }

    case 'embed': {
      const keys = onlyAllowsKeys(raw, ['id', 'type', 'provider', 'url', 'caption'], context)
      if (!keys.ok) return keys
      if (raw.provider !== 'youtube') {
        return { ok: false, error: `${context} provider must be YouTube` }
      }
      const url = textValue(raw.url, `${context} URL`, 2048, { required: true })
      if (!url.ok) return url
      if (!youtubeEmbedUrl(url.value)) {
        return { ok: false, error: `${context} URL must be a valid YouTube video URL` }
      }
      const caption = optionalBlockText(raw.caption, `${context} caption`, 1000)
      if (!caption.ok) return caption
      const block: EmbedBlock = {
        id: id.value,
        type: 'embed',
        provider: 'youtube',
        url: url.value,
      }
      addOptionalText(block, 'caption', caption.value)
      return { ok: true, value: block }
    }

    default:
      return { ok: false, error: `${context} type is not supported` }
  }
}

function parseContent(value: unknown): ValidationResult<BlogBlock[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'Content must be an array of blog blocks' }
  }
  if (value.length > MAX_BLOCKS) {
    return { ok: false, error: `Content must contain at most ${MAX_BLOCKS} blocks` }
  }

  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    return { ok: false, error: 'Content must be JSON serializable' }
  }
  if (byteLength(encoded) > MAX_CONTENT_BYTES) {
    return { ok: false, error: 'Blog content is too large' }
  }

  const blocks: BlogBlock[] = []
  const ids = new Set<string>()
  for (const [index, valueBlock] of value.entries()) {
    const block = parseBlock(valueBlock, index)
    if (!block.ok) return block
    if (ids.has(block.value.id)) {
      return { ok: false, error: `Content block ${index + 1} has a duplicate id` }
    }
    ids.add(block.value.id)
    blocks.push(block.value)
  }
  return { ok: true, value: blocks }
}

function parseBlogFields(
  raw: unknown,
  { partial }: { partial: boolean }
): ParsedBlogInput<BlogPostInput | Partial<BlogPostInput>> {
  if (!isRecord(raw)) {
    return { ok: false, error: 'Invalid blog post payload' }
  }

  const unsupported = Object.keys(raw).find((key) => !BLOG_INPUT_FIELDS.has(key))
  if (unsupported) {
    return { ok: false, error: `Unsupported blog field "${unsupported}"` }
  }

  const data: Partial<BlogPostInput> = {}

  if (raw.title !== undefined) {
    const title = textValue(raw.title, 'Title', 200, { required: true })
    if (!title.ok) return title
    data.title = title.value.trim()
  } else if (!partial) {
    return { ok: false, error: 'Title is required' }
  }

  if (raw.slug !== undefined) {
    const slug = textValue(raw.slug, 'Slug', 200, { required: true })
    if (!slug.ok) return slug
    const normalizedSlug = slug.value.trim().toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) {
      return { ok: false, error: 'Slug must contain only lowercase letters, numbers, and hyphens' }
    }
    data.slug = normalizedSlug
  } else if (!partial) {
    return { ok: false, error: 'Slug is required' }
  }

  if (raw.content !== undefined) {
    const content = parseContent(raw.content)
    if (!content.ok) return content
    data.content = content.value
  } else if (!partial) {
    data.content = []
  }

  const optionalFields = [
    ['excerpt', 1000],
    ['cover_image_url', 2048],
    ['author', 120],
    ['category', 100],
    ['seo_title', 200],
    ['seo_description', 500],
  ] as const

  for (const [field, maxLength] of optionalFields) {
    const parsed = optionalPostText(raw[field], field, maxLength)
    if (!parsed.ok) return parsed
    if (parsed.value !== undefined) data[field] = parsed.value
  }

  if (data.cover_image_url && !isAllowedImageUrl(data.cover_image_url)) {
    return { ok: false, error: 'cover_image_url must be a trusted HTTPS image URL' }
  }

  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.length > 20) {
      return { ok: false, error: 'Tags must be an array with at most 20 values' }
    }
    const tags: string[] = []
    for (const [index, rawTag] of raw.tags.entries()) {
      const tag = textValue(rawTag, `Tag ${index + 1}`, 50, { required: true })
      if (!tag.ok) return tag
      tags.push(tag.value.trim())
    }
    data.tags = Array.from(new Set(tags))
  }

  if (raw.status !== undefined) {
    if (raw.status !== 'draft' && raw.status !== 'published') {
      return { ok: false, error: 'Status must be draft or published' }
    }
    data.status = raw.status
  }

  if (raw.is_featured !== undefined) {
    if (typeof raw.is_featured !== 'boolean') {
      return { ok: false, error: 'is_featured must be true or false' }
    }
    data.is_featured = raw.is_featured
  }

  if (partial && Object.keys(data).length === 0) {
    return { ok: false, error: 'No supported blog fields were provided' }
  }

  return { ok: true, data }
}

export async function readBlogJsonRequest(request: Request): Promise<BlogJsonResult> {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json' && !contentType?.endsWith('+json')) {
    return { ok: false, error: 'Content-Type must be application/json', status: 415 }
  }

  const declaredLength = request.headers.get('content-length')
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    if (Number(declaredLength) > MAX_BLOG_REQUEST_BYTES) {
      return { ok: false, error: 'Blog post payload is too large', status: 413 }
    }
  }

  let body: string
  try {
    body = await request.text()
  } catch {
    return { ok: false, error: 'Could not read request body', status: 400 }
  }

  if (!body.trim()) {
    return { ok: false, error: 'Request body is required', status: 400 }
  }
  if (byteLength(body) > MAX_BLOG_REQUEST_BYTES) {
    return { ok: false, error: 'Blog post payload is too large', status: 413 }
  }

  try {
    return { ok: true, value: JSON.parse(body) as unknown }
  } catch {
    return { ok: false, error: 'Request body must be valid JSON', status: 400 }
  }
}

export function parseNewBlogPostInput(raw: unknown): ParsedBlogInput<BlogPostInput> {
  const result = parseBlogFields(raw, { partial: false })
  return result.ok
    ? { ok: true, data: result.data as BlogPostInput }
    : result
}

export function parseBlogPostUpdate(
  raw: unknown
): ParsedBlogInput<Partial<BlogPostInput>> {
  const result = parseBlogFields(raw, { partial: true })
  return result.ok
    ? { ok: true, data: result.data }
    : result
}

export function isValidBlogPostId(value: string): boolean {
  return BLOG_ID_PATTERN.test(value)
}
