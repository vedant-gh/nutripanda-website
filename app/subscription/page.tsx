import LegalLayout from "@/components/LegalLayout";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Subscription Terms",
  description:
    "Subscription terms for Nutripanda — a future feature. Details will be published here at launch.",
  path: "/subscription",
});

export default function SubscriptionPage() {
  return (
    <LegalLayout title="Subscription Terms" lastUpdated="June 2025">
      <section>
        <h2>Future Feature</h2>
        <p>
          Nutripanda does not currently offer a subscription model. When launched,
          subscription terms including billing cycle, pause/cancel rights, and price lock
          policies will be detailed here. Subscribers will be notified 7 days before any price
          change.
        </p>
      </section>
    </LegalLayout>
  );
}
