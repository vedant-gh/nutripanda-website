// Compatibility export for existing page imports. The implementation lives in
// lib/seo.ts so URL, canonical, and social metadata logic has one source of truth.
export {
  absoluteUrl,
  buildPageMetadata,
  DEFAULT_SOCIAL_IMAGE,
  SITE_NAME,
  SITE_URL,
} from '@/lib/seo'
export type { PageMetadataOptions, SocialImage } from '@/lib/seo'
