# SEO Audit Report: NutriPanda

**URL:** https://nutripanda.netlify.app
**Date:** 2026-03-23
**Industry Detected:** E-commerce (Nutrition Supplements)
**Site Status:** Pre-launch (Coming Soon page active via middleware gate)

---

## SEO Health Score: 27/100

| Category | Weight | Score | Weighted |
|---|---|---|---|
| Technical SEO | 22% | 31 | 6.8 |
| Content Quality (E-E-A-T) | 23% | 28 | 6.4 |
| On-Page SEO | 20% | 25 | 5.0 |
| Schema / Structured Data | 10% | 15 | 1.5 |
| Performance (CWV) | 10% | 55 | 5.5 |
| AI Search Readiness (GEO) | 10% | 18 | 1.8 |
| Images | 5% | 38 | 1.9 |
| **Total** | | | **27** |

---

## The #1 Blocker

**`middleware.ts` redirects ALL routes to `/` except `/api/*`.** Googlebot, GPTBot, ClaudeBot, and every crawler sees only the 40-word "Coming Soon" page. Product pages, about page, FAQs, JSON-LD -- all invisible. **Nothing else matters until this is fixed.**

---

## Prioritized Action Plan

### CRITICAL -- Blocks indexing (fix immediately)

| # | Issue | File | Detail |
|---|---|---|---|
| 1 | Middleware blocks all public pages | `middleware.ts:4` | `ALLOWED = ['/', '/api']` -- crawlers can't reach `/products`, `/about`, `/products/[slug]` |
| 2 | No `robots.txt` | Missing `app/robots.ts` | No crawl directives, no sitemap reference |
| 3 | No `sitemap.xml` | Missing `app/sitemap.ts` | Google Search Console can't discover pages |
| 4 | No canonical URLs | `app/layout.tsx` | No `metadataBase`, no `alternates.canonical` -- duplicate content risk between `nutripanda.netlify.app` and `nutripanda.in` |
| 5 | Source images massively oversized | `public/assets/` | 12.9 MB total PNG files -- `green-gummy.png` is 2.2 MB displayed at 100px |

### HIGH -- Significant ranking impact (fix within 1 week)

| # | Issue | File | Detail |
|---|---|---|---|
| 6 | No Organization/WebSite JSON-LD | `app/layout.tsx` | No brand entity signal for knowledge panels |
| 7 | No security headers | `next.config.ts` / `netlify.toml` | Missing HSTS, X-Frame-Options, CSP, etc. |
| 8 | Generic title & meta description | `app/layout.tsx` | "Premium Health Supplements" -- no differentiator, no India keywords |
| 9 | No og:* or twitter:* meta tags | `app/layout.tsx` | Zero social sharing optimization |
| 10 | Missing FSSAI license, legal pages | Codebase-wide | No privacy policy, terms, refund policy -- required by Indian e-commerce law |
| 11 | No expert credentials (YMYL) | Codebase-wide | Health supplement site with zero nutritionist/scientist attribution |
| 12 | No `llms.txt` | Missing `public/llms.txt` | AI crawlers have no structured brand summary |
| 13 | FloatingGummies missing alt text | `components/FloatingGummies.tsx` | 4 product images with `alt=""` on the live page |
| 14 | Social links are placeholders | Footer component | Instagram, Twitter, Facebook all point to `#` |
| 15 | No AVIF support | `next.config.ts` | Missing `formats: ['image/avif', 'image/webp']` |

### MEDIUM -- Optimization opportunity (fix within 1 month)

| # | Issue | File | Detail |
|---|---|---|---|
| 16 | Product JSON-LD incomplete | `app/products/[slug]/page.tsx` | Missing `sku`, `url`, `category`, `aggregateRating`, `shippingDetails` |
| 17 | No BreadcrumbList schema | Product pages | No breadcrumb structured data |
| 18 | No FAQPage schema | `components/FAQSection.tsx` | 5 Q&A pairs exist but no JSON-LD (valuable for AI citations) |
| 19 | FAQ section is client-rendered | `components/FAQSection.tsx` | `"use client"` -- crawlers may not see FAQ content |
| 20 | No trailing slash policy | `next.config.ts` | `trailingSlash` not set -- inconsistent URL indexing |
| 21 | `/checkout`, `/order-confirmation` need noindex | Checkout pages | Client-rendered transactional pages shouldn't be indexed |
| 22 | `/products` page missing metadata | `app/products/page.tsx` | Falls back to generic root layout title/description |
| 23 | No NAP (Name/Address/Phone) | Footer | Hurts local SEO and AI entity recognition |
| 24 | Hero/contact images missing `sizes` | `HeroSection.tsx`, `ContactSection.tsx` | Browser may download oversized images |
| 25 | ClientProviders too heavy | `components/ClientProviders.tsx` | Cart, coupon, toaster hydrate on every page even when unneeded |

