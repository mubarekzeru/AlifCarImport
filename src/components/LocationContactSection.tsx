import { useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
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
import { submitCustomerInquiry } from '../utils/storeClient';
import { SocialMediaIconRow } from './SocialIcons';

interface LocationContactSectionProps {
  contact: LocationContact;
  companyName: string;
  logoUrl?: string;
  tiktok?: TikTokSectionConfig;
  selectedVehicleTitle: string;
  onClearSelectedVehicle: () => void;
}

export function LocationContactSection({
  contact,
  companyName,
  logoUrl,
  tiktok,
  selectedVehicleTitle,
  onClearSelectedVehicle,
}: LocationContactSectionProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [vehicleTitle, setVehicleTitle] = useState(selectedVehicleTitle);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (selectedVehicleTitle) {
      setVehicleTitle(selectedVehicleTitle);
      setMessage(
        `Hello, I would like more details and viewing availability for the ${selectedVehicleTitle}.`
      );
      setSubmitted(false);
    }
  }, [selectedVehicleTitle]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!name.trim() || !phone.trim()) {
      setErrorMsg('Please enter your name and phone number.');
      return;
    }

    setSubmitting(true);
    try {
      await submitCustomerInquiry({
        name,
        phone,
        email,
        vehicleTitle,
        message,
      });
      setSubmitted(true);
      setName('');
      setPhone('');
      setEmail('');
      setVehicleTitle('');
      setMessage('');
      onClearSelectedVehicle();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to submit inquiry.');
    } finally {
      setSubmitting(false);
    }
  };

  const whatsappHref = buildWhatsAppHref(
    contact.whatsapp || contact.phone,
    `Hello ${companyName}, I would like to visit the showroom or ask about an imported vehicle.`
  );
  const socialLinks = getConfiguredSocialLinks(contact, tiktok, companyName);

  return (
    <section
      id="location-contact"
      className="scroll-mt-6 border-t border-zinc-800 bg-[#0a0a0c] py-14 sm:py-16"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Left: Location & Direct Contact Details */}
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-2">
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
                Inspect our imported vehicles in person, review customs and auction paperwork, or arrange a private viewing with our sales team.
              </p>
            </div>

            <div className="divide-y divide-zinc-800 border-y border-zinc-800">
              <div className="py-4 flex items-start gap-3.5">
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

              <div className="py-4 flex items-start gap-3.5">
                <Phone className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-white">Phone & WhatsApp</h3>
                  <p className="text-sm text-zinc-300 tabular-nums">
                    <a
                      href={`tel:${contact.phone.replace(/\s+/g, '')}`}
                      className="hover:text-[#D92027] transition-colors"
                    >
                      {contact.phone}
                    </a>
                  </p>
                  <div className="pt-1">
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:underline"
                    >
                      <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Chat on WhatsApp ({contact.whatsapp || contact.phone})</span>
                    </a>
                  </div>
                </div>
              </div>

              <div className="py-4 flex items-start gap-3.5">
                <Mail className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-white">Email</h3>
                  <a
                    href={`mailto:${contact.email}`}
                    className="text-sm text-zinc-300 hover:text-[#D92027] transition-colors"
                  >
                    {contact.email}
                  </a>
                </div>
              </div>

              <div className="py-4 flex items-start gap-3.5">
                <Clock className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-white">Showroom Hours</h3>
                  <p className="text-sm text-zinc-300">{contact.hours}</p>
                </div>
              </div>

              {socialLinks.length > 0 && (
                <div className="py-4 flex items-start gap-3.5" data-testid="contact-social-links">
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
            </div>
          </div>

          {/* Right: Customer Inquiry Form */}
          <div
            id="inquiry-form"
            className="scroll-mt-6 lg:col-span-6 bg-[#141418] border border-zinc-800 rounded-xl p-6 sm:p-8"
          >
            <div className="space-y-1.5 mb-6">
              <h3 className="font-display text-xl font-bold text-white uppercase">
                Send an Inquiry
              </h3>
              <p className="text-sm text-zinc-400">
                Ask about pricing, import documentation, or schedule a showroom test drive.
              </p>
            </div>

            {submitted ? (
              <div className="bg-[#1b1b20] border border-zinc-700 rounded-lg p-6 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                  <span>Inquiry received by {companyName}</span>
                </div>
                <p className="text-sm text-zinc-300">
                  Thank you for reaching out. Our showroom team will contact you shortly via phone or WhatsApp.
                </p>
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="text-xs font-semibold text-[#D92027] hover:underline cursor-pointer"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="inq-name" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Full Name *
                    </label>
                    <input
                      id="inq-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="w-full h-11 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D92027]"
                    />
                  </div>
                  <div>
                    <label htmlFor="inq-phone" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Phone / WhatsApp *
                    </label>
                    <input
                      id="inq-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+251 9..."
                      className="w-full h-11 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D92027]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="inq-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Email (optional)
                    </label>
                    <input
                      id="inq-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full h-11 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D92027]"
                    />
                  </div>
                  <div>
                    <label htmlFor="inq-vehicle" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Vehicle of Interest
                    </label>
                    <input
                      id="inq-vehicle"
                      type="text"
                      value={vehicleTitle}
                      onChange={(e) => setVehicleTitle(e.target.value)}
                      placeholder="e.g. 2024 Toyota Land Cruiser"
                      className="w-full h-11 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D92027]"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="inq-message" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Message
                  </label>
                  <textarea
                    id="inq-message"
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Let us know when you would like to visit or ask any questions about the car..."
                    className="w-full p-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                {errorMsg && (
                  <p role="alert" className="text-xs font-medium text-[#D92027]">
                    {errorMsg}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-11 bg-[#D92027] hover:bg-[#B91C1C] disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {submitting ? 'Sending Inquiry...' : 'Submit Inquiry'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
