"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NutritionFacts } from "@/types/supabase";

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// "How it helps you" copy for the active nutrients we ship across products.
// Macro rows (fat, sodium, sugars, etc.) intentionally have no entry — no leader line.
const NUTRIENT_BENEFITS: Record<string, string> = {
  "vitamin b12": "Powers energy production and keeps your nerves and red blood cells healthy.",
  "vitamin d3": "Boosts calcium absorption for stronger bones and a more resilient immune system.",
  "vitamin d": "Boosts calcium absorption for stronger bones and a more resilient immune system.",
  "folic acid": "Supports healthy cell growth and the formation of red blood cells.",
  folate: "Supports healthy cell growth and the formation of red blood cells.",
  biotin: "Nourishes your hair, skin, and nails from within.",
  "elemental zinc": "Strengthens immune defenses and supports skin repair and recovery.",
  zinc: "Strengthens immune defenses and supports skin repair and recovery.",
  phycocyanin: "A powerful spirulina antioxidant that helps fight inflammation and oxidative stress.",
  "beta carotene": "Converts to vitamin A to support healthy vision, skin, and immunity.",
  "dietary fiber": "Feeds good gut bacteria and supports smooth, healthy digestion.",
  "vitamin c": "A key antioxidant that supports immunity and collagen for healthy skin.",
  "vitamin a": "Supports healthy vision, skin, and a strong immune system.",
  "vitamin e": "An antioxidant that protects your cells and supports skin health.",
  "vitamin b6": "Helps turn the food you eat into energy and supports brain function.",
  "vitamin k": "Supports healthy blood clotting and strong bones.",
  iron: "Helps carry oxygen through your blood to keep fatigue at bay.",
  calcium: "Builds and maintains strong bones and teeth.",
  magnesium: "Supports muscle function, relaxation, and restful sleep.",
  iodine: "Supports healthy thyroid function and metabolism.",
  spirulina: "A nutrient-dense superfood rich in antioxidants and plant protein.",
  giloy: "A traditional Ayurvedic herb that supports your natural immunity.",
  "giloy extract": "A traditional Ayurvedic herb that supports your natural immunity.",
  elderberry: "Packed with antioxidants that support seasonal immune health.",
  ashwagandha: "An adaptogen that helps your body manage stress and fatigue.",
};

const ACCENT_MAP: Record<string, string> = {
  orange: "#FF7731",
  green: "#12BC00",
  purple: "#9231FF",
  yellow: "#FFC731",
  pink: "#F995FF",
  blue: "#70A9FF",
};

function benefitFor(label: string) {
  return NUTRIENT_BENEFITS[label.trim().toLowerCase()];
}

type Line = { x1: number; y1: number; x2: number; y2: number };

export default function NutritionFactsAnnotated({
  facts,
  colorTheme,
}: {
  facts: NutritionFacts;
  colorTheme: string | null;
}) {
  const accent = ACCENT_MAP[colorTheme ?? ""] ?? "#12BC00";

  const items = facts.fields
    .map((field, index) => ({ field, index, benefit: benefitFor(field.label) }))
    .filter((x) => Boolean(x.benefit)) as {
    field: NutritionFacts["fields"][number];
    index: number;
    benefit: string;
  }[];

  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRefs = useRef<Record<number, HTMLSpanElement | null>>({});
  const benefitRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useIsomorphicLayoutEffect(() => {
    const measure = () => {
      const c = containerRef.current;
      if (!c) return;
      const cr = c.getBoundingClientRect();
      setBox({ w: cr.width, h: cr.height });
      const next: Line[] = [];
      items.forEach((it, k) => {
        const a = anchorRefs.current[it.index];
        const b = benefitRefs.current[k];
        if (!a || !b) return;
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        next.push({
          x1: ar.left - cr.left,
          y1: ar.top - cr.top + ar.height / 2,
          x2: br.left - cr.left,
          y2: br.top - cr.top + br.height / 2,
        });
      });
      setLines(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", measure);
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready) fonts.ready.then(measure).catch(() => {});
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [items.length, colorTheme]);

  return (
    <div ref={containerRef} className="relative">
      {/* Leader lines — desktop only. Behind the label so they appear to emerge from its edge. */}
      <svg
        className="pointer-events-none absolute inset-0 z-0 hidden lg:block"
        width={box.w}
        height={box.h}
        aria-hidden
      >
        {lines.map((l, k) => (
          <g key={k}>
            <line
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke={accent}
              strokeWidth={1.5}
              strokeOpacity={0.5}
            />
            <circle cx={l.x2} cy={l.y2} r={3.5} fill={accent} />
          </g>
        ))}
      </svg>

      <div className="lg:grid lg:grid-cols-[auto_1fr] lg:items-center lg:gap-x-20">
        {/* FDA-style label */}
        <div className="relative z-10 w-full max-w-sm rounded-2xl border-2 border-gray-900 bg-white p-5 sm:p-6">
          <h3 className="border-b-8 border-gray-900 pb-1 text-2xl font-bold text-gray-900">
            Nutrition Facts
          </h3>
          <p className="mt-2 text-sm text-gray-600">Serving Size: {facts.servingSize}</p>
          <div className="mt-2 border-t-4 border-gray-900 pt-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-gray-900">Calories</span>
              <span className="text-2xl font-bold text-gray-900">{facts.calories}</span>
            </div>
          </div>
          <div className="mt-1 border-t-2 border-gray-900 pt-1 text-right text-xs font-bold text-gray-600">
            % Daily Value*
          </div>
          {facts.fields.map((field, i) => (
            <div
              key={i}
              className="relative flex items-center justify-between border-t border-gray-300 py-1.5 text-sm"
            >
              <span className="font-medium text-gray-900">{field.label}</span>
              <div className="flex items-center gap-4">
                <span className="text-gray-600">{field.value}</span>
                {field.dailyPercent && (
                  <span className="font-bold text-gray-900">{field.dailyPercent}</span>
                )}
              </div>
              {benefitFor(field.label) && (
                <span
                  ref={(el) => {
                    anchorRefs.current[i] = el;
                  }}
                  className="absolute right-0 top-1/2 h-0 w-0"
                  aria-hidden
                />
              )}
            </div>
          ))}
          <p className="mt-3 border-t border-gray-300 pt-2 text-xs text-gray-500">
            *Percent Daily Values are based on a 2,000 calorie diet.
          </p>
        </div>

        {/* Benefit callouts — desktop, connected by the leader lines */}
        {items.length > 0 && (
          <div className="relative z-10 hidden lg:flex lg:flex-col lg:justify-center lg:gap-6">
            {items.map((it, k) => (
              <div
                key={k}
                ref={(el) => {
                  benefitRefs.current[k] = el;
                }}
                className="border-l-2 pl-4"
                style={{ borderColor: accent }}
              >
                <p className="text-sm font-bold text-gray-900">{it.field.label}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{it.benefit}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Benefit list — mobile / tablet */}
      {items.length > 0 && (
        <div className="mt-8 lg:hidden">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            How each nutrient helps
          </p>
          <div className="space-y-3">
            {items.map((it, k) => (
              <div key={k} className="flex gap-3">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: accent }}
                  aria-hidden
                />
                <p className="text-sm leading-relaxed text-gray-600">
                  <span className="font-semibold text-gray-900">{it.field.label}.</span>{" "}
                  {it.benefit}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
