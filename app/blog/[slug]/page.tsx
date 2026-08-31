import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import BlockRenderer from '@/components/blog/BlockRenderer'
import BlogCard from '@/components/blog/BlogCard'
import {
  getBlogPostBySlug,
  getRelatedBlogPosts,
} from '@/lib/supabase/queries'
import { absoluteUrl, SITE_NAME, SITE_URL } from '@/lib/seo'

// Always render from the live database so edits/publishing show immediately.
export const dynamic = 'force-dynamic'

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await getBlogPostBySlug(slug)

  if (!post) {
    return {
      title: { absolute: 'Article not found | NutriPanda Journal' },
      robots: { index: false, follow: false },
    }
  }

  const title = post.seo_title ?? post.title
  const browserTitle = /nutripanda/i.test(title) ? title : `${title} | NutriPanda`
  const description =
    post.seo_description ??
    post.excerpt ??
    `Read ${post.title} in the NutriPanda Journal.`
  const canonical = absoluteUrl(`/blog/${encodeURIComponent(post.slug)}`)
  const images = post.cover_image_url
    ? [{ url: post.cover_image_url, alt: post.title }]
    : undefined

  return {
    title: { absolute: browserTitle },
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: 'article',
      locale: 'en_IN',
      url: canonical,
      siteName: SITE_NAME,
      images: images?.map((image) => image.url),
      ...(post.published_at ? { publishedTime: post.published_at } : {}),
      ...(post.updated_at ? { modifiedTime: post.updated_at } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images,
    },
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = await getBlogPostBySlug(slug)

  if (!post) {
    notFound()
  }

  const related = await getRelatedBlogPosts(slug, 3)
  const date = formatDate(post.published_at)
  const chip = post.category ?? post.tags?.[0] ?? null

  const postUrl = absoluteUrl(`/blog/${encodeURIComponent(post.slug)}`)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    inLanguage: 'en-IN',
    mainEntityOfPage: { '@type': 'WebPage', '@id': postUrl },
    url: postUrl,
    ...(post.excerpt ? { description: post.excerpt } : {}),
    ...(post.cover_image_url ? { image: [post.cover_image_url] } : {}),
    ...(post.published_at ? { datePublished: post.published_at } : {}),
    ...(post.updated_at ? { dateModified: post.updated_at } : {}),
    author: post.author
      ? { '@type': 'Person', name: post.author }
      : { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/assets/logo-main.png`,
      },
    },
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: postUrl },
    ],
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, '\\u003c'),
        }}
      />

      <article className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 sm:pb-24 lg:px-8">
        {/* Back link */}
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
          Back to the Journal
        </Link>

        {/* Category / tags */}
        {(chip || (post.tags && post.tags.length > 0)) && (
          <div className="mt-8 flex flex-wrap items-center gap-2">
            {chip && (
              <span className="inline-flex items-center rounded-full bg-[#DCFDCC] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-800">
                {chip}
              </span>
            )}
          </div>
        )}

        {/* Title */}
        <h1 className="font-heading mt-4 text-3xl font-bold leading-[1.1] tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
          {post.title}
        </h1>

        {post.excerpt && (
          <p className="mt-4 text-lg leading-relaxed text-gray-500">
            {post.excerpt}
          </p>
        )}

        {/* Meta row */}
        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-400">
          {post.author && (
            <span className="font-medium text-gray-600">{post.author}</span>
          )}
          {post.author && date ? <span aria-hidden="true">·</span> : null}
          {date && <span>{date}</span>}
          {(post.author || date) && post.reading_time ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {post.reading_time ? <span>{post.reading_time} min read</span> : null}
        </div>

        {/* Cover image */}
        {post.cover_image_url && (
          <div className="relative mt-8 aspect-[16/9] w-full overflow-hidden rounded-2xl bg-[#DCFDCC] sm:mt-10">
            <Image
              src={post.cover_image_url}
              alt={post.title}
              fill
              priority
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
            />
          </div>
        )}

        {/* Body */}
        <div className="mt-10">
          <BlockRenderer blocks={post.content} />
        </div>

        {/* Tags footer */}
        {post.tags && post.tags.length > 0 && (
          <div className="mt-12 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-8">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </article>

      {/* Related reading */}
      {related.length > 0 && (
        <section className="border-t border-gray-100 bg-[#f7fdf6]">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <h2 className="font-heading mb-8 text-2xl font-bold tracking-tight text-gray-900 sm:mb-10 sm:text-3xl">
              Related reading
            </h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-7 lg:grid-cols-3">
              {related.map((p) => (
                <BlogCard key={p.id} post={p} />
              ))}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </div>
  )
}