### LOW -- Nice to have (backlog)

| # | Issue | Detail |
|---|---|---|
| 26 | No IndexNow implementation | Instant indexing on product changes |
| 27 | No blog/educational content | Needed for topical authority in nutrition space |
| 28 | Custom fonts missing `font-display: swap` verification | Risk of FOIT on slow mobile connections |
| 29 | Unused image files to delete | `panda-sitting-old.png`, default Next.js SVGs |
| 30 | No `<article>` semantic HTML | Content sections lack semantic markup for AI parsers |

---

## Category Deep Dives

### 1. Technical SEO: 31/100

#### Crawlability: 15/100

- **[CRITICAL]** No `robots.txt` file exists. No `app/robots.ts` file found in the codebase. Search engines have no crawl directives.
- **[CRITICAL]** No `sitemap.xml` or `app/sitemap.ts` exists. Google Search Console cannot discover pages automatically.
- **[CRITICAL]** Middleware (`middleware.ts`) redirects ALL routes except `/` and `/api/*` to `/` unless a `?preview=true` cookie is set. This means Googlebot cannot crawl `/products`, `/about`, `/products/[slug]`, `/checkout`, or any other page. Every crawl attempt hits a 307 redirect to `/`.
- **[HIGH]** Internal links on the coming-soon page are minimal (only one Instagram link). No internal navigation structure is crawlable.
- **[LOW]** The `ALLOWED` whitelist in middleware is overly restrictive for SEO; even when the site launches, this middleware pattern needs to be removed or updated.

**Recommendations:**
1. Create `app/robots.ts` exporting a `robots()` function with `sitemap` reference, `allow: /`, and `disallow: /api/`, `/checkout/`, `/order-confirmation/`.
2. Create `app/sitemap.ts` that dynamically generates entries from Supabase product slugs.
3. Before launch, remove or update the middleware redirect so that all public pages are accessible to crawlers.

#### Indexability: 20/100

- **[CRITICAL]** All routes serve identical content (the coming-soon page) due to middleware redirects. This creates massive duplicate content -- every URL resolves to the same page.
- **[CRITICAL]** No canonical URL (`<link rel="canonical">`) is set in `app/layout.tsx` or on any page. The `metadata` export in `layout.tsx` has no `metadataBase` or `alternates.canonical` configuration.
- **[HIGH]** No `metadataBase` is set in the root layout. Without this, relative OG image URLs will not resolve correctly when the site launches.
- **[MEDIUM]** The `/checkout` and `/order-confirmation` pages are client-rendered (`'use client'`) and have no `metadata` export, meaning they use the global fallback title/description. These should have `noindex` directives.
- **[MEDIUM]** The `/products` listing page has no `generateMetadata` or static `metadata` export -- it falls back to the generic global metadata.

**Recommendations:**
1. Add `metadataBase: new URL('https://nutripanda.in')` to root layout metadata.
2. Add `alternates: { canonical: '/' }` (or page-specific canonical) to each page's metadata.
3. Add `robots: { index: false, follow: false }` metadata to `/checkout` and `/order-confirmation` pages.
4. Add a `metadata` export to `/products/page.tsx` with a unique title and description.

#### Security: 45/100

- **[PASS]** HTTPS is active via Netlify's automatic SSL.
- **[HIGH]** No security headers configured in `next.config.ts` or `netlify.toml`. Missing: `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`.
- **[LOW]** External link to Instagram uses `rel="noopener noreferrer"` correctly.

**Recommendations:**
1. Add security headers to `netlify.toml` or via `next.config.ts` `headers()` configuration:
   - `X-Frame-Options: DENY`
   - `X-Content-Type-Options: nosniff`
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

