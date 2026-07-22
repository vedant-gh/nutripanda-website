import Image from 'next/image'
import Link from 'next/link'
import type { BlogPost } from '@/types/blog'

function formatDate(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}

export default function BlogCard({ post }: { post: BlogPost }) {
  const chip = post.category ?? post.tags?.[0] ?? null
  const date = formatDate(post.published_at)

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#DCFDCC]">
        {post.cover_image_url ? (
          <Image
            src={post.cover_image_url}
            alt={post.title}
            fill
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-heading text-2xl font-bold text-[#12BC00]/60">
              NutriPanda
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        {chip && (
          <span className="mb-3 inline-flex w-fit items-center rounded-full bg-[#DCFDCC] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-800">
            {chip}
          </span>
        )}

        <h3 className="font-heading text-lg font-bold leading-snug tracking-tight text-gray-900 transition-colors group-hover:text-[#12BC00]">
          {post.title}
        </h3>

        {post.excerpt && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-500">
            {post.excerpt}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
          {date && <span>{date}</span>}
          {date && post.reading_time ? <span aria-hidden="true">·</span> : null}
          {post.reading_time ? <span>{post.reading_time} min read</span> : null}
        </div>
      </div>
    </Link>
  )
}
