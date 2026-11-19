import { ArrowRight, ClipboardCheck, KeyRound, Search, Ship } from 'lucide-react';
import { ScrollReveal } from './ScrollReveal';

interface HowItWorksSectionProps {
  brands?: string[];
  onStartOrder: () => void;
  onBrowseCollection?: () => void;
}

const IMPORT_STEPS = [
  {
    step: '01',
    title: 'Tell Us What You Need',
    description:
      'Share your preferred make, model, trim, or budget. We source verified matches directly from international markets.',
    Icon: Search,
  },
  {
    step: '02',
    title: 'Review & Reserve',
    description:
      'Inspect auction sheets, walkaround videos, and transparent total pricing before placing a reservation.',
    Icon: ClipboardCheck,
  },
  {
    step: '03',
    title: 'We Handle Logistics',
    description:
      'Export documentation, ocean freight, and Ethiopian customs clearance are managed end-to-end by our team.',
    Icon: Ship,
  },
  {
    step: '04',
    title: 'Drive With Confidence',
    description:
      'Collect your vehicle from our showroom with complete inspection paperwork and handover support.',
    Icon: KeyRound,
  },
] as const;

const FALLBACK_PARTNER_BRANDS = [
  'TOYOTA',
  'LEXUS',
  'MERCEDES-BENZ',
  'BMW',
  'PORSCHE',
  'RANGE ROVER',
  'BYD',
];

export function HowItWorksSection({
  brands = [],
  onStartOrder,
  onBrowseCollection,
}: HowItWorksSectionProps) {
  const normalizedBrands = Array.from(
    new Set(brands.map((b) => b.trim().toUpperCase()).filter(Boolean))
  );
  const displayBrands =
    normalizedBrands.length >= 4 ? normalizedBrands : FALLBACK_PARTNER_BRANDS;

  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 border-t border-white/[0.07] bg-[#08080a] py-16 sm:py-22"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16 sm:space-y-20">
        {/* Step-by-Step Import Pillars */}
        <div className="space-y-10">
          <ScrollReveal
            y={22}
            className="text-center max-w-2xl mx-auto space-y-2.5"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#E11D2A]">
              How It Works
            </p>
            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white [text-wrap:balance]">
              From Inquiry to Delivery
            </h2>
            <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
              A clear, guided import process designed for buyers who want verified global vehicles without the complexity.
            </p>
          </ScrollReveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {IMPORT_STEPS.map((item, idx) => {
              const StepIcon = item.Icon;
              return (
                <ScrollReveal
                  key={item.step}
                  y={22}
                  delay={idx * 0.05}
                  className="bg-[#0d0d11] border border-white/[0.07] hover:border-[#E11D2A]/40 rounded-2xl p-6 space-y-4 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-10 h-10 rounded-xl bg-[#E11D2A]/12 border border-[#E11D2A]/25 text-[#E11D2A] inline-flex items-center justify-center shrink-0">
                      <StepIcon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="font-mono text-sm font-bold text-zinc-500 tabular-nums">
                      {item.step}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="font-display text-base sm:text-lg font-semibold text-white">
                      {item.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </ScrollReveal>
              );
            })}
          </div>
        </div>

        {/* Trusted Partners Wordmark Band */}
        <ScrollReveal
          y={20}
          className="relative py-8 sm:py-10 bg-[radial-gradient(ellipse_at_center,rgba(225,29,42,0.09),transparent_68%)]"
        >
          <div className="text-center max-w-xl mx-auto space-y-2 mb-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#E11D2A]">
              Trusted Partners
            </p>
            <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Brands We Work With
            </h3>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              Partnered with leading manufacturers for seamless vehicle sourcing across global markets.
            </p>
          </div>

          <div
            aria-label="Partner automotive brands"
            className="flex flex-wrap items-center justify-center gap-x-5 sm:gap-x-8 gap-y-3 border-y border-white/[0.06] py-5"
          >
            {displayBrands.map((brand, idx) => (
              <span key={brand} className="inline-flex items-center gap-5 sm:gap-8">
                <span className="font-display text-xs sm:text-sm font-semibold tracking-[0.22em] text-zinc-400 hover:text-white transition-colors">
                  {brand}
                </span>
                {idx < displayBrands.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="w-1.5 h-1.5 rounded-full bg-[#E11D2A]/75"
                  />
                )}
              </span>
            ))}
          </div>
        </ScrollReveal>

        {/* Ready When You Are CTA Banner */}
        <ScrollReveal
          y={22}
          className="rounded-2xl border border-white/[0.08] bg-[radial-gradient(ellipse_at_top_left,rgba(225,29,42,0.16),transparent_58%),#0e0e13] p-6 sm:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6 shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
        >
          <div className="space-y-2 max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#E11D2A]">
              Ready When You Are
            </p>
            <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Let&apos;s Move Your Next Vehicle
            </h3>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Place a showroom inquiry or speak directly with our import specialists about sourcing, pricing, and customs timelines.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onStartOrder}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-[0_8px_22px_rgba(225,29,42,0.28)]"
            >
              <span>Start Your Order</span>
              <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            </button>

            {onBrowseCollection && (
              <button
                type="button"
                onClick={onBrowseCollection}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-white/15 hover:border-white/40 bg-white/[0.02] text-zinc-200 hover:text-white text-xs sm:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <span>Browse Collection</span>
              </button>
            )}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
