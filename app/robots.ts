import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Private/transactional paths kept out of every crawler's index.
const DISALLOW = ["/admin", "/api/", "/account", "/checkout", "/order-confirmation"];

// AI search crawlers we explicitly welcome (GEO) — being crawlable is a
// prerequisite for being cited by ChatGPT, Perplexity, Gemini, Copilot & Claude.
const AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "CCBot",
  "cohere-ai",
  "Meta-ExternalAgent",
  "Amazonbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      { userAgent: AI_BOTS, allow: "/", disallow: DISALLOW },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