#### URL Structure: 70/100

- **[PASS]** Clean, readable slug-based URLs for products (`/products/immunity-support-gummies`).
- **[PASS]** No query parameters used for content pages.
- **[PASS]** No `.html` extensions or numeric IDs in URLs.
- **[MEDIUM]** No trailing slash configuration in `next.config.ts` (`trailingSlash` is not set). This can cause inconsistent URL indexing.
- **[LOW]** The `?preview=true` query parameter could be indexed if Googlebot encounters it.

**Recommendations:**
1. Set `trailingSlash: false` (or `true`) explicitly in `next.config.ts` for consistency.
2. Ensure the `preview` query parameter is not leaking into indexable URLs.

#### Mobile Friendliness: 80/100

- **[PASS]** Viewport meta tag is correctly set: `width=device-width, initial-scale=1`.
- **[PASS]** Tailwind CSS with responsive breakpoints is used throughout. Mobile-first approach.
- **[PASS]** Touch-friendly target sizes (minimum 44px).
- **[MEDIUM]** The coming-soon page uses `h-dvh` with `overflow-hidden` which may cause issues on some mobile browsers with address bar transitions.
- **[LOW]** No explicit `font-display` strategy visible for custom fonts. Could cause FOIT on slow mobile connections.

#### Core Web Vitals Readiness (INP): 55/100

- **[PASS]** The home page is a Server Component. Minimal JS hydration needed.
- **[PASS]** Product detail pages are Server Components with selective client components.
- **[PASS]** Images use `next/image` with `priority` on above-the-fold assets and `sizes` attributes.
- **[HIGH]** `ClientProviders` wraps ALL pages with `PostHogProvider`, `CartDrawer`, `CouponPopup`, and `Toaster`. These hydrate on every page load even when not needed, adding unnecessary JS bundle size and INP risk.
- **[MEDIUM]** Checkout page loads Razorpay SDK via `next/script`. No lazy loading or code splitting strategy visible.
- **[MEDIUM]** `FloatingGummies` component involves CSS animations -- needs review for layout thrashing and paint cost.

**Recommendations:**
1. Conditionally render `CartDrawer` and `CouponPopup` only on pages that need them, or lazy-load with `dynamic(() => import(...), { ssr: false })`.
2. Audit `FloatingGummies` for animation performance (prefer `transform`/`opacity` over layout-triggering properties).
3. Code-split the Razorpay script to load only on checkout.

#### Structured Data: 35/100

- **[PASS]** Product detail pages include JSON-LD with `@type: Product`, including `name`, `description`, `image`, `brand`, and `offers`.
- **[CRITICAL]** Due to middleware redirects, this structured data is never accessible to crawlers on the live site.
- **[HIGH]** No `Organization` or `WebSite` structured data in the root layout.
- **[HIGH]** No `BreadcrumbList` structured data on any page.
- **[MEDIUM]** Product JSON-LD is missing `sku`, `gtin`, `url`, `review`/`aggregateRating` properties.
- **[MEDIUM]** No FAQ structured data, despite the site having FAQ content.

#### JavaScript Rendering: 65/100

- **[PASS]** Next.js App Router with Server Components. Most pages render on the server.
- **[PASS]** Product detail pages fetch data server-side via `getProductBySlug()`.
- **[PASS]** `generateMetadata` on product pages runs server-side, ensuring meta tags are in the initial HTML.
- **[HIGH]** `/checkout` and `/order-confirmation` are entirely client-rendered. If indexed, Google would see empty shells.
- **[MEDIUM]** PostHog provider wraps all content. Should verify it doesn't block rendering on failure.

#### IndexNow Protocol: 0/100

- **[LOW]** No IndexNow implementation. No API key file in `/public/`, no submission logic in the codebase.

**Recommendations:**
1. Generate an IndexNow API key and place it at `/public/<key>.txt`.
2. Add an IndexNow ping in the admin product create/update API route.

---

### 2. Content Quality (E-E-A-T): 28/100

#### Experience: 12/25

