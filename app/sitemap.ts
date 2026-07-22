import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import {
  getAllProducts,
  getComingSoonProducts,
  getPublishedBlogPosts,
} from "@/lib/supabase/queries";

// Regenerate at most hourly so new products/posts appear without a redeploy.
export const revalidate = 3600;

const STATIC_ROUTES: {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}[] = [
  { path: "", changeFrequency: "daily", priority: 1.0 },
  { path: "/products", changeFrequency: "daily", priority: 0.9 },
  { path: "/blog", changeFrequency: "weekly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/shipping", changeFrequency: "yearly", priority: 0.3 },
  { path: "/returns", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/grievance", changeFrequency: "yearly", priority: 0.2 },
  { path: "/brand-protection", changeFrequency: "yearly", priority: 0.2 },
  { path: "/creator-terms", changeFrequency: "yearly", priority: 0.2 },
  { path: "/subscription", changeFrequency: "yearly", priority: 0.2 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // Live product + blog URLs. Never let a DB hiccup break the whole sitemap.
  try {
    const [active, coming, posts] = await Promise.all([
      getAllProducts(),
      getComingSoonProducts(),
      getPublishedBlogPosts(),
    ]);

    const productSlugs = new Map<string, string>();
    for (const p of [...active, ...coming]) {
      productSlugs.set(p.slug, p.updated_at ?? p.created_at);
    }

    const productEntries: MetadataRoute.Sitemap = [...productSlugs].map(
      ([slug, updated]) => ({
        url: `${SITE_URL}/products/${slug}`,
        lastModified: updated ? new Date(updated) : now,
        changeFrequency: "weekly",
        priority: 0.8,
      })
    );

    const postEntries: MetadataRoute.Sitemap = posts.map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}`,
      lastModified: new Date(post.updated_at ?? post.published_at ?? now),
      changeFrequency: "monthly",
      priority: 0.6,
    }));

    return [...staticEntries, ...productEntries, ...postEntries];
  } catch (err) {
    console.error("sitemap: failed to load dynamic routes", err);
    return staticEntries;
  }
}
