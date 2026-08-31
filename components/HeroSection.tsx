"use client";

import Image from "next/image";
import Link from "next/link";
import {
  LeafIcon,
  SproutIcon,
  ShieldCheckIcon,
} from "@/components/Icons";
import type { ReactNode } from "react";

const TRUST_BADGES: { label: string; icon: ReactNode }[] = [
  { label: "Sugar-Free", icon: <LeafIcon className="h-4 w-4 text-[#12BC00]" /> },
  { label: "Vegan", icon: <SproutIcon className="h-4 w-4 text-[#12BC00]" /> },
  { label: "FSSAI Compliant", icon: <ShieldCheckIcon className="h-4 w-4 text-[#12BC00]" /> },
];

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4 shrink-0"
      stroke="#12BC00"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function TrustStrip() {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-black">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-6 px-4 py-3.5 sm:gap-10 sm:py-4">
        {TRUST_BADGES.map((badge) => (
          <div
            key={badge.label}
            className="flex items-center gap-2 sm:gap-2.5"
          >
            {badge.icon}
            <span className="text-[11px] font-medium tracking-wide text-white sm:text-sm">
              {badge.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HeroSection() {
  return (
    <section className="relative min-h-[calc(100dvh-64px)] w-full overflow-hidden bg-[#f7fdf6]">
      {/* Main content grid */}
      <div className="relative z-10 mx-auto grid min-h-[calc(100dvh-64px)] max-w-7xl grid-cols-1 items-center px-6 pb-20 pt-12 sm:px-8 lg:grid-cols-2 lg:gap-8 lg:px-12 lg:pb-24 lg:pt-0">
        {/* Left: Copy */}
        <div
          className="flex flex-col items-center text-center lg:items-start lg:text-left"
        >
          {/* Static badge */}
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#DCFDCC] px-4 py-1.5">
            <span className="text-xs font-semibold tracking-wide text-gray-800">
              Made in India
            </span>
          </div>

          {/* Headline */}
          <h1 className="font-heading text-4xl font-bold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            Your daily vitamins,
            <br />
            but they actually
            <br />
            <span className="text-[#12BC00]">taste good.</span>
          </h1>

          {/* Subtitle */}
          <p className="mt-5 max-w-md text-base leading-relaxed text-gray-500 sm:text-lg lg:max-w-lg">
            Nutrition gummies with real ingredients. No sugar, no
            gelatin, no compromise.
          </p>

          {/* Bullet trust points — desktop only */}
          <div className="mt-6 hidden flex-wrap items-center gap-x-5 gap-y-2 lg:flex">
            {["100% Vegan", "0 Added Sugar", "FSSAI Compliant"].map(
              (point) => (
                <div key={point} className="flex items-center gap-2">
                  <CheckIcon />
                  <span className="text-sm font-medium text-gray-600">
                    {point}
                  </span>
                </div>
              ),
            )}
          </div>

          {/* CTAs */}
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:gap-4 lg:items-start">
            <Link
              href="/products"
              className="inline-flex items-center gap-2 rounded-full bg-[#12BC00] px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#0fa600] active:scale-[0.98] sm:px-10 sm:text-base"
            >
              Shop Now
            </Link>
            <Link
              href="/about"
              className="inline-flex items-center gap-2 rounded-full border-2 border-gray-900 px-8 py-3 text-sm font-semibold text-gray-900 transition-all hover:bg-gray-900 hover:text-white active:scale-[0.98] sm:px-10 sm:text-base"
            >
              Our Story
            </Link>
          </div>

          {/* Mobile: trust pills */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2 lg:hidden">
            {["Sugar-Free", "Vegan", "FSSAI"].map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 text-[11px] font-medium text-gray-600"
              >
                <CheckIcon />
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Right: Panda */}
        <div
          className="relative mt-8 flex items-end justify-center lg:mt-0 lg:items-center"
        >
          <div className="relative">
            <Image
              src="/assets/hero-skin.png"
              alt="NutriPanda panda mascot holding a Skin Gummies pack"
              width={1178}
              height={1335}
              priority
              className="relative z-10 h-auto w-full max-w-[400px] object-contain lg:max-w-[480px]"
            />
          </div>
        </div>
      </div>

      {/* Bottom trust strip */}
      <TrustStrip />
    </section>
  );
}
