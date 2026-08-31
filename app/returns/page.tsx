import LegalLayout from "@/components/LegalLayout";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Return, Refund & Replacement Policy",
  description:
    "Eligibility, claim process, refunds, and cancellation terms for Nutripanda orders.",
  path: "/returns",
});

export default function ReturnsPage() {
  return (
    <LegalLayout
      title="Return, Refund & Replacement Policy"
      lastUpdated="June 2025"
      intro="We built Nutripanda on honesty — and our return policy reflects the same. Here is exactly what we can and cannot do."
    >
      <section>
        <h2>4.1 Our Transparency Pledge</h2>
        <p>
          Nutripanda was built on honesty — from our ingredient doses to our CoAs. Our return
          policy reflects the same: we tell you exactly what we can and cannot do.
        </p>
      </section>

      <section>
        <h2>4.2 Eligibility for Return / Replacement</h2>
        <p>We accept return or replacement requests in the following situations only:</p>
        <ul>
          <li>Wrong product delivered (SKU or flavour mismatch).</li>
          <li>Damaged product received (broken seal, dented box, leaking).</li>
          <li>Manufacturing defect (unusual smell, texture, or appearance that differs from the product description).</li>
          <li>Product delivered beyond its expiry date.</li>
        </ul>
        <p>
          <strong>Not eligible:</strong> Returns are NOT accepted for change of mind, taste
          preference, or if the product has been opened and partially consumed (beyond a
          single gummy to check taste/texture).
        </p>
        <p>
          Perishable/consumable products (supplements, gummies) are excluded from general
          return acceptance under Indian consumer law if opened. We do however accommodate
          genuine quality complaints on a case-by-case basis.
        </p>
      </section>

      <section>
        <h2>4.3 How to Raise a Claim</h2>
        <ul>
          <li>
            <strong>Step 1 — Video evidence required:</strong> Record an unboxing video that
            clearly shows the outer packaging, inner packaging condition, and the product
            defect. This is mandatory for all damage/defect claims.
          </li>
          <li>
            <strong>Step 2 — Contact us within 48 hours of delivery:</strong> Email the video
            and your order number to{" "}
            <a href="mailto:contact@nutripanda.in">contact@nutripanda.in</a> or WhatsApp us.
          </li>
          <li>
            <strong>Step 3 — We respond within 2 business days</strong> with next steps
            (replacement dispatch or refund approval).
          </li>
        </ul>
      </section>

      <section>
        <h2>4.4 Refund Process</h2>
        <ul>
          <li>Approved refunds are processed within 5–7 business days to your original payment method.</li>
          <li>COD orders are refunded to a bank account (NEFT) provided by you.</li>
          <li>Razorpay processing delays (2–5 additional days) are outside our control.</li>
        </ul>
      </section>

      <section>
        <h2>4.5 Cancellations</h2>
        <ul>
          <li>
            Orders can be cancelled within 12 hours of placement by emailing{" "}
            <a href="mailto:contact@nutripanda.in">contact@nutripanda.in</a>.
          </li>
          <li>Once dispatched, cancellations are not possible. You will need to raise a return after delivery.</li>
          <li>Nutripanda reserves the right to cancel orders due to stock unavailability or payment verification issues, with full refund.</li>
        </ul>
      </section>

      <section>
        <h2>4.6 Note on &ldquo;Unboxing Video&rdquo; Requirement</h2>
        <p>
          We request an unboxing video not to create friction, but to protect both you and us
          from courier mishandling claims. This is standard practice among premium D2C brands
          (Power Gummies, Plix, WOW Skin Science). The video protects your claim if the
          courier damaged your order after dispatch.
        </p>
      </section>
    </LegalLayout>
  );
}
