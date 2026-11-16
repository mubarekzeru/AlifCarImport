import { motion } from 'motion/react';
import type { BrandingSettings, HeroPost } from '../types/showroom';
import { splitDisplayBrandLines } from '../utils/inventory';

interface HeroSectionProps {
  branding: BrandingSettings;
  hero: HeroPost;
  totalVehicles: number;
  availableCount: number;
  onBrowseClick: () => void;
  onContactClick: () => void;
}

export function HeroSection({ branding, hero }: HeroSectionProps) {
  const brandLines = splitDisplayBrandLines(branding.companyName);

  return (
    <section id="top" className="w-full bg-[#0a0a0c]">
      {/* Zoomed-out unblurred hero showroom photograph fading seamlessly into #0a0a0c */}
      <div className="relative w-full overflow-hidden bg-[#0a0a0c] pt-12 sm:pt-8 pb-20 sm:pb-24 lg:pb-28">
        <div className="relative w-full max-w-5xl mx-auto px-2 sm:px-6">
          <div className="relative overflow-hidden">
            <img
              src={hero.imageUrl}
              alt={hero.title || branding.companyName}
              referrerPolicy="no-referrer"
              className="w-full h-auto block object-contain select-none"
            />

            {/* Soft edge vignettes so the zoomed-out frame melts seamlessly into #0a0a0c */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-10 sm:w-24 bg-gradient-to-r from-[#0a0a0c] to-transparent"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-10 sm:w-24 bg-gradient-to-l from-[#0a0a0c] to-transparent"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-8 sm:h-14 bg-gradient-to-b from-[#0a0a0c]/80 to-transparent"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/85 via-45% to-transparent"
            />
          </div>
        </div>

        {/* Full-width bottom dark fade floor behind the lockup */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-32 sm:h-40 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/92 to-transparent"
        />

        {/* Company Logo side-by-side with larger textured Company Name */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-x-0 bottom-0 z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pb-4 sm:pb-6 lg:pb-8"
        >
          <div className="flex items-center justify-center gap-3.5 sm:gap-5 lg:gap-6">
            {branding.logoUrl && (
              <img
                src={branding.logoUrl}
                alt={`${branding.companyName} logo`}
                referrerPolicy="no-referrer"
                className="w-16 h-16 sm:w-[88px] sm:h-[88px] lg:w-28 lg:h-28 rounded-full object-cover bg-white ring-2 ring-white/25 shadow-[0_10px_30px_rgba(0,0,0,0.65)] shrink-0 select-none"
              />
            )}

            <div className="relative inline-block max-w-full text-left">
              <h1 className="hero-wordmark-outline font-black uppercase leading-[0.94] tracking-[0.055em] text-[clamp(2.05rem,5.4vw,4.45rem)] select-none">
                {brandLines.map((line, index) => (
                  <span key={`${line}-${index}`} className="block">
                    {line}
                  </span>
                ))}
              </h1>

              <span
                aria-hidden="true"
                className="hero-wordmark-texture pointer-events-none select-none absolute inset-0 font-black uppercase leading-[0.94] tracking-[0.055em] text-[clamp(2.05rem,5.4vw,4.45rem)] mix-blend-screen"
              >
                {brandLines.map((line, index) => (
                  <span key={`tex-${line}-${index}`} className="block">
                    {line}
                  </span>
                ))}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
