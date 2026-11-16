import {
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Share2,
} from 'lucide-react';
import type { LocationContact, TikTokSectionConfig } from '../types/showroom';
import { buildWhatsAppHref, getConfiguredSocialLinks } from '../utils/inventory';
import { ScrollReveal } from './ScrollReveal';
import { SocialMediaIconRow } from './SocialIcons';

interface LocationContactSectionProps {
  contact: LocationContact;
  companyName: string;
  logoUrl?: string;
  tiktok?: TikTokSectionConfig;
}

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
      className="scroll-mt-6 border-t border-zinc-800 bg-[#0a0a0c] py-14 sm:py-16"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Left: Showroom Summary & Direct Order / Visit Actions */}
          <ScrollReveal y={28} className="lg:col-span-5 space-y-5">
            <div className="flex items-center gap-3.5">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt={companyName}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-full object-cover bg-white shrink-0 shadow-sm"
                />
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#D92027]">
                  Location &amp; Contact
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white uppercase">
                  Visit {companyName}
                </h2>
              </div>
            </div>

            <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
              Inspect our imported vehicles in person, review customs and auction paperwork, or contact our showroom sales team directly via WhatsApp or phone.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors"
              >
                <MessageCircle className="w-4 h-4" aria-hidden="true" />
                <span>Chat on WhatsApp</span>
              </a>

              <a
                href={`tel:${contact.phone.replace(/\s+/g, '')}`}
                className="inline-flex items-center gap-2 px-4 py-2.5 border border-zinc-700 hover:border-white text-zinc-200 hover:text-white text-xs sm:text-sm font-medium rounded-lg transition-colors"
              >
                <Phone className="w-4 h-4" aria-hidden="true" />
                <span>Call Showroom</span>
              </a>
            </div>
          </ScrollReveal>

          {/* Right: Showroom Location, Hours, Direct Contact & Social Links */}
          <ScrollReveal
            y={32}
            delay={0.08}
            className="lg:col-span-7 bg-[#141418] border border-zinc-800 rounded-xl p-6 sm:p-7 divide-y divide-zinc-800"
          >
            <div className="pb-4 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-[#D92027] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-white">Showroom Address</h3>
                  <p className="text-sm text-zinc-300">{contact.addressLine}</p>
                  <p className="text-sm text-zinc-400">{contact.cityCountry}</p>
                  {contact.landmarkNote && (
                    <p className="text-xs text-zinc-500">{contact.landmarkNote}</p>
                  )}
                  {contact.mapsUrl && (
                    <a
                      href={contact.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#D92027] hover:text-red-400 hover:underline pt-1"
                    >
                      <span>Open Directions in Google Maps</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Phone className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-white">Phone &amp; WhatsApp</h3>
                    <p className="text-sm text-zinc-300 tabular-nums">
                      <a
                        href={`tel:${contact.phone.replace(/\s+/g, '')}`}
                        className="hover:text-[#D92027] transition-colors"
                      >
                        {contact.phone}
                      </a>
                    </p>
                    <p className="text-xs text-zinc-400 tabular-nums">
                      WhatsApp: {contact.whatsapp || contact.phone}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-white">Email</h3>
                    <a
                      href={`mailto:${contact.email}`}
                      className="text-sm text-zinc-300 hover:text-[#D92027] transition-colors"
                    >
                      {contact.email}
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-white">Showroom Hours</h3>
                    <p className="text-sm text-zinc-300">{contact.hours}</p>
                  </div>
                </div>
              </div>
            </div>

            {socialLinks.length > 0 && (
              <div className="pt-5 flex items-start gap-3" data-testid="contact-social-links">
                <Share2 className="w-5 h-5 text-[#D92027] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-2.5">
                  <h3 className="text-sm font-semibold text-white">Social Media &amp; Messaging</h3>
                  <SocialMediaIconRow
                    links={socialLinks}
                    companyName={companyName}
                    showLabels
                  />
                </div>
              </div>
            )}
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
