// Blog content model. A post's `content` is an ordered array of typed "blocks"
// (slices). The dashboard editor produces this array; the site renders it.
// This same shape is mirrored in the dashboard repo (nutri-panda-dashboard/lib/types.ts).

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'image'
  | 'imageGrid'
  | 'quote'
  | 'list'
  | 'callout'
  | 'divider'
  | 'cta'
  | 'embed'

export interface BaseBlock {
  id: string
  type: BlockType
}

/** Section heading. Post title is separate — headings start at level 2. */
export interface HeadingBlock extends BaseBlock {
  type: 'heading'
  level: 2 | 3
  text: string
}

/** Body text. Supports inline markdown: **bold**, *italic*, [label](https://url). */
export interface ParagraphBlock extends BaseBlock {
  type: 'paragraph'
  text: string
}

export interface ImageBlock extends BaseBlock {
  type: 'image'
  url: string
  alt?: string
  caption?: string
  width?: 'normal' | 'wide' | 'full'
}

export interface ImageGridBlock extends BaseBlock {
  type: 'imageGrid'
  columns: 2 | 3
  images: { url: string; caption?: string }[]
}

export interface QuoteBlock extends BaseBlock {
  type: 'quote'
  text: string
  attribution?: string
}

export interface ListBlock extends BaseBlock {
  type: 'list'
  style: 'bullet' | 'number'
  items: string[] // each supports inline markdown
}

export interface CalloutBlock extends BaseBlock {
  type: 'callout'
  emoji?: string
  title?: string
  text: string
  tone: 'green' | 'yellow' | 'neutral'
}

export interface DividerBlock extends BaseBlock {
  type: 'divider'
}

export interface CtaBlock extends BaseBlock {
  type: 'cta'
  label: string
  href: string
  style?: 'primary' | 'secondary'
}

export interface EmbedBlock extends BaseBlock {
  type: 'embed'
  provider: 'youtube'
  url: string
  caption?: string
}

export type BlogBlock =
  | HeadingBlock
  | ParagraphBlock
  | ImageBlock
  | ImageGridBlock
  | QuoteBlock
  | ListBlock
  | CalloutBlock
  | DividerBlock
  | CtaBlock
  | EmbedBlock

export interface BlogPost {
  id: string
  slug: string
  title: string
  excerpt: string | null
  cover_image_url: string | null
  content: BlogBlock[]
  author: string | null
  tags: string[] | null
  category: string | null
  status: 'draft' | 'published'
  is_featured: boolean
  reading_time: number | null
  seo_title: string | null
  seo_description: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

/** Fields the dashboard is allowed to write through the blog API. */
export interface BlogPostInput {
  slug: string
  title: string
  excerpt?: string | null
  cover_image_url?: string | null
  content: BlogBlock[]
  author?: string | null
  tags?: string[]
  category?: string | null
  status?: 'draft' | 'published'
  is_featured?: boolean
  seo_title?: string | null
  seo_description?: string | null
}
