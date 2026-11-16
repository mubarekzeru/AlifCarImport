import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Film,
  MessageCircle,
  Phone,
  Share2,
  ShoppingBag,
} from 'lucide-react';
import type { LocationContact, Vehicle } from '../types/showroom';
import {
  buildWhatsAppHref,
  formatPrice,
  formatVehicleTileModel,
  getRelatedShowroomVehicles,
  getSimilarVehicles,
  getVehicleGalleryImages,
  getVehiclePricingBreakdown,
} from '../utils/inventory';
import { VehicleCard } from './VehicleCard';

interface VehicleDetailPageProps {
  vehicle: Vehicle;
  allVehicles: Vehicle[];
  companyName: string;
  contact: LocationContact;
  onBackHome: () => void;
  onFilterByMake: (make: string) => void;
  onSelectVehicle: (vehicle: Vehicle) => void;
}

const THUMBS_PER_PAGE = 8;

export function VehicleDetailPage({
  vehicle,
  allVehicles,
  companyName,
  contact,
  onBackHome,
  onFilterByMake,
  onSelectVehicle,
}: VehicleDetailPageProps) {
  const images = useMemo(() => getVehicleGalleryImages(vehicle), [vehicle]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [thumbPage, setThumbPage] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);

  const pricing = useMemo(() => getVehiclePricingBreakdown(vehicle), [vehicle]);
  const similarMatches = useMemo(
    () => getSimilarVehicles(allVehicles, vehicle),
    [allVehicles, vehicle]
  );
  const displaySimilar = useMemo(
    () =>
      similarMatches.length > 0
        ? similarMatches
        : getRelatedShowroomVehicles(allVehicles, vehicle),
    [similarMatches, allVehicles, vehicle]
  );

  useEffect(() => {
    setActiveIndex(0);
    setThumbPage(0);
    setCopiedLink(false);
  }, [vehicle.id]);

  useEffect(() => {
    if (images.length <= 1) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
      } else if (e.key === 'ArrowRight') {
        setActiveIndex((prev) => (prev + 1) % images.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [images.length]);

  useEffect(() => {
    const nextPage = Math.floor(activeIndex / THUMBS_PER_PAGE);
    setThumbPage(nextPage);
  }, [activeIndex]);

  const totalThumbPages = Math.max(1, Math.ceil(images.length / THUMBS_PER_PAGE));
  const thumbStart = thumbPage * THUMBS_PER_PAGE;
  const visibleThumbs = images.slice(thumbStart, thumbStart + THUMBS_PER_PAGE);

  const currentImage = images[activeIndex] || vehicle.imageUrl;
  const modelDisplay = formatVehicleTileModel(vehicle);
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';

  const orderNowHref = buildWhatsAppHref(
    contact.whatsapp || contact.phone,
    `Hello ${companyName}, I would like to order / reserve the ${vehicle.title} (${formatPrice(
      pricing.finalPrice
    )}).`
  );

  const whatsappShareHref = `https://wa.me/?text=${encodeURIComponent(
    `${vehicle.title} — ${formatPrice(pricing.finalPrice)} at ${companyName}${
      shareUrl ? `\n${shareUrl}` : ''
    }`
  )}`;

  const facebookShareHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
    shareUrl || 'https://alifcarimport.com'
  )}`;

  const handleCopyShareLink = async () => {
    if (!shareUrl) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: vehicle.title,
          text: `${vehicle.title} — ${formatPrice(pricing.finalPrice)}`,
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled or unsupported; fall back to clipboard copy
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopiedLink(true);
        window.setTimeout(() => setCopiedLink(false), 2000);
      } catch {
        // Ignore clipboard errors
      }
    }
  };

  const statusText =
    vehicle.status === 'available'
      ? 'Available in Store'
      : vehicle.status === 'reserved'
      ? 'Reserved'
      : 'Sold';

  const statusTextClass =
    vehicle.status === 'available'
      ? 'text-emerald-400'
      : vehicle.status === 'reserved'
      ? 'text-amber-400'
      : 'text-zinc-400';

  return (
    <main
      id="vehicle-detail-page"
      className="flex-1 bg-[#0a0a0c] text-zinc-100 pt-16 sm:pt-18 pb-16"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Top Navigation + Breadcrumb */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-[#141418] hover:border-zinc-600 text-xs font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Back to Showroom</span>
            </button>
          </div>

          <nav
            aria-label="Vehicle breadcrumb"
            className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-400"
          >
            <button
              type="button"
              onClick={onBackHome}
              className="text-sky-400 hover:text-sky-300 font-medium uppercase cursor-pointer"
            >
              HOME
            </button>
            <span aria-hidden="true" className="text-zinc-600">
              »
            </span>
            <button
              type="button"
              onClick={() => onFilterByMake(vehicle.make)}
              className="text-sky-400 hover:text-sky-300 font-medium uppercase cursor-pointer"
            >
              {vehicle.make}
            </button>
            <span aria-hidden="true" className="text-zinc-600">
              »
            </span>
            <span className="text-zinc-300">{vehicle.model}</span>
            <span aria-hidden="true" className="text-zinc-600">
              »
            </span>
            <span className="text-zinc-300 tabular-nums">{vehicle.year}</span>
            <span aria-hidden="true" className="text-zinc-600">
              »
            </span>
            <span className="text-zinc-200 font-medium">{modelDisplay}</span>
          </nav>

          <div className="space-y-1">
            <p className="font-display text-lg sm:text-xl font-bold uppercase tracking-tight text-white tabular-nums">
              {vehicle.year} {vehicle.make}
            </p>
            <h1 className="font-display text-xl sm:text-3xl font-bold tracking-tight text-white leading-tight">
              {modelDisplay}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 pt-0.5">
              <span className={`font-semibold ${statusTextClass}`}>{statusText}</span>
              <span aria-hidden="true">·</span>
              <span>{vehicle.origin}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{vehicle.mileage}</span>
            </div>
          </div>
        </div>

        {/* Two-Column Gallery + Pricing Breakdown & Specifications */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Main Large Image + Thumbnails Row + Share Buttons */}
          <div className="lg:col-span-7 space-y-3">
            <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800">
              {currentImage ? (
                <img
                  src={currentImage}
                  alt={`${vehicle.title} photo ${activeIndex + 1} of ${images.length}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm text-zinc-500">
                  No photo available
                </div>
              )}

              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveIndex((prev) => (prev - 1 + images.length) % images.length)
                    }
                    aria-label="Previous vehicle photo"
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 hover:bg-black/80 text-white inline-flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => (prev + 1) % images.length)}
                    aria-label="Next vehicle photo"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 hover:bg-black/80 text-white inline-flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}

              <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-md bg-black/75 border border-white/10 text-xs font-medium text-white tabular-nums">
                {activeIndex + 1} / {Math.max(1, images.length)}
              </div>
            </div>

            {images.length > 0 && (
              <div className="flex items-center gap-2">
                {totalThumbPages > 1 && (
                  <button
                    type="button"
                    onClick={() => setThumbPage((p) => Math.max(0, p - 1))}
                    disabled={thumbPage === 0}
                    aria-label="Previous thumbnails"
                    className="w-8 h-8 rounded-full bg-[#18181d] border border-zinc-700 disabled:opacity-40 text-zinc-200 hover:border-white inline-flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                )}

                <div
                  data-testid="vehicle-gallery-thumbs"
                  className="flex-1 grid grid-cols-4 sm:grid-cols-6 gap-2"
                >
                  {visibleThumbs.map((imgUrl, idx) => {
                    const absoluteIndex = thumbStart + idx;
                    const isSelected = absoluteIndex === activeIndex;
                    return (
                      <button
                        key={`${imgUrl}-${absoluteIndex}`}
                        type="button"
                        onClick={() => setActiveIndex(absoluteIndex)}
                        aria-label={`View photo ${absoluteIndex + 1}`}
                        aria-current={isSelected ? 'true' : undefined}
                        className={`aspect-[4/3] rounded-md overflow-hidden border-2 transition-all cursor-pointer bg-zinc-900 ${
                          isSelected
                            ? 'border-[#D92027] ring-1 ring-[#D92027]/50'
                            : 'border-zinc-800 hover:border-zinc-500 opacity-80 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={imgUrl}
                          alt={`${vehicle.title} thumbnail ${absoluteIndex + 1}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    );
                  })}
                </div>

                {totalThumbPages > 1 && (
                  <button
                    type="button"
                    onClick={() => setThumbPage((p) => Math.min(totalThumbPages - 1, p + 1))}
                    disabled={thumbPage >= totalThumbPages - 1}
                    aria-label="Next thumbnails"
                    className="w-8 h-8 rounded-full bg-[#18181d] border border-zinc-700 disabled:opacity-40 text-zinc-200 hover:border-white inline-flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {/* Share Buttons Row */}
            <div className="pt-1 flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
              <a
                href={facebookShareHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold transition-colors"
              >
                <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Facebook Share</span>
              </a>

              <button
                type="button"
                onClick={handleCopyShareLink}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                    <span>Link Copied</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Share Link</span>
                  </>
                )}
              </button>

              <a
                href={whatsappShareHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#25D366] hover:bg-[#20BD5A] text-zinc-950 text-xs font-bold transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>WhatsApp Share</span>
              </a>
            </div>
          </div>

          {/* Right Column: Detailed Pricing Breakdown + Action Buttons + Specifications */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-[#141418] border border-zinc-800 rounded-xl p-5 sm:p-6 space-y-5">
              {/* Pricing Breakdown (Original Price, Discount, Final Price) */}
              <div data-testid="pricing-breakdown" className="space-y-2.5 border-b border-zinc-800 pb-4">
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-zinc-400">Original Price</span>
                  <span
                    className={`font-mono tabular-nums ${
                      pricing.hasDiscount ? 'text-zinc-400 line-through' : 'text-zinc-200 font-medium'
                    }`}
                  >
                    {pricing.originalPrice > 0 ? formatPrice(pricing.originalPrice) : 'Price on Request'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-zinc-400">Discount</span>
                  <span
                    className={`font-mono tabular-nums font-semibold ${
                      pricing.hasDiscount ? 'text-red-400' : 'text-zinc-400'
                    }`}
                  >
                    {pricing.hasDiscount
                      ? `-${formatPrice(pricing.discountAmount)} (${pricing.discountPercent}% off)`
                      : '$0 (Direct Import)'}
                  </span>
                </div>

                <div className="pt-2 border-t border-zinc-800/80 flex items-baseline justify-between gap-4">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300 block">
                      Final Price
                    </span>
                    <span className="text-[11px] text-zinc-400">{vehicle.origin}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-2xl sm:text-3xl font-bold text-emerald-400 tabular-nums block">
                      {formatPrice(pricing.finalPrice)}
                    </span>
                    <span className={`text-xs font-semibold ${statusTextClass}`}>{statusText}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2.5">
                <a
                  href={orderNowHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-11 inline-flex items-center justify-center gap-2 px-5 bg-[#D92027] hover:bg-[#B91C1C] text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                  <span>Order Now</span>
                </a>

                <div className="grid grid-cols-2 gap-2.5">
                  <a
                    href={orderNowHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-11 inline-flex items-center justify-center gap-2 px-4 border border-zinc-700 hover:border-white text-zinc-100 text-xs sm:text-sm font-medium rounded-lg transition-colors"
                  >
                    <MessageCircle className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>WhatsApp</span>
                  </a>

                  <a
                    href={`tel:${contact.phone.replace(/\s+/g, '')}`}
                    className="h-11 inline-flex items-center justify-center gap-2 px-4 border border-zinc-700 hover:border-white text-zinc-100 text-xs sm:text-sm font-medium rounded-lg transition-colors"
                  >
                    <Phone className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Call Showroom</span>
                  </a>
                </div>

                {vehicle.tiktokUrl && (
                  <a
                    href={vehicle.tiktokUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full h-10 inline-flex items-center justify-center gap-2 px-4 border border-zinc-800 bg-[#18181d] hover:border-zinc-600 text-xs font-medium text-zinc-200 hover:text-white rounded-lg transition-colors"
                  >
                    <Film className="w-4 h-4 text-[#D92027]" aria-hidden="true" />
                    <span>Watch Walkaround on TikTok</span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>

              {/* Specifications Table */}
              <div className="space-y-2.5 pt-2 border-t border-zinc-800">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-300">
                  Vehicle Specifications
                </h2>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:text-sm">
                  <div>
                    <dt className="text-zinc-400">Make</dt>
                    <dd className="font-medium text-white">{vehicle.make}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Model</dt>
                    <dd className="font-medium text-white">{vehicle.model}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Year</dt>
                    <dd className="font-medium text-white tabular-nums">{vehicle.year}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Mileage</dt>
                    <dd className="font-medium text-white tabular-nums">{vehicle.mileage}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Transmission</dt>
                    <dd className="font-medium text-white">{vehicle.transmission}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Engine / Fuel</dt>
                    <dd className="font-medium text-white">{vehicle.fuelType}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Exterior Color</dt>
                    <dd className="font-medium text-white">{vehicle.color}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Import Origin</dt>
                    <dd className="font-medium text-white">{vehicle.origin}</dd>
                  </div>
                </dl>
              </div>

              {/* Vehicle Description */}
              <div className="space-y-2 pt-2 border-t border-zinc-800">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-300">
                  Vehicle Description
                </h2>
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                  {vehicle.description}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Recommendation Section: Similar Vehicles (same make or origin, Top Sellers grid) */}
        {displaySimilar.length > 0 && (
          <section
            id="similar-vehicles"
            className="pt-8 border-t border-zinc-800 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg sm:text-2xl font-bold uppercase tracking-tight text-white">
                  {similarMatches.length > 0 ? 'Similar Vehicles' : 'Available Vehicles in Store'}
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400">
                  {similarMatches.length > 0
                    ? `Other ${vehicle.make} or ${vehicle.origin} vehicles currently in our showroom.`
                    : `Explore other imported vehicles currently ready at ${companyName}.`}
                </p>
              </div>

              <button
                type="button"
                onClick={onBackHome}
                className="text-xs sm:text-sm font-semibold text-sky-400 hover:text-sky-300 cursor-pointer"
              >
                See all vehicles →
              </button>
            </div>

            <div
              data-testid="detail-related-grid"
              className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3.5"
            >
              {displaySimilar.map((item, idx) => (
                <VehicleCard
                  key={item.id}
                  vehicle={item}
                  rank={idx + 1}
                  index={idx}
                  onSelect={onSelectVehicle}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
