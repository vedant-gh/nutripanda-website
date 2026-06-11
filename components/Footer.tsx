import Link from "next/link";

export default function Footer() {
  return (
    <footer className="flex w-full flex-col bg-black text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 sm:px-6 lg:px-8">
        {/* Big brand name */}
        <div className="flex flex-col items-center justify-center border-b border-white/10 py-14 sm:py-20">
          <h2 className="text-center text-[clamp(3rem,14vw,12rem)] font-bold leading-none tracking-tight">
            <span className="text-[#12BC00]">Nutri</span>Panda
          </h2>
          <p className="mt-3 text-sm text-white/40 tracking-wide">
            Nutrition that fits your lifestyle.
          </p>
        </div>

        {/* Middle section: links + socials */}
        <div className="grid grid-cols-2 gap-10 border-b border-white/10 py-12 sm:gap-8 sm:py-14 lg:grid-cols-4">
          {/* Col 1: Quick links */}
          <div>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/40">
              Quick Links
            </h3>
            <nav className="flex flex-col gap-3">
              <Link
                href="/products"
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                Shop
              </Link>
              <Link
                href="/about"
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                About
              </Link>
              <Link
                href="/#faq"
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                FAQs
              </Link>
              <Link
                href="/#contact"
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                Contact
              </Link>
            </nav>
          </div>

          {/* Col 2: Policies */}
          <div>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/40">
              Policies
            </h3>
            <nav className="flex flex-col gap-3">
              {[
                { href: "/terms", label: "Terms & Conditions" },
                { href: "/privacy", label: "Privacy Policy" },
                { href: "/shipping", label: "Shipping Policy" },
                { href: "/returns", label: "Returns & Refunds" },
                { href: "/brand-protection", label: "Brand Protection" },
                { href: "/creator-terms", label: "Creator Terms" },
                { href: "/subscription", label: "Subscription Terms" },
                { href: "/grievance", label: "Grievance Redressal" },
              ].map((p) => (
                <Link
                  key={p.href}
                  href={p.href}
                  className="text-sm text-white/60 transition-colors hover:text-white"
                >
                  {p.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Col 3: Support */}
          <div>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/40">
              Support
            </h3>
            <nav className="flex flex-col gap-3">
              <a
                href="mailto:contact@nutripanda.in"
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                contact@nutripanda.in
              </a>
              <span className="text-sm text-white/60">
                Free shipping on all prepaid orders
              </span>
              <span className="text-sm text-white/60">
                30-day satisfaction guarantee
              </span>
            </nav>
          </div>

          {/* Col 4: Socials */}
          <div>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/40">
              Follow Us
            </h3>
            <div className="flex items-center gap-3">
              <a
                href="https://instagram.com/nutripanda_og"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-white/60 transition-all hover:border-white/30 hover:text-white"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
              </a>
            </div>
            <p className="mt-4 text-sm text-white/60">
              @nutripanda_og
            </p>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-center justify-between gap-3 py-6 sm:flex-row">
          <p className="text-center text-xs text-white/30 sm:text-left">
            &copy; {new Date().getFullYear()} Nutripanda Life Care. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-xs text-white/30">
            <span>Made in India</span>
            <span>&middot;</span>
            <span>FSSAI Compliant</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
