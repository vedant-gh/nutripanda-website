import { cookies } from "next/headers";
import Image from "next/image";
import WaitlistForm from "@/components/WaitlistForm";
import FloatingGummies from "@/components/FloatingGummies";
import KeywordPills, { MobileKeywordCards } from "@/components/KeywordPills";
import ComingSoonSections from "@/components/ComingSoonSections";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import ProductCards from "@/components/ProductCards";
import BrandSection from "@/components/BrandSection";
import IngredientsSection from "@/components/IngredientsSection";
import TestimonialsSection from "@/components/TestimonialsSection";
import FAQSection from "@/components/FAQSection";
import ContactSection from "@/components/ContactSection";
import Footer from "@/components/Footer";
import { getFeaturedProducts, getAllTestimonials } from "@/lib/supabase/queries";

export default async function Home() {
  const cookieStore = await cookies();
  const isPreview = cookieStore.get("preview")?.value === "true";

  if (isPreview) {
    const [products, testimonials] = await Promise.all([
      getFeaturedProducts(),
      getAllTestimonials(),
    ]);

    return (
      <div className="min-h-screen bg-white font-sans">
        <Navbar />
        <HeroSection />
        <ProductCards products={products} />
        <BrandSection />
        <IngredientsSection />
        <TestimonialsSection testimonials={testimonials} />
        <FAQSection />
        <ContactSection />
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* ━━━ Hero viewport ━━━ */}
      <div className="relative h-dvh w-full overflow-hidden">
        {/* Floating gummies */}
        <FloatingGummies />

        {/* SEO keyword pills — left & right of panda */}
        <KeywordPills />

        {/* Logo — pinned to top center */}
        <div className="absolute top-6 left-1/2 z-10 -translate-x-1/2 flex flex-col items-center sm:top-8">
          <Image
            src="/assets/logo-main.png"
            alt="NutriPanda"
            width={200}
            height={60}
            className="h-7 w-auto sm:h-9"
            priority
          />
          <p className="mt-1 text-center text-xs tracking-wide text-gray-500 sm:text-sm">
            Nutrition Gummies Made Natural
          </p>
        </div>

        {/* Center content — coming soon + form */}
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-4 -translate-y-[5%] sm:-translate-y-[18%]">
          <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl md:text-6xl">
            Coming Soon
          </h1>
          <p className="mt-2 text-center text-xs text-gray-500 sm:whitespace-nowrap sm:text-base">
            Be the first to know when we launch & get an exclusive discount!
          </p>

          <WaitlistForm />

          <p className="mt-4 text-xs text-gray-400">
            Follow us{" "}
            <a
              href="https://instagram.com/nutripanda_og"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-green hover:underline"
            >
              @nutripanda_og
            </a>
          </p>

          <MobileKeywordCards />
        </div>

        {/* Panda sitting at the bottom */}
        <div className="absolute bottom-0 left-1/2 z-6 -translate-x-1/2">
          <Image
            src="/assets/pre-launch/panda-sitting-new.png"
            alt="NutriPanda sitting"
            width={600}
            height={600}
            priority
            className="h-[250px] w-auto sm:h-[420px] md:h-[500px]"
          />
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 animate-bounce hidden sm:flex flex-col items-center gap-1">
          <span className="text-[10px] tracking-widest uppercase text-gray-400">
            Scroll
          </span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-300">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* ━━━ Below-the-fold brand sections ━━━ */}
      <ComingSoonSections />
    </div>
  );
}
