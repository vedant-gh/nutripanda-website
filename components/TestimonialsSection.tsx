"use client";

import type { Testimonial } from "@/types/supabase";

// Fallback testimonials if DB has fewer than 6
const FALLBACK_TESTIMONIALS: Testimonial[] = [
  {
    id: "f1",
    customer_name: "Priya Sharma",
    customer_location: "Mumbai, Maharashtra",
    text: "I have been taking the Immunity Support gummies for 3 months now and I can genuinely feel the difference. I used to fall sick every season change, but not anymore! Plus they taste amazing.",
    rating: 5,
    is_active: true,
    created_at: "",
  },
  {
    id: "f2",
    customer_name: "Rahul Mehta",
    customer_location: "Bangalore, Karnataka",
    text: "Finally a supplement that does not feel like a chore. The Daily Vitality gummies are part of my morning routine now. More energy throughout the day and my skin has noticeably improved.",
    rating: 5,
    is_active: true,
    created_at: "",
  },
  {
    id: "f3",
    customer_name: "Ananya Patel",
    customer_location: "Ahmedabad, Gujarat",
    text: "Was skeptical at first but these gummies won me over. The ingredients are clean, no artificial junk, and they actually taste like candy. My whole family loves them. Already on my second order!",
    rating: 4,
    is_active: true,
    created_at: "",
  },
  {
    id: "f4",
    customer_name: "Vikram Singh",
    customer_location: "Delhi, NCR",
    text: "As someone who struggles to swallow pills, NutriPanda is a game-changer. The taste is genuinely good, not that fake sweet flavour you get with other brands. Highly recommend the Immunity ones.",
    rating: 5,
    is_active: true,
    created_at: "",
  },
  {
    id: "f5",
    customer_name: "Sneha Reddy",
    customer_location: "Hyderabad, Telangana",
    text: "Bought these for my parents and they absolutely love them. My dad takes the Daily Vitality and my mum takes Immunity. They keep asking me to reorder. Great quality, great brand.",
    rating: 5,
    is_active: true,
    created_at: "",
  },
  {
    id: "f6",
    customer_name: "Arjun Nair",
    customer_location: "Kochi, Kerala",
    text: "The fact that these are plant-based and sugar-free is what sold me. I have been looking for a clean supplement brand in India for ages. NutriPanda nails it. Taste is chef's kiss.",
    rating: 5,
    is_active: true,
    created_at: "",
  },
];

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${filled ? "fill-amber-400 text-amber-400" : "fill-gray-600 text-gray-600"}`}
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <StarIcon key={i} filled={i < rating} />
      ))}
    </div>
  );
}

export default function TestimonialsSection({
  testimonials,
}: {
  testimonials: Testimonial[];
}) {
  // Merge DB testimonials with fallbacks to ensure at least 6
  const allTestimonials =
    testimonials.length >= 6
      ? testimonials
      : [
          ...testimonials,
          ...FALLBACK_TESTIMONIALS.filter(
            (fb) => !testimonials.find((t) => t.customer_name === fb.customer_name),
          ),
        ].slice(0, 6);

  if (!allTestimonials.length) return null;

  // Split into 2 rows of 3 for the marquee
  const row1 = allTestimonials.slice(0, Math.ceil(allTestimonials.length / 2));
  const row2 = allTestimonials.slice(Math.ceil(allTestimonials.length / 2));

  return (
    <section className="w-full overflow-hidden bg-white py-16 sm:py-20">
      <div className="mx-auto mb-10 max-w-2xl px-4 text-center sm:mb-14">
        <h2 className="font-heading text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          What people are saying
        </h2>
      </div>

      {/* Row 1 — scrolls left */}
      <div className="relative mb-4 sm:mb-5">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-white to-transparent sm:w-32" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-white to-transparent sm:w-32" />

        <div className="flex animate-marquee">
          {[...row1, ...row1, ...row1, ...row1].map((t, i) => (
            <TestimonialCard key={`r1-${i}`} testimonial={t} />
          ))}
        </div>
      </div>

      {/* Row 2 — scrolls right */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-white to-transparent sm:w-32" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-white to-transparent sm:w-32" />

        <div className="flex animate-marquee-reverse">
          {[...row2, ...row2, ...row2, ...row2].map((t, i) => (
            <TestimonialCard key={`r2-${i}`} testimonial={t} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialCard({ testimonial }: { testimonial: Testimonial }) {
  return (
    <div className="mx-2 flex w-[320px] shrink-0 flex-col justify-between rounded-2xl border border-gray-100 bg-[#fafafa] p-6 sm:mx-3 sm:w-[380px]">
      {/* Stars + quote */}
      <div>
        {testimonial.rating && <StarRating rating={testimonial.rating} />}
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          &ldquo;{testimonial.text}&rdquo;
        </p>
      </div>

      {/* Author */}
      <div className="mt-5 flex items-center gap-3 border-t border-gray-200 pt-4">
        {/* Avatar initial */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
          {testimonial.customer_name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2)}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {testimonial.customer_name}
          </p>
          {testimonial.customer_location && (
            <p className="text-xs text-gray-400">
              {testimonial.customer_location}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
