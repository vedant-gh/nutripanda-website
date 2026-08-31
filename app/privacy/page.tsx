import LegalLayout from "@/components/LegalLayout";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Privacy Policy",
  description:
    "How Nutripanda Life Care collects, uses, and protects your personal information on nutripanda.in.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      lastUpdated="August 2026"
      intro="This Privacy Policy explains what information Nutripanda Life Care collects when you use nutripanda.in, how we use and share it, and the rights you have over your data."
    >
      <section>
        <h2>2.1 Information We Collect</h2>
        <p>When you use nutripanda.in, we may collect:</p>
        <ul>
          <li>Name, email address, phone number, and delivery address (at checkout).</li>
          <li>Payment method type (Razorpay processes card data; we do not store card details).</li>
          <li>
            Device type, browser, IP address, and pages visited through PostHog, Google
            Analytics, and Ahrefs Web Analytics.
          </li>
          <li>Purchase history and product preferences.</li>
          <li>Communications you send to us (email, WhatsApp, Instagram DMs).</li>
        </ul>
      </section>

      <section>
        <h2>2.2 How We Use Your Data</h2>
        <ul>
          <li>To process and fulfil your orders.</li>
          <li>To send order confirmations, dispatch notifications, and delivery updates.</li>
          <li>To send marketing messages — only if you opt in. You can unsubscribe at any time.</li>
          <li>
            To measure website performance and understand customer behaviour using PostHog,
            Google Analytics, and Ahrefs Web Analytics.
          </li>
          <li>To comply with legal and regulatory obligations (FSSAI, GST, etc.).</li>
          <li>To investigate and resolve disputes or complaints.</li>
        </ul>
      </section>

      <section>
        <h2>2.3 Data Sharing</h2>
        <p>We do not sell, rent, or trade your personal data. We share data only with:</p>
        <ul>
          <li>Logistics partners (Shiprocket/courier companies) for delivery purposes.</li>
          <li>Razorpay for payment processing under their Privacy Policy.</li>
          <li>PostHog, Google Analytics, and Ahrefs Web Analytics for website measurement.</li>
          <li>Legal authorities if required by a court order or applicable law.</li>
        </ul>
      </section>

      <section>
        <h2>2.4 Data Security</h2>
        <p>
          We implement reasonable technical and organisational measures to protect your data.
          All payment transactions are encrypted via Razorpay&rsquo;s PCI-DSS compliant
          gateway. However, no internet transmission is 100% secure and we cannot guarantee
          absolute security.
        </p>
      </section>

      <section>
        <h2>2.5 Data Retention</h2>
        <p>
          We retain your order and personal data for a minimum of 5 years as required for GST
          compliance. Analytics data is retained for 12 months. You may request deletion of
          marketing data at any time.
        </p>
      </section>

      <section>
        <h2>2.6 Your Rights (IT Act 2000 &amp; DPDP Act 2023)</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you.</li>
          <li>Correct inaccurate data.</li>
          <li>Request erasure of data not required for legal compliance.</li>
          <li>Withdraw consent for marketing communications at any time.</li>
        </ul>
        <p>
          To exercise any of these rights, email us at{" "}
          <a href="mailto:contact@nutripanda.in">contact@nutripanda.in</a> with the subject
          line &ldquo;Data Request&rdquo;.
        </p>
      </section>

      <section>
        <h2>2.7 Cookies</h2>
        <p>
          We use essential cookies for checkout functionality. We also use PostHog, Google
          Analytics, and Ahrefs Web Analytics to measure site usage and performance; these
          services may use cookies or similar technologies. You can manage cookies in your
          browser settings.
        </p>
      </section>
    </LegalLayout>
  );
}
