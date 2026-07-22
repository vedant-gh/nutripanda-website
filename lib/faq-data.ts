// Home-page FAQ content. Shared by the FAQ UI (FAQSection) and the FAQPage
// JSON-LD on the home page, so the rendered answers and the structured data
// never drift apart.

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQS: FaqItem[] = [
  {
    question: "What ingredients are in your gummies?",
    answer:
      "Our gummies are crafted with premium, clinically researched ingredients including essential vitamins, minerals, and plant-based extracts. Each product page lists the full ingredient breakdown along with nutritional information. We never use artificial colours, flavours, or high-fructose corn syrup.",
  },
  {
    question: "Are your products vegan?",
    answer:
      "Yes! All NutriPanda gummies are 100% vegan. We use pectin instead of gelatin so our supplements are suitable for vegetarians and vegans alike. They are also gluten-free and made without any major allergens.",
  },
  {
    question: "How should I store the supplements?",
    answer:
      "Store your gummies in a cool, dry place away from direct sunlight. Keep the bottle tightly sealed after each use. There is no need to refrigerate, but avoid storing them in hot or humid environments as this can cause the gummies to stick together or soften.",
  },
  {
    question: "Do you offer international shipping?",
    answer:
      "We currently ship across India with free delivery on all prepaid orders. International shipping is not available at the moment, but we are actively working on expanding to select countries. Sign up for our newsletter to be the first to know when we launch internationally.",
  },
  {
    question: "What is your return policy?",
    answer:
      "We offer a 30-day satisfaction guarantee. If you are not happy with your purchase, contact us within 30 days of delivery for a full refund or replacement. The product must be in its original packaging. Opened bottles are eligible for a refund if less than half the gummies have been consumed.",
  },
  {
    question: "How many gummies should I take per day?",
    answer:
      "We recommend 2 gummies per day for adults. Take them at any time, with or without food. For best results, make them part of your daily routine. Do not exceed the recommended dosage. Consult your physician if you are pregnant, nursing, or on medication.",
  },
];
