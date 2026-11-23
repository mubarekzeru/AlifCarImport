import { ALIF_DEFAULT_LOGO } from '../data/seedData';
import type { BrandingSettings, LocationContact, TikTokSectionConfig } from '../types/showroom';
import { getConfiguredSocialLinks, resolvePublicAssetUrl } from '../utils/inventory';
import { SocialMediaIconRow } from './SocialIcons';

interface FooterProps {
  branding: BrandingSettings;
  contact: LocationContact;
  tiktok: TikTokSectionConfig;
  onNavigateSection?: (sectionId: string) => void;
}

function renderTwoToneBrand(companyName: string, fallbackTagline: string) {
  const normalized = companyName.trim() || 'Alif Car Import';
  const match = normalized.match(/^(Alif)\s+(Car)\s*(.*)$/i);
  if (match) {
    const [, firstWord, secondWord, rest] = match;
    return (
      <div>
        <span className="font-display text-lg font-bold tracking-tight text-white block leading-none">
          {firstWord} <span className="text-[#E11D2A]">{secondWord}</span>
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-400 block mt-1">
          {rest.trim() || fallbackTagline || 'Import'}
        </span>
      </div>
    );
  }

  return (
    <div>
      <span className="font-display text-base font-bold text-white block uppercase tracking-wide">
        {normalized}
      </span>
      <span className="text-[11px] text-zinc-400 block">{fallbackTagline}</span>
    </div>
  );
}

export function Footer({ branding, contact, tiktok }: FooterProps) {
  const socialLinks = getConfiguredSocialLinks(contact, tiktok, branding.companyName);

  return (
    <footer className="border-t border-white/[0.07] bg-[#060608] text-zinc-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-8 sm:pt-16 sm:pb-10">
        <div>
          {/* Brand Column + Circular Social Buttons */}
          <div className="space-y-5">
            <div className="flex items-center gap-3.5">
              {(branding.logoUrl || ALIF_DEFAULT_LOGO) && (
                <img
                  src={resolvePublicAssetUrl(branding.logoUrl) || ALIF_DEFAULT_LOGO}
                  alt={branding.companyName}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    if (!e.currentTarget.src.endsWith(ALIF_DEFAULT_LOGO)) {
                      e.currentTarget.src = ALIF_DEFAULT_LOGO;
                    }
                  }}
                  className="w-11 h-11 rounded-full object-cover bg-white shrink-0 shadow-sm"
                />
              )}
              {renderTwoToneBrand(branding.companyName, branding.tagline)}
            </div>

            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-sm">
              {branding.companyName} — your trusted partner for global vehicle imports. Curated inventory, transparent pricing, and dedicated service.
            </p>

            {socialLinks.length > 0 && (
              <div className="space-y-3 pt-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                  Follow Us
                </p>
                <SocialMediaIconRow
                  links={socialLinks}
                  companyName={branding.companyName}
                  variant="circle"
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-white/[0.07] text-center text-xs text-zinc-500">
          © {new Date().getFullYear()} {branding.companyName}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
