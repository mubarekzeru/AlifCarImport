import { motion } from 'motion/react';
import { ALIF_DEFAULT_HERO_VIDEO, ALIF_DEFAULT_LOGO } from '../data/seedData';
import type { BrandingSettings, HeroPost } from '../types/showroom';
import { resolvePublicAssetUrl, splitDisplayBrandLines } from '../utils/inventory';

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
  const videoSrc =
    resolvePublicAssetUrl(hero.videoUrl) || resolvePublicAssetUrl(ALIF_DEFAULT_HERO_VIDEO);
  const rawPoster = resolvePublicAssetUrl(hero.imageUrl);
  const posterSrc =
    rawPoster && !rawPoster.includes('1794743573450_afe14f04') ? rawPoster : '';
  const logoSrc = resolvePublicAssetUrl(branding.logoUrl) || ALIF_DEFAULT_LOGO;

  return (
    <section id="top" className="w-full bg-[#0a0a0c]">
      {/* Full-bleed background video: covers entire first screen on desktop/PC and responsive widescreen on mobile */}
      <div className="relative w-full min-h-[340px] h-[58vw] max-h-[82svh] sm:h-[70svh] md:h-[100dvh] md:min-h-[620px] md:max-h-none overflow-hidden bg-[#0a0a0c]">
        {videoSrc ? (
          <video
            key={videoSrc}
            src={videoSrc}
            poster={posterSrc || undefined}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-label={hero.title || branding.companyName}
            className="absolute inset-0 w-full h-full object-cover object-center select-none pointer-events-none"
          />
        ) : posterSrc ? (
          <img
            src={posterSrc}
            alt={hero.title || branding.companyName}
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover object-center select-none"
          />
        ) : null}

        {/* Subtle top gradient so floating top-right nav icons stay crisp */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-20 sm:h-28 bg-gradient-to-b from-[#0a0a0c]/65 via-[#0a0a0c]/25 to-transparent"
        />

        {/* Soft side vignettes & deep bottom gradient fading seamlessly into #0a0a0c */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-8 sm:w-20 bg-gradient-to-r from-[#0a0a0c]/45 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 sm:w-20 bg-gradient-to-l from-[#0a0a0c]/45 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[56%] sm:h-[48%] bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/82 via-40% to-transparent"
        />

        {/* Company Logo side-by-side with larger textured Company Name */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-x-0 bottom-0 z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pb-4 sm:pb-7 lg:pb-10"
        >
          <div className="flex items-center justify-center gap-3.5 sm:gap-5 lg:gap-6">
            {logoSrc && (
              <img
                src={logoSrc}
                alt={`${branding.companyName} logo`}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  if (!e.currentTarget.src.endsWith(ALIF_DEFAULT_LOGO)) {
                    e.currentTarget.src = ALIF_DEFAULT_LOGO;
                  }
                }}
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
