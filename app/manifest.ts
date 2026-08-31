import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_DESCRIPTION } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — Daily Wellness Gummies`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    scope: "/",
    background_color: "#ffffff",
    theme_color: "#12BC00",
    lang: "en-IN",
    categories: ["health", "shopping", "lifestyle"],
    icons: [
      { src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
