import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import BlogCard from '@/components/blog/BlogCard'
import { getPublishedBlogPosts } from '@/lib/supabase/queries'
import type { BlogPost } from '@/types/blog'

// Always render from the live database so newly published posts appear immediately.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'The NutriPanda Journal — Nutrition, Gummies & Everyday Wellness',
  description:
    'Science-backed, easy-to-read stories on nutrition, immunity, and everyday wellness from the team at NutriPanda.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'The NutriPanda Journal',
    description:
      'Science-backed, easy-to-read stories on nutrition, immunity, and everyday wellness from the team at NutriPanda.',
    type: 'website',
    url: '/blog',
    siteName: 'NutriPanda',
  },
}

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

function FeaturedHero({ post }: { post: BlogPost }) {
  const chip = post.category ?? post.tags?.[0] ?? null
  const date = formatDate(post.published_at)

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group grid overflow-hidden rounded-3xl border border-gray-200 bg-white transition-shadow hover:shadow-lg lg:grid-cols-2"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#DCFDCC] lg:aspect-auto lg:min-h-[380px]">
        {post.cover_image_url ? (
          <Image
            src={post.cover_image_url}
            alt={post.title}
            fill
            priority
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-heading text-4xl font-bold text-[#12BC00]/60">
              NutriPanda
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col justify-center p-6 sm:p-10">
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-[#12BC00] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
            Featured
          </span>
          {chip && (
            <span className="inline-flex items-center rounded-full bg-[#DCFDCC] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-800">
              {chip}
            </span>
          )}
        </div>

        <h2 className="font-heading text-2xl font-bold leading-tight tracking-tight text-gray-900 transition-colors group-hover:text-[#12BC00] sm:text-3xl lg:text-4xl">
          {post.title}
        </h2>

        {post.excerpt && (
          <p className="mt-4 line-clamp-3 text-base leading-relaxed text-gray-500">
            {post.excerpt}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-400">
          {date && <span>{date}</span>}
          {date && post.reading_time ? <span aria-hidden="true">·</span> : null}
          {post.reading_time ? <span>{post.reading_time} min read</span> : null}
        </div>

        <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[#12BC00]">
          Read article
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </span>
      </div>
    </Link>
  )
}

export default async function BlogIndexPage() {
  const posts = await getPublishedBlogPosts()

  const featured =
    posts.find((p) => p.is_featured) ?? posts[0] ?? null
  const rest = featured
    ? posts.filter((p) => p.id !== featured.id)
    : posts

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* Hero band */}
      <section className="bg-[#f7fdf6]">
        <div className="mx-auto max-w-7xl px-4 pt-10 pb-12 sm:px-6 sm:pt-14 sm:pb-16 lg:px-8">
          <nav className="mb-6 text-xs text-gray-400 sm:text-sm">
            <Link href="/" className="transition-colors hover:text-gray-600">
              Home
            </Link>
            <span className="mx-2">/</span>
            <span className="text-gray-700">Journal</span>
          </nav>

          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#DCFDCC] px-4 py-1.5">
            <span className="text-xs font-semibold tracking-wide text-gray-800">
              The NutriPanda Journal
            </span>
          </div>

          <h1 className="font-heading text-4xl font-bold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            Wellness,
            <br />
            <span className="text-[#12BC00]">made simple.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-gray-500 sm:text-lg">
            Science-backed, easy-to-read stories on nutrition, immunity, and the
            small daily habits that add up. No jargon, no hype — just good stuff.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        {posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-[#fafafa] py-20 text-center">
            <p className="font-heading text-xl font-bold text-gray-900">
              Nothing here yet
            </p>
            <p className="mt-2 text-sm text-gray-500">
              We are writing our first stories. Check back soon.
            </p>
            <Link
              href="/products"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full bg-[#12BC00] px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0fa600]"
            >
              Shop the range
            </Link>
          </div>
        ) : (
          <>
            {featured && (
              <div className="mb-14 sm:mb-20">
                <FeaturedHero post={featured} />
              </div>
            )}

            {rest.length > 0 && (
              <>
                <div className="mb-8 sm:mb-10">
                  <h2 className="font-heading text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
                    Latest stories
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-7 lg:grid-cols-3">
                  {rest.map((post) => (
                    <BlogCard key={post.id} post={post} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}