| Finding | Priority | Detail |
|---------|----------|--------|
| No first-hand product usage content | **Critical** | No customer reviews visible on live site. `TestimonialsSection` component exists but is not rendered on any accessible page. |
| About page has founder story | Medium | `app/about/page.tsx` has a "How It Started" section with personal narrative -- but blocked by middleware. |
| No blog or educational content | **High** | No blog, articles, or guides about nutrition. For a YMYL-adjacent health supplement site, this is a significant gap. |
| No UGC or community content | Medium | No user-generated content, before/after stories, or community features. |

#### Expertise: 15/25

| Finding | Priority | Detail |
|---------|----------|--------|
| No expert credentials displayed | **Critical** | No nutritionist, dietitian, or formulation scientist mentioned anywhere. For a health supplement brand, expert backing is essential. |
| Science-backed claims are vague | **High** | About page says "science-backed" and "clinically researched ingredients" but provides zero citations, studies, or specific research references. |
| Product pages have structured nutrition data | Low | `NutritionFactsPanel` and `IngredientsSection` components exist -- good foundation but needs expert attribution. |
| FSSAI certification mentioned but not substantiated | **High** | Claims of "FSSAI-certified facilities" appear but no license number, certificate image, or verifiable reference is provided. |

#### Authoritativeness: 8/25

| Finding | Priority | Detail |
|---------|----------|--------|
| No brand authority signals on live site | **Critical** | Zero content visible to crawlers. Google cannot establish any topical authority. |
| No backlink-worthy content | **Critical** | No blog, research pages, guides, or resources that could attract inbound links. |
| Social proof is minimal | **High** | Single Instagram link. Social icons in Footer all point to `#` (placeholder). |
| No press mentions, partnerships, or awards | Medium | No media coverage, brand partnerships, or industry recognition mentioned. |

#### Trustworthiness: 18/25

| Finding | Priority | Detail |
|---------|----------|--------|
| No privacy policy, terms of service, or refund policy | **Critical** | No legal/policy pages exist in the codebase. Required by Indian Consumer Protection (E-Commerce) Rules, 2020. |
| No physical address or company registration | **Critical** | No GST number, CIN, registered address, or company info anywhere. |
| No contact page exists | **High** | Footer links to `/contact` but no such route exists. |
| Payment integration is solid | Low | Razorpay integration with proper webhook verification -- good trust infrastructure. |
| HTTPS and secure checkout flow | Low | Netlify provides HTTPS. Razorpay handles PCI compliance. |
| FAQ content is decent | Medium | 5 FAQs covering ingredients, vegan status, storage, shipping, returns. |

#### Content Gaps (Priority Order)

1. **Critical -- YMYL compliance**: Health supplement site with no expert credentials, no clinical references, no FSSAI license number.
2. **Critical -- Legal pages missing**: No privacy policy, terms of service, shipping policy, or refund policy.
3. **Critical -- Zero indexable content**: Middleware blocks all pages except root. ~40 words visible.
4. **High -- No blog/educational content**: Topical authority through educational content is essential for competing against Power Gummies, Nyumi, etc.
5. **High -- No contact information**: No email, phone, physical address, or contact form accessible.
6. **High -- Social links are placeholders**: Footer social icons point to `#`.
7. **Medium -- About page content is good but inaccessible**: ~350 words of decent founder story, mission/vision. Strongest E-E-A-T content in codebase but blocked.
8. **Medium -- FAQ content is hardcoded**: Not fetched from Supabase despite DB schema supporting it.

**Note:** When middleware is removed, existing codebase content would bring this to ~45-50/100. Reaching 75+ requires expert attribution, legal pages, blog, and real reviews.

---

### 3. Schema / Structured Data: 15/100

#### Current State

**What exists:**
- A `ProductJsonLd` component in `app/products/[slug]/page.tsx` (lines 263-295) with basic `Product` schema: `name`, `description`, `image`, `brand`, `offers` (price, currency, availability, seller).

**What is completely missing:**
- Organization schema (site-wide)
- WebSite schema (site-wide)
- BreadcrumbList schema (product pages, about page)
- FAQPage schema (homepage FAQ section)
- AggregateRating / Review schema (product pages)

#### Existing Product Schema Issues

1. No `url` property
2. No `sku` property
3. No `category` property (should be "Dietary Supplements")
4. No `AggregateRating`
5. No `Review` markup
6. Missing `offers.url`
7. Missing `offers.priceValidUntil`
8. No `gtin` or `mpn`
9. No `countryOfOrigin` (relevant for "Made in India")

