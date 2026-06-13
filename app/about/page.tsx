import Image from 'next/image'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About Us | NutriPanda',
  description:
    'Learn about NutriPanda, our story, mission, and commitment to making nutrition fun, clean, and accessible for every Indian.',
}

const VALUES = [
  {
    number: '01',
    title: 'Clean Ingredients',
    description:
      'No artificial colours, no gelatin, no high-fructose corn syrup. Just real, researched ingredients your body can actually use.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
      </svg>
    ),
  },
  {
    number: '02',
    title: '100% Vegan',
    description:
      'Every gummy uses pectin, a plant-based alternative to gelatin. Suitable for vegetarians, vegans, and your conscience.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M17 8c.7-1 1-2.2 1-3.5C18 2 16 0 16 0s-2 2-2 4.5c0 1.3.3 2.5 1 3.5" />
        <path d="M12 19c-4.4 0-8-1.8-8-4V9c0 2.2 3.6 4 8 4s8-1.8 8-4v6c0 2.2-3.6 4-8 4z" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'Made in India',
    description:
      'Manufactured in FSSAI-certified facilities with strict quality controls. Proudly Indian, globally inspired.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    number: '04',
    title: 'Science-Backed',
    description:
      'Every formulation is based on clinical research and recommended daily values. No fairy dust. Just science.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" />
        <path d="M6.453 15h11.094" />
        <path d="M8.5 2h7" />
      </svg>
    ),
  },
]

