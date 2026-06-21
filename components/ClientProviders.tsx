"use client";

import { Toaster } from "react-hot-toast";
import AnnouncementBar from "@/components/AnnouncementBar";
import CartDrawer from "@/components/CartDrawer";
import CouponPopup from "@/components/CouponPopup";
import PostHogProvider from "@/lib/posthog/provider";

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <PostHogProvider>
      <AnnouncementBar />
      {children}
      <CartDrawer />
      <CouponPopup />
      <Toaster
        position="bottom-center"
        toastOptions={{
          duration: 2000,
          style: {
            background: "#333",
            color: "#fff",
            fontSize: "14px",
            borderRadius: "999px",
            padding: "8px 16px",
          },
        }}
      />
    </PostHogProvider>
  );
}