#### Recommended Schemas

**P0 -- Organization Schema (`app/layout.tsx`):**
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "NutriPanda",
  "url": "https://nutripanda.in",
  "logo": "https://nutripanda.in/assets/logo-main.png",
  "description": "Premium nutrition gummies made with natural ingredients, crafted in India.",
  "sameAs": ["https://instagram.com/og_nutripanda"],
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer service",
    "availableLanguage": ["English", "Hindi"]
  },
  "address": {
    "@type": "PostalAddress",
    "addressCountry": "IN"
  }
}
```

**P0 -- WebSite Schema (`app/layout.tsx`):**
```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "NutriPanda",
  "url": "https://nutripanda.in",
  "publisher": {
    "@type": "Organization",
    "name": "NutriPanda"
  }
}
```

**P1 -- Enhanced Product Schema (`app/products/[slug]/page.tsx`):**
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Immunity Support Gummies",
  "description": "...",
  "image": ["https://..."],
  "url": "https://nutripanda.in/products/immunity-support",
  "brand": { "@type": "Brand", "name": "NutriPanda" },
  "category": "Dietary Supplements",
  "countryOfOrigin": { "@type": "Country", "name": "India" },
  "offers": {
    "@type": "Offer",
    "price": "499.00",
    "priceCurrency": "INR",
    "availability": "https://schema.org/InStock",
    "url": "https://nutripanda.in/products/immunity-support",
    "seller": { "@type": "Organization", "name": "NutriPanda" },
    "shippingDetails": {
      "@type": "OfferShippingDetails",
      "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "IN" },
      "deliveryTime": {
        "@type": "ShippingDeliveryTime",
        "handlingTime": { "@type": "QuantitativeValue", "minValue": 1, "maxValue": 2, "unitCode": "d" },
        "transitTime": { "@type": "QuantitativeValue", "minValue": 3, "maxValue": 7, "unitCode": "d" }
      }
    }
  }
}
```

**P1 -- BreadcrumbList Schema (product pages):**
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://nutripanda.in" },
    { "@type": "ListItem", "position": 2, "name": "Products", "item": "https://nutripanda.in/products" },
    { "@type": "ListItem", "position": 3, "name": "Immunity Support Gummies", "item": "https://nutripanda.in/products/immunity-support" }
  ]
}
```

**P2 -- FAQPage Schema (`components/FAQSection.tsx`):**

Note: Google no longer shows FAQ rich results for most commercial sites (Aug 2023). However, FAQPage schema remains valuable for LLM/AI citation (Bing Chat, Perplexity, ChatGPT search).

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What ingredients are in your gummies?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Our gummies are crafted with premium, clinically researched ingredients..."
      }
    }
  ]
}
```

**P3 -- AggregateRating:** Only implement when real customer reviews exist. Do not fabricate ratings.

#### Score Breakdown

| Category | Max | Score |
|---|---|---|
| Organization | 20 | 0 |
| WebSite | 10 | 0 |
| Product | 30 | 10 |
| BreadcrumbList | 15 | 0 |
| FAQPage | 10 | 0 |
| Review/AggregateRating | 15 | 5 |
| **Total** | **100** | **15** |

---

### 4. Images: 38/100

#### Alt Text: 60/100

| Image | Location | Alt Text | Quality |
|---|---|---|---|
| logo-main.png | `app/page.tsx`, `Navbar.tsx` | `"NutriPanda"` | Good |
| panda-sitting-new.png | `app/page.tsx` | `"NutriPanda sitting"` | Acceptable |
| hero.png | `HeroSection.tsx` | `"NutriPanda - Nutrition Gummies"` | Good |
| bamboo.png (x2) | `HeroSection.tsx` | `""` (empty) | Correct -- decorative |
| green-gummy.png (x4) | `FloatingGummies.tsx` | `""` (empty) | **PROBLEM** -- should describe product |
| paw.png (x2) | `Footer.tsx` | `""` (empty) | Correct -- decorative |
| contact.png | `ContactSection.tsx` | `"Contact NutriPanda"` | Acceptable |
| Product images (Supabase) | `ProductCards.tsx`, `ProductHero.tsx` | `{product.name}` | Good |

