import LegalLayout from "@/components/LegalLayout";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Brand Protection & Intellectual Property",
  description:
    "Trademark, user-generated content, and prohibited-activity terms for the Nutripanda brand.",
  path: "/brand-protection",
});

export default function BrandProtectionPage() {
  return (
    <LegalLayout
      title="Brand Protection & Intellectual Property"
      lastUpdated="June 2025"
    >
      <section>
        <h2>6.1 Trademark Notice</h2>
        <p>
          &ldquo;Nutripanda&rdquo;, the panda logo, and associated packaging trade dress are
          proprietary to Nutripanda Life Care. Use of these marks without written permission
          is prohibited. Impersonation of Nutripanda on any platform (social media,
          marketplace, website) will be reported under India&rsquo;s IT Rules 2021 and pursued
          under applicable trademark law.
        </p>
      </section>

      <section>
        <h2>6.2 User-Generated Content</h2>
        <p>
          By tagging @nutripanda_og or using #Nutripanda in social media posts, you grant
          Nutripanda Life Care a non-exclusive, royalty-free licence to repost and feature
          your content for marketing purposes, with attribution. You can withdraw this licence
          at any time by DM.
        </p>
      </section>

      <section>
        <h2>6.3 Prohibited Activities</h2>
        <ul>
          <li>Reselling Nutripanda products at a premium without authorisation.</li>
          <li>Creating counterfeit or look-alike products using the Nutripanda name or packaging.</li>
          <li>Scraping product data, pricing, or formulation information for commercial use.</li>
          <li>Publishing false or defamatory statements about Nutripanda or its products.</li>
        </ul>
      </section>
    </LegalLayout>
  );
}
