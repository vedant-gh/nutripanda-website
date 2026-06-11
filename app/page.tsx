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

export const dynamic = "force-dynamic";

export default async function Home() {
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
