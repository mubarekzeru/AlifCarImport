import type { BrandingSettings, HeroPost } from '../types/showroom';

interface HeroSectionProps {
  branding: BrandingSettings;
  hero: HeroPost;
  totalVehicles: number;
  availableCount: number;
  onBrowseClick: () => void;
  onContactClick: () => void;
}

export function HeroSection({ branding, hero }: HeroSectionProps) {
  return (
    <section id="top" className="w-full bg-[#0a0a0c]">
      {/* Edge-to-edge full-bleed landscape showroom image fading smoothly into #0a0a0c */}
      <div className="relative w-full overflow-hidden bg-[#0a0a0c]">
        <img
          src={hero.imageUrl}
          alt={hero.title || branding.companyName}
          referrerPolicy="no-referrer"
          className="w-full h-auto block select-none"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 sm:h-28 lg:h-36 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/85 via-38% to-transparent"
        />
      </div>
    </section>
  );
}
