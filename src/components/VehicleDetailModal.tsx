import { useEffect } from 'react';
import { ExternalLink, Film, MessageCircle, Phone, X } from 'lucide-react';
import type { LocationContact, Vehicle } from '../types/showroom';
import { buildWhatsAppHref, formatPrice } from '../utils/inventory';

interface VehicleDetailModalProps {
  vehicle: Vehicle | null;
  contact: LocationContact;
  onClose: () => void;
  onInquireVehicle: (vehicle: Vehicle) => void;
}

export function VehicleDetailModal({
  vehicle,
  contact,
  onClose,
  onInquireVehicle,
}: VehicleDetailModalProps) {
  useEffect(() => {
    if (!vehicle) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [vehicle, onClose]);

  if (!vehicle) return null;

  const whatsappUrl = buildWhatsAppHref(
    contact.whatsapp || contact.phone,
    `Hello Alif Car Import, I am interested in the ${vehicle.title} (${formatPrice(vehicle.price)}).`
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-[#141418] border border-zinc-800 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-[#141418] border-b border-zinc-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {vehicle.make} · {vehicle.model} · {vehicle.year}
            </p>
            <h2 id="vehicle-detail-title" className="font-display text-xl font-semibold text-white">
              {vehicle.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close vehicle details"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="aspect-[16/10] w-full rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800">
            <img
              src={vehicle.imageUrl}
              alt={vehicle.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-4 pb-4 border-b border-zinc-800">
            <div>
              <span className="text-xs uppercase tracking-wider text-zinc-400 block">
                Showroom Price
              </span>
              <span className="font-mono text-2xl font-bold text-white tabular-nums">
                {formatPrice(vehicle.price)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#D92027]">
                {vehicle.status}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-xs text-zinc-400">{vehicle.origin}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-[#1c1c21] rounded-lg border border-zinc-800">
              <span className="block text-xs text-zinc-400">Mileage</span>
              <span className="font-medium text-white tabular-nums">{vehicle.mileage}</span>
            </div>
            <div className="p-3 bg-[#1c1c21] rounded-lg border border-zinc-800">
              <span className="block text-xs text-zinc-400">Transmission</span>
              <span className="font-medium text-white">{vehicle.transmission}</span>
            </div>
            <div className="p-3 bg-[#1c1c21] rounded-lg border border-zinc-800">
              <span className="block text-xs text-zinc-400">Engine / Fuel</span>
              <span className="font-medium text-white">{vehicle.fuelType}</span>
            </div>
            <div className="p-3 bg-[#1c1c21] rounded-lg border border-zinc-800">
              <span className="block text-xs text-zinc-400">Exterior Color</span>
              <span className="font-medium text-white">{vehicle.color}</span>
            </div>
            <div className="p-3 bg-[#1c1c21] rounded-lg border border-zinc-800">
              <span className="block text-xs text-zinc-400">Import Origin</span>
              <span className="font-medium text-white">{vehicle.origin}</span>
            </div>
            <div className="p-3 bg-[#1c1c21] rounded-lg border border-zinc-800">
              <span className="block text-xs text-zinc-400">Model Year</span>
              <span className="font-medium text-white tabular-nums">{vehicle.year}</span>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-display text-base font-semibold text-white">
              Vehicle Description
            </h3>
            <p className="text-sm text-zinc-300 leading-relaxed">{vehicle.description}</p>
          </div>

          <div className="pt-4 border-t border-zinc-800 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                onInquireVehicle(vehicle);
                onClose();
              }}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#D92027] hover:bg-[#B91C1C] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Inquire About This Car
            </button>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-zinc-700 hover:border-white text-zinc-200 hover:text-white text-sm font-medium rounded-lg transition-colors"
            >
              <MessageCircle className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <span>WhatsApp Showroom</span>
            </a>

            <a
              href={`tel:${contact.phone.replace(/\s+/g, '')}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-zinc-700 hover:border-white text-zinc-200 hover:text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Phone className="w-4 h-4" aria-hidden="true" />
              <span>Call</span>
            </a>

            {vehicle.tiktokUrl && (
              <a
                href={vehicle.tiktokUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:text-white ml-auto"
              >
                <Film className="w-4 h-4 text-[#D92027]" aria-hidden="true" />
                <span>Watch on TikTok</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
