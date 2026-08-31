import {
  SITE_URL,
  SITE_NAME,
  LEGAL_NAME,
  SITE_DESCRIPTION,
  CONTACT_EMAIL,
} from "@/lib/seo";
import {
  getAllProducts,
  getComingSoonProducts,
  getPublishedBlogPosts,
} from "@/lib/supabase/queries";
import { formatPrice } from "@/lib/utils/format";

// /llms.txt — a concise, machine-readable overview for AI crawlers
// (ChatGPT, Perplexity, Gemini, Claude). Spec: https://llmstxt.org
export const revalidate = 3600;

function oneLine(value: string | null | undefined): string {
  return (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function markdownLabel(value: string): string {
  return oneLine(value).replace(/[\\\[\]]/g, "\\$&");
}

export async function GET() {
  const lines: string[] = [];

  lines.push(`# ${SITE_NAME}`);
  lines.push("");
  lines.push(`> ${SITE_DESCRIPTION}`);
  lines.push("");
  lines.push(
    `${SITE_NAME} (operated by ${LEGAL_NAME}) is an Indian direct-to-consumer wellness brand selling daily nutrition gummies. All products are 100% vegan (pectin-based, no gelatin), FSSAI-compliant, gluten-free, and made without added sugar. NutriPanda ships across India with free delivery on prepaid orders and a 30-day satisfaction guarantee.`
  );
  lines.push("");

  try {
    const [active, coming, posts] = await Promise.all([
      getAllProducts(),
      getComingSoonProducts(),
      getPublishedBlogPosts(),
    ]);

    if (active.length) {
      lines.push("## Products (available now)");
      for (const p of active) {
        const desc = oneLine(p.short_description ?? p.description);
        lines.push(
          `- [${markdownLabel(p.name)}](${SITE_URL}/products/${encodeURIComponent(p.slug)}): ${desc} Price: ${formatPrice(
            p.price
          )}.`
        );
      }
      lines.push("");
    }

    if (coming.length) {
      lines.push("## Products (coming soon)");
      for (const p of coming) {
        lines.push(
          `- [${markdownLabel(p.name)}](${SITE_URL}/products/${encodeURIComponent(p.slug)}): ${oneLine(p.short_description)}`.trim()
        );
      }
      lines.push("");
    }

    if (posts.length) {
      lines.push("## Blog / Journal");
      for (const post of posts) {
        lines.push(
          `- [${markdownLabel(post.title)}](${SITE_URL}/blog/${encodeURIComponent(post.slug)}): ${oneLine(post.excerpt)}`.trim()
        );
      }
      lines.push("");
    }
  } catch (err) {
    console.error("llms.txt: failed to load dynamic content", err);
  }

  lines.push("## Company & policies");
  lines.push(`- [About NutriPanda](${SITE_URL}/about)`);
  lines.push(`- [Shipping policy](${SITE_URL}/shipping)`);
  lines.push(`- [Returns & refunds](${SITE_URL}/returns)`);
  lines.push(`- [Privacy policy](${SITE_URL}/privacy)`);
  lines.push(`- [Terms & conditions](${SITE_URL}/terms)`);
  lines.push("");
  lines.push("## Contact");
  lines.push(`- Email: ${CONTACT_EMAIL}`);
  lines.push(`- Website: ${SITE_URL}`);
  lines.push(`- Instagram: https://instagram.com/nutripanda_og`);
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
