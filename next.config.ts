import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Next 16's image optimizer rejects upstreams that resolve to "private" IPs.
    // On NAT64/DNS64 dev networks (the 64:ff9b:: prefix) Supabase's public CDN
    // gets false-flagged, breaking all remote images locally. Skip optimization
    // in dev only — production networks are unaffected and stay optimized.
    unoptimized: process.env.NODE_ENV === "development",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
};

export default nextConfig;
