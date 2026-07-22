"use client";

import { useState } from "react";
import { FAQS as faqs } from "@/lib/faq-data";

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="w-full bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-xl px-6">
        {/* Heading */}
        <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.25em] text-gray-900 sm:mb-10">
          Questions
        </p>

        {/* Accordion */}
        <div className="space-y-0 border-t border-black/10">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={index} className="border-b border-black/10">
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="flex w-full items-center justify-between py-5 text-left sm:py-6"
                  aria-expanded={isOpen}
                >
                  <span className="pr-4 text-sm font-medium text-gray-900 sm:text-base">
                    {faq.question}
                  </span>
                  <span
                    className={`shrink-0 text-xl leading-none text-gray-400 transition-transform duration-300 ${
                      isOpen ? "rotate-45" : "rotate-0"
                    }`}
                  >
                    +
                  </span>
                </button>
                <div
                  className={`overflow-hidden transition-all duration-300 ${
                    isOpen
                      ? "max-h-96 pb-5 opacity-100 sm:pb-6"
                      : "max-h-0 opacity-0"
                  }`}
                >
                  <p className="text-sm leading-relaxed text-gray-500">
                    {faq.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
