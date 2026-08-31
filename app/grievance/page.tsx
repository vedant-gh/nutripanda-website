import LegalLayout from "@/components/LegalLayout";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Contact & Grievance Redressal",
  description:
    "Customer support channels and the grievance officer details for Nutripanda Life Care.",
  path: "/grievance",
});

export default function GrievancePage() {
  return (
    <LegalLayout
      title="Contact & Grievance Redressal"
      lastUpdated="June 2025"
    >
      <section>
        <h2>8.1 Customer Support</h2>
        <ul>
          <li>Email: <a href="mailto:contact@nutripanda.in">contact@nutripanda.in</a></li>
          <li>
            Instagram DM:{" "}
            <a href="https://instagram.com/nutripanda_og" target="_blank" rel="noopener noreferrer">
              @nutripanda_og
            </a>
          </li>
          <li>WhatsApp: To be updated</li>
          <li>Response time: Within 24–48 business hours.</li>
        </ul>
      </section>

      <section>
        <h2>8.2 Grievance Officer</h2>
        <p>
          As required under the Consumer Protection (E-Commerce) Rules 2020 and IT Rules 2021:
        </p>
        <ul>
          <li><strong>Grievance Officer:</strong> Vedant Rinwa, Founder</li>
          <li>Email: <a href="mailto:vedant@nutripanda.in">vedant@nutripanda.in</a></li>
          <li>Address: Nutripanda Life Care, Jaipur, Rajasthan — 302xxx, India</li>
        </ul>
        <p>
          Grievances will be acknowledged within 48 hours and resolved within 15 working days,
          as per the Consumer Protection Act 2019.
        </p>
      </section>

      <section>
        <h2>8.3 Dispute Resolution</h2>
        <p>
          In the event of a dispute not resolved through our grievance process, both parties
          agree to attempt mediation before approaching courts. Mediation to be conducted in
          Jaipur, Rajasthan.
        </p>
      </section>
    </LegalLayout>
  );
}
