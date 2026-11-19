import {
  ArrowUpRight,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from 'lucide-react';
import { ALIF_DEFAULT_LOGO } from '../data/seedData';
import type { LocationContact, TikTokSectionConfig } from '../types/showroom';
import {
  buildWhatsAppHref,
  getConfiguredSocialLinks,
  resolvePublicAssetUrl,
  type SocialPlatform,
} from '../utils/inventory';
import { ScrollReveal } from './ScrollReveal';
import { SocialPlatformIcon } from './SocialIcons';

interface LocationContactSectionProps {
  contact: LocationContact;
  companyName: string;
  logoUrl?: string;
  tiktok?: TikTokSectionConfig;
}

const CHANNEL_SUBTITLES: Record<SocialPlatform, string> = {
  tiktok: 'Behind-the-scenes walkarounds and fresh vehicle drops',
  whatsapp: 'Direct vehicle inquiries, quotes, and fast reservations',
  telegram: 'Chat with our showroom team and get quick inventory updates',
  instagram: 'Curated gallery of imports, interiors, and customer deliveries',
  facebook: 'Latest showroom arrivals, announcements, and community updates',
  x: 'Real-time shipment alerts and showroom arrival highlights',
};

export function LocationContactSection({
  contact,
  companyName,
  logoUrl,
  tiktok,
}: LocationContactSectionProps) {
  const whatsappHref = buildWhatsAppHref(
    contact.whatsapp || contact.phone,
    `Hello ${companyName}, I would like to visit the showroom or order an imported vehicle.`
  );
  const socialLinks = getConfiguredSocialLinks(contact, tiktok, companyName);

  return (
    <section
      id="location-contact"
      className="scroll-mt-20 border-t border-white/[0.07] bg-[#08080a] py-16 sm:py-22"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10 sm:space-y-12">
        {/* Header + Primary Direct Actions */}
        <ScrollReveal
          y={24}
          className="flex flex-col lg:flex-row lg:items-end justify-between gap-6"
        >
          <div className="flex items-start gap-4 max-w-2xl">
            {(logoUrl || ALIF_DEFAULT_LOGO) && (
              <img
                src={resolvePublicAssetUrl(logoUrl) || ALIF_DEFAULT_LOGO}
                alt={companyName}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  if (!e.currentTarget.src.endsWith(ALIF_DEFAULT_LOGO)) {
                    e.currentTarget.src = ALIF_DEFAULT_LOGO;
                  }
                }}
                className="w-12 h-12 rounded-full object-cover bg-white shrink-0 shadow-sm mt-0.5"
              />
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#E11D2A]">
                Stay Connected &amp; Visit Us
              </p>
              <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white">
                Follow &amp; Visit {companyName}
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Inspect vehicles in person, verify customs documentation, or reach our showroom sales team on your preferred channel.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs sm:text-sm font-semibold rounded-full transition-colors whitespace-nowrap shadow-[0_8px_22px_rgba(225,29,42,0.25)]"
            >
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
              <span>Chat on WhatsApp</span>
            </a>

            <a
              href={`tel:${contact.phone.replace(/\s+/g, '')}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-white/15 hover:border-white/40 text-zinc-200 hover:text-white text-xs sm:text-sm font-medium rounded-full transition-colors whitespace-nowrap"
            >
              <Phone className="w-4 h-4" aria-hidden="true" />
              <span>Call Showroom</span>
            </a>
          </div>
        </ScrollReveal>

        {/* Showroom Location, Direct Line & Hours Cards */}
        <ScrollReveal
          y={24}
          delay={0.04}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          <div className="bg-[#0d0d11] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-[#E11D2A]/12 border border-[#E11D2A]/25 text-[#E11D2A] inline-flex items-center justify-center shrink-0">
                <MapPin className="w-4 h-4" aria-hidden="true" />
              </span>
              <h3 className="font-display text-sm font-semibold text-white">Showroom Address</h3>
            </div>
            <div className="space-y-1 text-xs sm:text-sm">
              <p className="text-zinc-200">{contact.addressLine}</p>
              <p className="text-zinc-400">{contact.cityCountry}</p>
              {contact.landmarkNote && (
                <p className="text-xs text-zinc-500">{contact.landmarkNote}</p>
              )}
              {contact.mapsUrl && (
                <a
                  href={contact.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#E11D2A] hover:text-red-400 hover:underline pt-1"
                >
                  <span>Open in Google Maps</span>
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>

          <div className="bg-[#0d0d11] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] text-zinc-200 inline-flex items-center justify-center shrink-0">
                <Phone className="w-4 h-4" aria-hidden="true" />
              </span>
              <h3 className="font-display text-sm font-semibold text-white">Phone &amp; Email</h3>
            </div>
            <div className="space-y-1.5 text-xs sm:text-sm">
              <p className="tabular-nums">
                <a
                  href={`tel:${contact.phone.replace(/\s+/g, '')}`}
                  className="text-zinc-200 hover:text-[#E11D2A] transition-colors font-medium"
                >
                  {contact.phone}
                </a>
              </p>
              <p className="flex items-center gap-1.5 text-zinc-400">
                <Mail className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
                <a
                  href={`mailto:${contact.email}`}
                  className="hover:text-white transition-colors truncate"
                >
                  {contact.email}
                </a>
              </p>
            </div>
          </div>

          <div className="bg-[#0d0d11] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] text-zinc-200 inline-flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" aria-hidden="true" />
              </span>
              <h3 className="font-display text-sm font-semibold text-white">Showroom Hours</h3>
            </div>
            <div className="space-y-1 text-xs sm:text-sm">
              <p className="text-zinc-200">{contact.hours}</p>
              <p className="text-xs text-zinc-500">
                Walk-in inspections &amp; scheduled handovers welcome.
              </p>
            </div>
          </div>
        </ScrollReveal>

        {/* Interactive 2-Column Follow Channel Cards */}
        {socialLinks.length > 0 && (
          <ScrollReveal
            y={26}
            delay={0.08}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <div className="contents" data-testid="contact-social-links">
              {socialLinks.map((item) => (
                <a
                  key={item.platform}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${companyName} on ${item.label}`}
                  className="group bg-[#0d0d11] hover:bg-[#131319] border border-white/[0.08] hover:border-white/25 rounded-2xl p-5 sm:p-6 transition-all flex flex-col justify-between gap-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <span className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.08] text-zinc-100 inline-flex items-center justify-center shrink-0">
                        <SocialPlatformIcon platform={item.platform} className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-semibold text-white">
                          {item.label}
                        </h3>
                        <p className="text-xs font-medium text-[#E11D2A] truncate mt-0.5">
                          {item.handleText}
                        </p>
                      </div>
                    </div>

                    <span className="w-8 h-8 rounded-full border border-white/[0.09] group-hover:border-[#E11D2A]/60 text-zinc-400 group-hover:text-white inline-flex items-center justify-center shrink-0 transition-colors">
                      <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                    {CHANNEL_SUBTITLES[item.platform]}
                  </p>
                </a>
              ))}
            </div>
          </ScrollReveal>
        )}
      </div>
    </section>
  );
}
