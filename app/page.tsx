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

export const dynamic = "force-dynamic";

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
