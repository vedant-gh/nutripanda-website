"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

const AHREFS_DATA_KEY = "+rhv80H0CyScxGuMyQ1A/Q";
const GOOGLE_ANALYTICS_ID = "G-36C4W69KTP";
const SENSITIVE_PATHS = ["/checkout", "/order-confirmation", "/account"];

export default function SiteAnalytics() {
  const pathname = usePathname();
  const isSensitive = SENSITIVE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (isSensitive) return null;

  return (
    <>
      <Script
        id="ahrefs-analytics"
        src="https://analytics.ahrefs.com/analytics.js"
        data-key={AHREFS_DATA_KEY}
        async
        strategy="afterInteractive"
      />
      <Script
        id="google-analytics"
        src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`}
        async
        strategy="afterInteractive"
      />
      <Script id="google-analytics-config" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GOOGLE_ANALYTICS_ID}');
        `}
      </Script>
    </>
  );
}
