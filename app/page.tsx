import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import ProductCards from "@/components/ProductCards";
import BrandSection from "@/components/BrandSection";
import IngredientsSection from "@/components/IngredientsSection";
import TestimonialsSection from "@/components/TestimonialsSection";
import FAQSection from "@/components/FAQSection";
import ContactSection from "@/components/ContactSection";
import Footer from "@/components/Footer";
import {
  getFeaturedProducts,
  getComingSoonProducts,
  getAllTestimonials,
} from "@/lib/supabase/queries";
import { FAQS } from "@/lib/faq-data";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "NutriPanda | Clean Nutrition Gummies Made in India",
  description:
    "Discover clean, vegan nutrition gummies made in India with real ingredients, no added sugar, no gelatin, and effective everyday doses.",
  path: "/",
});

export const dynamic = "force-dynamic";

// FAQPage structured data — strongly favoured for AI-search citations and
// Google rich results. Built from the same source as the on-page FAQ.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.question,
    acceptedAnswer: { "@type": "Answer", text: f.answer },
  })),
};

export default async function Home() {
  const [featured, comingSoon, testimonials] = await Promise.all([
    getFeaturedProducts(),
    getComingSoonProducts(),
    getAllTestimonials(),
  ]);

  // Best Sellers = live featured products, followed by coming-soon teasers
  const featuredIds = new Set(featured.map((p) => p.id));
  const products = [
    ...featured,
    ...comingSoon.filter((p) => !featuredIds.has(p.id)),
  ];

  return (
    <div className="min-h-screen bg-white font-sans">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
        }}
      />
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