- **[HIGH]** FloatingGummies `green-gummy.png` has empty alt text. These are content-bearing product visuals, not decorative. Should be `"NutriPanda nutrition gummy"`.
- **[LOW]** `panda-sitting-new.png` alt could be more descriptive for SEO.

#### Image Formats: 20/100

| File | Dimensions | Size | Format |
|---|---|---|---|
| hero.png | 1536x822 | 2.0 MB | PNG |
| green-gummy.png | 1024x1536 | 2.2 MB | PNG |
| panda-sitting-new.png | 1024x1536 | 2.1 MB | PNG |
| panda-sitting-old.png | 1024x1536 | 779 KB | PNG |
| product-demo.png | 2048x2048 | 1.5 MB | PNG |
| contact.png | 1024x1024 | 1.4 MB | PNG |
| paw.png | 885x1324 | 1.5 MB | PNG |
| bamboo.png | 483x1024 | 1.3 MB | PNG |
| logo-main.png | 2577x924 | 115 KB | PNG |

**Total local image weight: ~12.9 MB (all PNG, zero WebP/AVIF)**

- **[CRITICAL]** All images are unoptimized PNGs. No WebP or AVIF source files.
- **[CRITICAL]** `green-gummy.png` is 2.2 MB at 1024x1536 but displayed at 100x100px. 10x oversized source.
- **[CRITICAL]** `panda-sitting-new.png` is 2.1 MB at 1024x1536 but displayed at max 500px height.
- **[HIGH]** `bamboo.png` is 1.3 MB for a decorative blurred background element. Could be 50-100 KB as WebP.
- **[HIGH]** `paw.png` is 1.5 MB for a 120-200px wide decorative footer element.
- **[MEDIUM]** `logo-main.png` is 2577px wide but displayed at max 200px. Should be resized to ~400px.

**Recommendations:**
1. Convert all PNGs to WebP. Resize to 2x max display size. Expected savings: 80-90%.
2. Key targets: `green-gummy.png` (2.2 MB -> ~10 KB), `panda-sitting-new.png` (2.1 MB -> ~100 KB), `hero.png` (2.0 MB -> ~200 KB).

#### Responsive Images (sizes): 55/100

| Component | `sizes` attribute | Assessment |
|---|---|---|
| `ProductCards.tsx` | `"(max-width: 640px) 100vw, 40vw"` | Good |
| `ProductHero.tsx` main | `"(max-width: 1024px) 100vw, 50vw"` | Good |
| `ProductHero.tsx` thumbs | `"64px"` | Good |
| `CartDrawer.tsx` | `"80px"` | Good |
| `HeroSection.tsx` (fill) | **Missing** | Problem |
| `FloatingGummies.tsx` | **Missing** | Uses width/height |
| `ContactSection.tsx` | **Missing** | Problem |
| `app/page.tsx` panda | **Missing** | Problem |

#### Lazy Loading: 75/100

- **[PASS]** Above-the-fold images correctly use `priority` (hero, logo, panda mascot, product detail main image).
- **[PASS]** Below-the-fold images rely on Next.js default lazy loading.

#### CLS Prevention: 70/100

- **[PASS]** Most images have explicit `width`/`height` or `fill` with aspect-ratio containers.
- **[MEDIUM]** `ContactSection.tsx` image uses `width={600} height={600}` but styled with `h-full w-full` without fixed aspect-ratio container.

#### Next.js Image Config: 30/100

```typescript
// next.config.ts
images: {
  remotePatterns: [
    { protocol: "https", hostname: "placehold.co" },
    { protocol: "https", hostname: "**.supabase.co" },
  ],
},
```

- **[HIGH]** No `formats` configuration. Defaults to `['image/webp']` only. Adding `formats: ['image/avif', 'image/webp']` serves AVIF (30-50% smaller than WebP).
- **[MEDIUM]** No `deviceSizes` or `imageSizes` customization for mobile-heavy traffic.

---

### 5. AI Search Readiness (GEO): 18/100

#### AI Crawler Accessibility: 5/25 -- CRITICAL