const STATS = [
  { value: '0g', label: 'Added sugar' },
  { value: '100%', label: 'Vegan formulas' },
  { value: 'FSSAI', label: 'Certified facility' },
  { value: '30 day', label: 'Happiness guarantee' },
]

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
  )
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main>
        {/* Hero — panda drops in from the top-left, copy sits at the bottom */}
        <section className="relative overflow-hidden bg-[#f7fdf6]">
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-2 px-6 pb-16 sm:px-8 sm:pb-20 lg:grid-cols-2 lg:items-end lg:gap-8 lg:px-12 lg:pb-24">
            {/* Left: panda — cut out, sticks flush to the top */}
            <div className="flex justify-center lg:justify-start lg:self-start">
              <Image
                src="/assets/about-panda-cutout.png"
                alt="NutriPanda mascot hanging upside down"
                width={933}
                height={712}
                priority
                className="h-auto w-full max-w-[300px] object-contain sm:max-w-[420px] lg:max-w-[600px]"
              />
            </div>

            {/* Right: copy — padded from the top, sits toward the bottom */}
            <div className="flex flex-col items-center justify-end pt-12 text-center sm:pt-16 lg:items-start lg:pb-10 lg:pt-32 lg:text-left">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#DCFDCC] px-4 py-1.5">
                <span className="text-xs font-semibold tracking-wide text-gray-800">
                  Our story
                </span>
              </div>

              <h1 className="font-heading text-4xl font-bold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
                We make vitamins
                <br />
                you&apos;ll <span className="text-[#12BC00]">actually take.</span>
              </h1>

              <p className="mt-5 max-w-xl text-base leading-relaxed text-gray-500 sm:text-lg lg:max-w-md">
                NutriPanda started with a simple frustration. Why does something so
                essential have to taste so bad? So we built the gummies we wished existed.
              </p>

              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:gap-4 lg:items-start">
                <Link
                  href="/products"
                  className="inline-flex items-center gap-2 rounded-full bg-[#12BC00] px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#0fa600] active:scale-[0.98] sm:px-10 sm:text-base"
                >
                  Shop Now
                </Link>
                <a
                  href="#story"
                  className="inline-flex items-center gap-2 rounded-full border-2 border-gray-900 px-8 py-3 text-sm font-semibold text-gray-900 transition-all hover:bg-gray-900 hover:text-white active:scale-[0.98] sm:px-10 sm:text-base"
                >
                  Read Story
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Stats strip */}
        <section className="border-y border-gray-100 bg-white">
          <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-gray-100 px-4 sm:grid-cols-4 sm:px-6 lg:px-8">
            {STATS.map((stat) => (
              <div key={stat.label} className="px-4 py-8 text-center sm:py-10">
                <p className="font-heading text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
                  {stat.value}
                </p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-gray-500 sm:text-sm">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Founder Story */}
        <section id="story" className="bg-white py-16 sm:py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#DCFDCC] px-3 py-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-800">
                How it started
              </span>
            </div>
            <h2 className="font-heading text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              From a counter full of pills to a jar of gummies
            </h2>

            <div className="mt-8 space-y-5 text-base leading-relaxed text-gray-600 sm:text-lg">
              <p>
                It started with staring at a pile of tablets and capsules every morning,
                wondering why something so essential had to be so unpleasant. We knew there
                had to be a better way.
              </p>
              <p>
                After months of research, countless formulations, and one too many taste
                tests, NutriPanda was born. We set out to create gummies that deliver real,
                science-backed nutrition in a format people actually enjoy.
              </p>
            </div>

            {/* Pull quote */}
            <blockquote className="my-12 rounded-2xl border border-[#DCFDCC] bg-[#f7fdf6] px-6 py-8 sm:px-10 sm:py-10">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#12BC00"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mb-4"
                aria-hidden
              >
                <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
                <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
              </svg>
              <p className="font-heading text-xl leading-relaxed text-gray-900 sm:text-2xl">
                &ldquo;If it tastes bad, people stop taking it.
                That&apos;s the problem we&apos;re solving.&rdquo;
              </p>
            </blockquote>

            <div className="space-y-5 text-base leading-relaxed text-gray-600 sm:text-lg">
              <p>
                Every gummy is made in India, in FSSAI-certified facilities, with
                ingredients sourced for purity and potency. No artificial colours, no
                gelatin, no compromises.
              </p>
            </div>
          </div>
        </section>

        {/* Mission / Vision — black band like homepage IngredientsSection */}
        <section className="bg-black py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/70">
                What drives us
              </span>
              <h2 className="font-heading mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Mission, then everything else.
              </h2>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:gap-8">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 sm:p-9">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center text-white">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
                      <circle cx="12" cy="12" r="10" />
                      <circle cx="12" cy="12" r="6" />
                      <circle cx="12" cy="12" r="2" />
                    </svg>
                  </span>
                  <h3 className="font-heading text-xl font-bold text-white sm:text-2xl">
                    Our Mission
                  </h3>
                </div>
                <p className="text-base leading-relaxed text-white/70 sm:text-lg">
                  To make daily nutrition accessible, enjoyable, and transparent for every
                  Indian. We believe that when supplements taste great and are made with
                  clean ingredients, people stay consistent, and consistency is where real
                  health happens.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 sm:p-9">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center text-white">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </span>
                  <h3 className="font-heading text-xl font-bold text-white sm:text-2xl">
                    Our Vision
                  </h3>
                </div>
                <p className="text-base leading-relaxed text-white/70 sm:text-lg">
                  A world where taking your vitamins brings a smile, not a grimace.
                  India&apos;s most loved nutrition brand, one gummy at a time.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Values — numbered grid with icons */}
        <section className="bg-white py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-heading text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                What we stand for
              </h2>
              <p className="mt-3 text-base text-gray-500 sm:text-lg">
                Four non-negotiables we built the brand around.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:mt-16 lg:grid-cols-4">
              {VALUES.map((item) => (
                <div
                  key={item.title}
                  className="group flex flex-col rounded-2xl border border-gray-100 bg-[#fafafa] p-6 transition-colors hover:border-gray-200 hover:bg-white sm:p-7"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-12 w-12 items-center justify-center text-[#12BC00] [&>svg]:h-7 [&>svg]:w-7">
                      {item.icon}
                    </span>
                    <span className="font-heading text-2xl font-bold text-gray-200 transition-colors group-hover:text-gray-300 sm:text-3xl">
                      {item.number}
                    </span>
                  </div>
                  <h3 className="mt-5 text-base font-bold text-gray-900 sm:text-lg">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-500">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Built in India callout */}
        <section className="bg-[#fafafa] py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-center gap-10 md:grid-cols-2 md:gap-12">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-[#DCFDCC] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-800">
                  Built in India
                </span>
                <h2 className="font-heading mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                  For Indian routines, Indian taste buds.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-gray-500 sm:text-lg">
                  We formulate, manufacture, and ship from India. Every batch is tested
                  for purity and potency before it reaches your door.
                </p>

                <ul className="mt-6 space-y-3">
                  {[
                    'FSSAI-certified manufacturing',
                    'Third-party lab tested batches',
                    'Cold-chain ready packaging',
                  ].map((point) => (
                    <li key={point} className="flex items-center gap-2.5">
                      <CheckIcon />
                      <span className="text-sm font-medium text-gray-700 sm:text-base">
                        {point}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-gradient-to-br from-green-50 via-white to-green-50/40">
                <Image
                  src="/assets/hero.png"
                  alt="NutriPanda mascot with gummies"
                  fill
                  className="object-contain p-6"
                  sizes="(max-width: 768px) 100vw, 480px"
                />
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-white py-16 sm:py-24">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="font-heading text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Ready to try NutriPanda?
            </h2>
            <p className="mt-4 text-base text-gray-500 sm:text-lg">
              Join hundreds of Indians who&apos;ve made gummies part of their daily routine.
            </p>
            <Link
              href="/products"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#12BC00] px-10 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#0fa600] active:scale-[0.98] sm:text-base"
            >
              Shop Now
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
