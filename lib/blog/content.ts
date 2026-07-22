import type { BlogBlock } from '@/types/blog'

/**
 * Convert a trusted inline-markdown string to safe HTML.
 * Supports **bold**, *italic*, and [label](https://url). HTML is escaped first,
 * so author text can never inject markup; only these three patterns are allowed.
 * Links are forced to open in a new tab with rel="noopener".
 */
export function inlineMarkdownToHtml(input: string): string {
  const escaped = String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  return escaped
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-[#12BC00] underline underline-offset-2 hover:text-[#0fa600]">$1</a>'
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

/** Flatten a post's blocks to plain text (for excerpts / reading time). */
export function plainTextFromBlocks(blocks: BlogBlock[]): string {
  const parts: string[] = []
  for (const b of blocks ?? []) {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
        parts.push(b.text)
        break
      case 'quote':
        parts.push(b.text)
        if (b.attribution) parts.push(b.attribution)
        break
      case 'list':
        parts.push(...b.items)
        break
      case 'callout':
        if (b.title) parts.push(b.title)
        parts.push(b.text)
        break
      case 'image':
        if (b.caption) parts.push(b.caption)
        break
      default:
        break
    }
  }
  return parts.join(' ').replace(/\*\*|\*|\[|\]|\(https?:\/\/[^)]+\)/g, '').trim()
}

/** Estimate reading time in whole minutes (min 1) at ~200 wpm. */
export function estimateReadingTime(blocks: BlogBlock[]): number {
  const words = plainTextFromBlocks(blocks).split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

/** Extract a YouTube embed URL from a watch/share/embed link. */
export function youtubeEmbedUrl(url: string): string | null {
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  )
  return m ? `https://www.youtube.com/embed/${m[1]}` : null
}
