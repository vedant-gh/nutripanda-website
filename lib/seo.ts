// Central SEO/GEO constants + JSON-LD builders for NutriPanda.
// Used by the root layout, robots, sitemap, llms.txt and page-level metadata.

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://nutripanda.in'
).replace(/\/+$/, '')

export const SITE_NAME = 'NutriPanda'
export const LEGAL_NAME = 'Nutripanda Life Care'
export const CONTACT_EMAIL = 'contact@nutripanda.in'
export const TAGLINE = 'Nutrition that fits your lifestyle.'

export const SITE_DESCRIPTION =
  'NutriPanda makes premium daily-wellness gummies in India — 100% vegan, FSSAI-compliant, and formulated with clinically-researched vitamins and minerals, with no added sugar. Free shipping on prepaid orders and a 30-day satisfaction guarantee.'

export const KEYWORDS = [
  'nutrition gummies India',
  'vegan vitamin gummies',
  'immunity gummies',
  'daily wellness supplements',
  'sugar-free gummies',
  'FSSAI certified gummies',
  'skin care gummies',
  'NutriPanda',
]

// Social / authority profiles (Organization sameAs).
export const SAME_AS = ['https://instagram.com/nutripanda_og']

// Default social-share image. A dedicated 1200×630 og-image is ideal; the hero
// is used as a sensible fallback until one is designed.
export const DEFAULT_OG_IMAGE = `${SITE_URL}/assets/hero.png`
export const LOGO_URL = `${SITE_URL}/assets/logo-main.png`

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path = ''): string {
  if (!path) return SITE_URL
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

// ── Site-wide JSON-LD ──

export const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: SITE_NAME,
  legalName: LEGAL_NAME,
  url: SITE_URL,
  logo: LOGO_URL,
  image: DEFAULT_OG_IMAGE,
  description: SITE_DESCRIPTION,
  email: CONTACT_EMAIL,
  slogan: TAGLINE,
  sameAs: SAME_AS,
  areaServed: { '@type': 'Country', name: 'India' },
  address: {
    '@type': 'PostalAddress',
    addressCountry: 'IN',
    addressRegion: 'Rajasthan',
  },
  contactPoint: {
    '@type': 'ContactPoint',
    email: CONTACT_EMAIL,
    contactType: 'customer support',
    areaServed: 'IN',
    availableLanguage: ['English', 'Hindi'],
  },
} as const

export const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: 'en-IN',
  publisher: { '@id': `${SITE_URL}/#organization` },
} as const
