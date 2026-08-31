import LegalLayout from "@/components/LegalLayout";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Creator & Influencer Partnership Terms",
  description:
    "Disclosure requirements and partnership terms for creators and influencers working with Nutripanda.",
  path: "/creator-terms",
});

export default function CreatorTermsPage() {
  return (
    <LegalLayout
      title="Creator & Influencer Partnership Terms"
      lastUpdated="June 2025"
    >
      <section>
        <h2>7.1 Disclosure Requirement</h2>
        <p>
          All creators (paid, gifted, or equity-partner) promoting Nutripanda must comply with
          ASCI&rsquo;s Influencer Advertising Guidelines (2021). Posts must include #ad or
          #gifted or #partner as applicable. Claims about product efficacy must align with
          approved messaging. Creators may not make disease-cure claims.
        </p>
      </section>

      <section>
        <h2>7.2 Equity Partnership</h2>
        <p>
          Equity partnerships are governed by separate signed agreements (Vesting Agreement +
          Brand Ambassador Agreement). These website terms do not override or supersede those
          agreements.
        </p>
      </section>

      <section>
        <h2>7.3 Affiliate / Referral</h2>
        <p>
          Affiliate and referral terms (commission rate, cookie duration, minimum payout
          threshold) will be published here when the programme launches.
        </p>
      </section>
    </LegalLayout>
  );
}
