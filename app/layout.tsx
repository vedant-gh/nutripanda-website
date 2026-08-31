import type { Metadata } from "next";
import "./globals.css";
import ClientProviders from "@/components/ClientProviders";
import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  KEYWORDS,
  LEGAL_NAME,
  DEFAULT_OG_IMAGE,
} from "@/lib/seo";
import SiteAnalytics from "@/components/SiteAnalytics";
import SiteStructuredData from "@/components/SiteStructuredData";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "NutriPanda — Daily Wellness Gummies, Made in India",
    template: "%s | NutriPanda",
  },
  description: SITE_DESCRIPTION,
  keywords: KEYWORDS,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: LEGAL_NAME,
  category: "Health & Wellness",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "NutriPanda — Daily Wellness Gummies, Made in India",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1024,
        height: 939,
        alt: "NutriPanda daily wellness gummies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NutriPanda — Daily Wellness Gummies, Made in India",
    description: SITE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [{ url: "/icon.png", type: "image/png", sizes: "512x512" }],
    shortcut: [{ url: "/favicon.ico", type: "image/x-icon" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  referrer: "strict-origin-when-cross-origin",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN">
      <body className="antialiased">
        <SiteStructuredData />
        <ClientProviders>{children}</ClientProviders>
        <SiteAnalytics />
      </body>
    </html>
  );
}
