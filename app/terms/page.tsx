import LegalLayout from "@/components/LegalLayout";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Terms & Conditions",
  description:
    "Terms & Conditions of use for nutripanda.in, operated by Nutripanda Life Care.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms & Conditions of Use"
      lastUpdated="June 2025"
      intro="These Terms govern all use of nutripanda.in and the purchase of Nutripanda products. By accessing or purchasing from this Website, you agree to be legally bound by the terms set out below. Read each section carefully before placing an order."
    >
      <section>
        <h2>1.1 About Us</h2>
        <p>
          nutripanda.in (&ldquo;Website&rdquo;) is owned and operated by Nutripanda Life
          Care, a D2C functional gummy supplement brand headquartered in Jaipur, Rajasthan,
          India. By accessing or purchasing from this Website, you agree to be legally bound
          by the terms set out below.
        </p>
      </section>

      <section>
        <h2>1.2 Acceptance of Terms</h2>
        <p>By browsing, registering, or placing an order on this Website, you confirm that:</p>
        <ul>
          <li>You are at least 18 years of age or accessing under the supervision of a parent/guardian.</li>
          <li>You have read, understood, and agreed to these Terms and all other policies on this page.</li>
          <li>All information you provide is accurate and current.</li>
          <li>You are purchasing for personal, non-commercial use unless expressly authorised otherwise.</li>
        </ul>
      </section>

      <section>
        <h2>1.3 Intellectual Property</h2>
        <p>
          All content on this Website — including the Nutripanda brand name, panda logo,
          hexagonal packaging design, product names, photography, copy, ingredient
          descriptions, CoA QR references, and blog content — is the exclusive intellectual
          property of Nutripanda Life Care. Unauthorised reproduction, re-upload, or
          commercial use is prohibited and will be pursued under Indian IP law.
        </p>
      </section>

      <section>
        <h2>1.4 Invitation to Offer</h2>
        <p>
          Product listings on nutripanda.in constitute an invitation to offer, not a binding
          offer by Nutripanda. Your order is an offer that Nutripanda accepts only upon
          dispatch confirmation. We reserve the right to cancel any order before dispatch
          without providing a reason, with a full refund.
        </p>
      </section>

      <section>
        <h2>1.5 Product Accuracy</h2>
        <p>
          We make every effort to display product images, ingredient lists, and nutrition
          information accurately. Minor colour variations may exist due to screen
          calibration. If there is any discrepancy between the website and the physical
          product label (arising from a formulation update), the physical label governs.
        </p>
      </section>

      <section>
        <h2>1.6 FSSAI Health Claim Disclaimer</h2>
        <p>
          <strong>IMPORTANT:</strong> Nutripanda products are food supplements registered
          under FSSAI. They are not drugs and are not intended to diagnose, treat, cure, or
          prevent any disease or medical condition. All ingredient benefits cited are backed
          by published research (&ldquo;research-backed ingredients&rdquo;), not by
          individual product clinical trials. Consult a qualified physician before use if you
          are pregnant, nursing, under 18, or on prescription medication.
        </p>
        <p>
          This disclaimer is mandatory under FSSAI Food Safety and Standards (Health
          Supplements, Nutraceuticals, Food for Special Dietary Use, Food for Special Medical
          Purpose, Functional Food and Novel Food) Regulations, 2022.
        </p>
      </section>

      <section>
        <h2>1.7 Third-Party CoA Transparency</h2>
        <p>
          Every Nutripanda pack carries a QR code linking to its batch-specific Certificate
          of Analysis (CoA) from an NABL-accredited third-party lab. This CoA is provided for
          informational transparency. Results represent the tested batch only and are not a
          guarantee of identical results for every unit in a large production run.
        </p>
      </section>

      <section>
        <h2>1.8 Limitation of Liability</h2>
        <p>
          To the maximum extent permitted under Indian law, Nutripanda Life Care&rsquo;s
          liability is limited to the purchase price of the specific product in question. We
          are not liable for indirect, incidental, or consequential damages arising from
          product use.
        </p>
      </section>

      <section>
        <h2>1.9 Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Nutripanda Life Care, its founders,
          employees, and agents against any claims, losses, or liabilities arising from:
          misuse of products contrary to label instructions; breach of these Terms; or
          provision of false information during purchase.
        </p>
      </section>

      <section>
        <h2>1.10 Governing Law &amp; Jurisdiction</h2>
        <p>
          These Terms are governed by the laws of India. Any disputes shall be subject to the
          exclusive jurisdiction of courts in Jaipur, Rajasthan, India.
        </p>
      </section>
    </LegalLayout>
  );
}
