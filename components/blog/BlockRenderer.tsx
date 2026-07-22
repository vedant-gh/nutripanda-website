import Image from 'next/image'
import Link from 'next/link'
import type { BlogBlock } from '@/types/blog'
import { inlineMarkdownToHtml, youtubeEmbedUrl } from '@/lib/blog/content'

/**
 * Renders an ordered array of blog content blocks with on-brand styling.
 * Server component — no interactivity needed.
 */
export default function BlockRenderer({ blocks }: { blocks: BlogBlock[] }) {
  return (
    <div className="flex flex-col">
      {(blocks ?? []).map((block) => (
        <Block key={block.id} block={block} />
      ))}
    </div>
  )
}

function Block({ block }: { block: BlogBlock }) {
  switch (block.type) {
    case 'heading':
      return block.level === 3 ? (
        <h3 className="font-heading mt-8 mb-3 text-xl font-bold leading-snug tracking-tight text-gray-900 sm:text-2xl">
          {block.text}
        </h3>
      ) : (
        <h2 className="font-heading mt-10 mb-4 text-2xl font-bold leading-snug tracking-tight text-gray-900 sm:text-3xl">
          {block.text}
        </h2>
      )

    case 'paragraph':
      return (
        <p
          className="my-4 text-[1.0625rem] leading-8 text-gray-700"
          dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(block.text) }}
        />
      )

    case 'image': {
      const width = block.width ?? 'normal'
      const wrapperClass =
        width === 'full'
          ? 'my-8 -mx-4 sm:-mx-6 lg:-mx-8'
          : width === 'wide'
            ? 'my-8 md:-mx-16 lg:-mx-24'
            : 'my-8'
      return (
        <figure className={wrapperClass}>
          <div className="relative w-full overflow-hidden rounded-2xl bg-[#f3f3f3]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Image
              src={block.url}
              alt={block.alt ?? ''}
              width={1600}
              height={900}
              className="h-auto w-full object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
            />
          </div>
          {block.caption && (
            <figcaption className="mt-2 text-center text-sm italic text-gray-500">
              {block.caption}
            </figcaption>
          )}
        </figure>
      )
    }

    case 'imageGrid': {
      const cols =
        block.columns === 3
          ? 'sm:grid-cols-3'
          : 'sm:grid-cols-2'
      return (
        <div className={`my-8 grid grid-cols-1 gap-4 ${cols}`}>
          {block.images.map((img, i) => (
            <figure key={i} className="flex flex-col">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#f3f3f3]">
                <Image
                  src={img.url}
                  alt={img.caption ?? ''}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 100vw, 33vw"
                />
              </div>
              {img.caption && (
                <figcaption className="mt-2 text-center text-sm italic text-gray-500">
                  {img.caption}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )
    }

    case 'quote':
      return (
        <blockquote className="my-8 border-l-4 border-[#12BC00] pl-5 sm:pl-6">
          <p className="font-heading text-xl leading-relaxed text-gray-900 sm:text-2xl">
            {block.text}
          </p>
          {block.attribution && (
            <cite className="mt-3 block text-sm font-medium not-italic text-gray-500">
              — {block.attribution}
            </cite>
          )}
        </blockquote>
      )

    case 'list':
      return block.style === 'number' ? (
        <ol className="my-4 list-decimal space-y-2 pl-6 text-[1.0625rem] leading-8 text-gray-700 marker:text-[#12BC00] marker:font-semibold">
          {block.items.map((item, i) => (
            <li
              key={i}
              dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(item) }}
            />
          ))}
        </ol>
      ) : (
        <ul className="my-4 list-disc space-y-2 pl-6 text-[1.0625rem] leading-8 text-gray-700 marker:text-[#12BC00]">
          {block.items.map((item, i) => (
            <li
              key={i}
              dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(item) }}
            />
          ))}
        </ul>
      )

    case 'callout': {
      const tone = block.tone
      const toneClass =
        tone === 'green'
          ? 'bg-[#DCFDCC] border-[#12BC00]/30'
          : tone === 'yellow'
            ? 'bg-amber-50 border-amber-300'
            : 'bg-gray-50 border-gray-200'
      return (
        <div
          className={`my-8 flex gap-3 rounded-2xl border p-5 sm:p-6 ${toneClass}`}
        >
          {block.emoji && (
            <span className="shrink-0 text-2xl leading-7" aria-hidden="true">
              {block.emoji}
            </span>
          )}
          <div className="min-w-0">
            {block.title && (
              <p className="font-heading mb-1 text-base font-bold text-gray-900">
                {block.title}
              </p>
            )}
            <p
              className="text-[1.0625rem] leading-7 text-gray-700"
              dangerouslySetInnerHTML={{
                __html: inlineMarkdownToHtml(block.text),
              }}
            />
          </div>
        </div>
      )
    }

    case 'divider':
      return (
        <hr className="mx-auto my-10 w-24 border-0 border-t border-gray-200" />
      )

    case 'cta': {
      const isPrimary = (block.style ?? 'primary') === 'primary'
      const btnClass = isPrimary
        ? 'bg-[#12BC00] text-white hover:bg-[#0fa600]'
        : 'border border-gray-300 bg-white text-gray-900 hover:border-gray-400'
      const classes = `inline-flex min-h-[44px] items-center justify-center rounded-full px-7 py-3 text-sm font-semibold transition-colors ${btnClass}`
      const isInternal = block.href.startsWith('/')
      return (
        <div className="my-8 flex justify-center">
          {isInternal ? (
            <Link href={block.href} className={classes}>
              {block.label}
            </Link>
          ) : (
            <a
              href={block.href}
              target="_blank"
              rel="noopener noreferrer"
              className={classes}
            >
              {block.label}
            </a>
          )}
        </div>
      )
    }

    case 'embed': {
      if (block.provider !== 'youtube') return null
      const embedUrl = youtubeEmbedUrl(block.url)
      if (!embedUrl) return null
      return (
        <figure className="my-8">
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
            <iframe
              src={embedUrl}
              title={block.caption ?? 'YouTube video'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
          {block.caption && (
            <figcaption className="mt-2 text-center text-sm italic text-gray-500">
              {block.caption}
            </figcaption>
          )}
        </figure>
      )
    }

    default:
      return null
  }
}
