import type { Metadata } from "next";
import LegalLayout from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Shipping Policy | NutriPanda",
  description:
    "Processing times, domestic shipping rates, tracking, and delivery terms for Nutripanda orders.",
};

export default function ShippingPage() {
  return (
    <LegalLayout
      title="Shipping Policy"
      lastUpdated="June 2025"
      intro="Everything you need to know about how and when your Nutripanda order reaches you."
    >
      <section>
        <h2>3.1 Processing Time</h2>
        <p>
          Orders are processed within 1–2 business days (excluding Sundays and national
          holidays). During high-demand periods (launches, sales), processing may extend to 3
          business days.
        </p>
      </section>

      <section>
        <h2>3.2 Domestic Shipping (India)</h2>
        <ul>
          <li><strong>Standard Delivery:</strong> 4–7 business days after dispatch (most pin codes).</li>
          <li><strong>Express Delivery:</strong> 2–3 business days (available at checkout for select pin codes).</li>
          <li>Free standard shipping on all prepaid orders.</li>
          <li>Cash on Delivery (COD) orders incur a flat ₹20 extra fee.</li>
        </ul>
      </section>

      <section>
        <h2>3.3 Order Tracking</h2>
        <p>
          A dispatch confirmation with a tracking link is sent to your registered email
          and/or WhatsApp within 24 hours of dispatch. Track your order using the AWB number
          on our logistics partner&rsquo;s portal.
        </p>
      </section>

      <section>
        <h2>3.4 Address Accuracy</h2>
        <p>
          Please provide a complete and accurate delivery address including flat/house number,
          landmark, city, state, and PIN code. Nutripanda is not responsible for non-delivery
          or re-delivery charges arising from an incorrect or incomplete address provided by
          the customer. Courier companies levy a penalty for incorrect PIN codes, which will
          be borne by the customer.
        </p>
      </section>

      <section>
        <h2>3.5 Undelivered Orders</h2>
        <p>
          If an order is returned to us due to: (a) incorrect address, (b) customer
          unavailability (3 delivery attempts), or (c) refusal to accept — re-shipping charges
          will apply. Please contact us within 5 days of the expected delivery date if your
          order has not arrived.
        </p>
      </section>

      <section>
        <h2>3.6 Risk of Loss</h2>
        <p>
          Risk of loss and title for products passes to you upon dispatch from our fulfilment
          partner.
        </p>
      </section>

      <section>
        <h2>3.7 International Shipping</h2>
        <p>
          We currently ship domestically within India only. Export orders (e.g. South Africa)
          are handled under separate commercial agreements. Please contact{" "}
          <a href="mailto:vedant@nutripanda.in">vedant@nutripanda.in</a> for export enquiries.
        </p>
      </section>
    </LegalLayout>
  );
}
