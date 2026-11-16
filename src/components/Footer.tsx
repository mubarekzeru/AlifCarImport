import { MapPin, Phone } from 'lucide-react';
import type { BrandingSettings, LocationContact, TikTokSectionConfig } from '../types/showroom';
import { getConfiguredSocialLinks } from '../utils/inventory';
import { ScrollReveal } from './ScrollReveal';
import { SocialMediaIconRow } from './SocialIcons';

interface FooterProps {
  branding: BrandingSettings;
  contact: LocationContact;
  tiktok: TikTokSectionConfig;
}

export function Footer({ branding, contact, tiktok }: FooterProps) {
  const socialLinks = getConfiguredSocialLinks(contact, tiktok, branding.companyName);

  return (
    <footer className="border-t border-zinc-800 bg-[#070709] text-zinc-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          <ScrollReveal y={24} className="space-y-3">
            <div className="flex items-center gap-3">
              {branding.logoUrl && (
                <img
                  src={branding.logoUrl}
                  alt={branding.companyName}
                  referrerPolicy="no-referrer"
                  className="w-11 h-11 rounded-full object-cover bg-white shrink-0 shadow-sm"
                />
              )}
              <div>
                <span className="font-display text-base font-bold text-white block uppercase tracking-wide">
                  {branding.companyName}
                </span>
                <span className="text-xs text-zinc-400">{branding.tagline}</span>
              </div>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed max-w-sm">
              Direct global automotive sourcing, transparent inspection records, and showroom delivery.
            </p>
          </ScrollReveal>

          <ScrollReveal y={24} delay={0.07} className="space-y-2 text-xs">
            <p className="font-semibold text-white uppercase tracking-wider">Showroom Location</p>
            <p className="flex items-start gap-2 text-zinc-300">
              <MapPin className="w-4 h-4 text-[#D92027] shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                {contact.addressLine}, {contact.cityCountry}
              </span>
            </p>
            <p className="flex items-center gap-2 text-zinc-300 tabular-nums">
              <Phone className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
              <span>{contact.phone}</span>
            </p>
            <p className="text-zinc-500">{contact.hours}</p>
          </ScrollReveal>

          <ScrollReveal y={24} delay={0.14} className="space-y-3 text-xs">
            <p className="font-semibold text-white uppercase tracking-wider">Connect</p>
            <SocialMediaIconRow links={socialLinks} companyName={branding.companyName} />
          </ScrollReveal>
        </div>

        <ScrollReveal
          y={16}
          delay={0.16}
          className="mt-10 pt-6 border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500"
        >
          <span>
            © {new Date().getFullYear()} {branding.companyName}. All rights reserved.
          </span>
          <span>{contact.email}</span>
        </ScrollReveal>
      </div>
    </footer>
  );
}
