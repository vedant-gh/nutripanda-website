import Link from "next/link";

const PROMISES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
      </svg>
    ),
    title: "100% Vegan",
    desc: "Every gummy uses pectin instead of gelatin. Zero animal ingredients, zero compromise.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M10 10v7.9" />
        <path d="M11.802 6.145a5 5 0 0 1 6.053 6.053" />
        <path d="m15.5 15.571-.964.964a5 5 0 0 1-7.071 0 5 5 0 0 1 0-7.07l.964-.965" />
        <path d="M16 7V3a1 1 0 0 1 1.707-.707 2.5 2.5 0 0 0 2.152.717 1 1 0 0 1 1.131 1.131 2.5 2.5 0 0 0 .717 2.152A1 1 0 0 1 21 8h-4" />
        <path d="m2 2 20 20" />
        <path d="M8 17v4a1 1 0 0 1-1.707.707 2.5 2.5 0 0 0-2.152-.717 1 1 0 0 1-1.131-1.131 2.5 2.5 0 0 0-.717-2.152A1 1 0 0 1 3 16h4" />
      </svg>
    ),
    title: "Zero Added Sugar",
    desc: "Sweetened naturally. No refined sugar, no artificial sweeteners. Just clean, guilt-free nutrition.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" />
        <path d="M6.453 15h11.094" />
        <path d="M8.5 2h7" />
      </svg>
    ),
    title: "Clinically Tested",
    desc: "Every formula is backed by research and tested for potency. Science you can trust, in a gummy you'll love.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
    title: "FSSAI Approved",
    desc: "Manufactured in GMP-certified facilities. Fully compliant with Indian food safety standards.",
  },
];

export default function BrandSection() {
  return (
    <section className="w-full bg-white">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        {/* Brand story — centered */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Nutrition should be simple,
            <br className="hidden sm:block" />
            fun, and honest.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-gray-500 sm:text-lg">
            We started NutriPanda because we were tired of supplements that tasted bad,
            had sketchy ingredients, or made promises they couldn&apos;t keep.
            Our gummies are made with real, clean ingredients, crafted in India, for India.
          </p>
        </div>

        {/* Promise cards grid */}
        <div className="mt-14 grid grid-cols-2 gap-4 sm:mt-16 sm:gap-6 lg:grid-cols-4">
          {PROMISES.map((item) => (
            <div
              key={item.title}
              className="flex flex-col items-center rounded-2xl border border-gray-100 bg-[#fafafa] p-5 text-center transition-colors hover:border-gray-200 hover:bg-white sm:p-6"
            >
              <div className="flex h-14 w-14 items-center justify-center text-[#12BC00]">
                <span className="[&>svg]:h-8 [&>svg]:w-8">{item.icon}</span>
              </div>
              <h3 className="mt-4 text-sm font-bold text-gray-900 sm:text-base">
                {item.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-gray-500 sm:text-sm">
                {item.desc}
              </p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-8 flex items-center justify-center sm:mt-10">
          <Link
            href="/about"
            className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
          >
            Learn more about us &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}