- **No `robots.txt` or `app/robots.ts` exists.** AI crawlers (GPTBot, ClaudeBot, PerplexityBot) receive no explicit signal.
- **No `sitemap.xml` or `app/sitemap.ts`.**
- **No canonical URLs set.** Risk of duplicate indexing between `nutripanda.netlify.app` and `nutripanda.in`.
- **Middleware blocks all routes except `/` and `/api/*`.** AI crawlers will never see product pages, about page, or any content.

#### llms.txt Compliance: 0/10 -- HIGH

- No `public/llms.txt` file exists.
- No `llms-full.txt` either.
- The llms.txt protocol allows sites to provide a markdown summary for LLM consumption. Missing opportunity for "best nutrition gummies India" type queries.

#### Content Citability: 8/20 -- HIGH

- **Currently visible content:** ~40 words. Zero citable facts.
- **Hidden content (behind middleware):**
  - About page has citable passages: "Every gummy is made in India, in FSSAI-certified facilities", "100% vegan", "pectin instead of gelatin".
  - FAQ section has 5 well-written Q&A pairs with specific facts (free delivery above Rs 499, 30-day guarantee).
  - Product pages have nutrition facts, ingredients with amounts, trust badges.
- **Weakness:** No standalone statistics, no comparative claims, no research citations.
- **Client-side rendering issue:** FAQ section is `"use client"`. Crawlers may not execute JavaScript.

#### Brand Mention Signals: 10/15 -- MEDIUM

- "NutriPanda" used consistently across 24 files (90 occurrences).
- **Missing NAP:** No physical address or phone number anywhere.
- Social links in footer point to `#` (placeholder) except Instagram.
- No `Organization` schema to formalize brand entity.
- Domain inconsistency: `nutripanda.netlify.app` vs `nutripanda.in` with no canonical.

#### Passage-Level Optimization: 10/15 -- MEDIUM

- Heading hierarchy is good (h1 > h2 > h3).
- Paragraph length is appropriate.
- **Missing:** No `<article>` semantic markup.
- **Missing:** No definition lists (`<dl>/<dt>/<dd>`) for ingredient explanations.
- No Twitter card metadata anywhere.

#### Platform-Specific Readiness

| Platform | Readiness | Notes |
|----------|-----------|-------|
| Google AI Overviews | Very Low | No FAQ schema, middleware blocks content, no Organization schema |
| ChatGPT (GPTBot) | Very Low | Not addressed in robots.txt. Middleware redirects all content pages |
| Perplexity | Very Low | Same middleware blocking. No citable content on accessible pages |
| Bing Copilot | Very Low | Same issues |

---

## Quick Wins (highest impact, lowest effort)

1. **Remove/update middleware** -- instantly makes all pages crawlable
2. **Create `app/robots.ts`** -- 10 lines of code
3. **Create `app/sitemap.ts`** -- pull slugs from Supabase
4. **Add `metadataBase`** to root layout -- 1 line
5. **Add AVIF to `next.config.ts`** -- 1 line
6. **Add alt text to FloatingGummies** -- 1 line change

---

## Score Projection

| Scenario | Estimated Score |
|----------|----------------|
| Current (pre-launch, middleware blocking) | **27/100** |
| After removing middleware + adding robots/sitemap/canonical | **45-50/100** |
| After adding schemas + security headers + image optimization | **60-65/100** |
| After legal pages + expert credentials + blog + reviews | **75-80/100** |

---

## Files Audited

- `middleware.ts` -- the primary SEO blocker
- `app/layout.tsx` -- global metadata, missing metadataBase and canonical
- `app/page.tsx` -- homepage
- `app/about/page.tsx` -- has static metadata (good, but blocked)
- `app/products/page.tsx` -- missing metadata export
- `app/products/[slug]/page.tsx` -- has generateMetadata + Product JSON-LD (good, but blocked)
- `next.config.ts` -- minimal config, no headers/trailing slash
- `netlify.toml` -- minimal, no security headers
- `components/FloatingGummies.tsx` -- missing alt text
- `components/FAQSection.tsx` -- client-rendered FAQ, no schema
- `components/ClientProviders.tsx` -- heavy wrapper on all pages
- `components/HeroSection.tsx` -- hero image missing sizes
- `components/ContactSection.tsx` -- contact image missing sizes
- `components/Footer.tsx` -- placeholder social links
- `public/assets/` -- oversized PNG images (12.9 MB total)
