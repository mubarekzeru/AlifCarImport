import { useEffect, useMemo, useState } from 'react';
import { Car, Cog, Fuel, Gauge } from 'lucide-react';
import { motion } from 'motion/react';
import type { Vehicle } from '../types/showroom';
import {
  formatPrice,
  formatVehicleTileModel,
  getPublicAssetFallbackUrls,
} from '../utils/inventory';

interface VehicleCardProps {
  vehicle: Vehicle;
  rank?: number;
  index?: number;
  onSelect: (vehicle: Vehicle) => void;
}

export function VehicleCard({ vehicle, index = 0, onSelect }: VehicleCardProps) {
  const modelDisplay = formatVehicleTileModel(vehicle);
  const staggerIndex = typeof index === 'number' ? index : 0;

  const imageCandidates = useMemo(
    () => getPublicAssetFallbackUrls(vehicle.imageUrl),
    [vehicle.imageUrl]
  );
  const [candidateIdx, setCandidateIdx] = useState(0);

  useEffect(() => {
    setCandidateIdx(0);
  }, [vehicle.imageUrl]);

  const activeImageSrc = imageCandidates[candidateIdx] ?? '';

  const specs = [
    vehicle.mileage?.trim() ? { key: 'mileage', value: vehicle.mileage.trim(), Icon: Gauge } : null,
    vehicle.fuelType?.trim() ? { key: 'fuel', value: vehicle.fuelType.trim(), Icon: Fuel } : null,
    vehicle.transmission?.trim()
      ? { key: 'transmission', value: vehicle.transmission.trim(), Icon: Cog }
      : null,
  ].filter((item): item is { key: string; value: string; Icon: typeof Gauge } => Boolean(item));

  return (
    <motion.article
      data-testid={`vehicle-card-${vehicle.id}`}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } }}
      viewport={{ once: true, amount: 'some' }}
      transition={{
        duration: 0.38,
        delay: Math.min(staggerIndex * 0.04, 0.3),
        ease: [0.22, 1, 0.36, 1],
      }}
      className="group bg-[#111115] border border-white/[0.08] hover:border-white/25 rounded-xl sm:rounded-2xl overflow-hidden transition-colors duration-300"
    >
      <button
        type="button"
        onClick={() => onSelect(vehicle)}
        aria-label={`${vehicle.title} — ${formatPrice(vehicle.price)}`}
        className="w-full h-full flex flex-col text-left cursor-pointer"
      >
        <div className="relative w-full aspect-[16/10] shrink-0 bg-zinc-950 overflow-hidden">
          {activeImageSrc ? (
            <img
              src={activeImageSrc}
              alt={vehicle.title}
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => {
                if (candidateIdx + 1 < imageCandidates.length) {
                  setCandidateIdx((prev) => prev + 1);
                } else {
                  setCandidateIdx(imageCandidates.length);
                }
              }}
              className="absolute inset-0 block w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 text-zinc-600">
              <Car className="w-8 h-8" aria-hidden="true" />
            </div>
          )}

          {vehicle.status !== 'available' && (
            <span
              className={`absolute top-2 right-2 sm:top-3 sm:right-3 z-10 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider backdrop-blur-md ${
                vehicle.status === 'reserved'
                  ? 'bg-amber-400/90 text-black'
                  : 'bg-black/80 text-zinc-200 border border-white/15'
              }`}
            >
              {vehicle.status}
            </span>
          )}
        </div>

        <div className="p-3 sm:p-5 flex-1 flex flex-col justify-between gap-2.5 sm:gap-4 w-full">
          <div className="space-y-1 sm:space-y-1.5 min-w-0">
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.1em] sm:tracking-[0.14em] text-[#E11D2A] truncate">
              {vehicle.make} · {vehicle.year}
            </p>
            <h3 className="font-display text-sm sm:text-lg font-bold text-white leading-snug line-clamp-1 group-hover:text-rose-200 transition-colors">
              {modelDisplay}
            </h3>

            {specs.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-1 text-[11px] sm:text-xs text-zinc-400 pt-0.5 sm:pt-1">
                {specs.map(({ key, value, Icon }, specIdx) => (
                  <span
                    key={key}
                    className={`${
                      specIdx > 0 ? 'hidden sm:inline-flex' : 'inline-flex'
                    } items-center gap-1 whitespace-nowrap truncate max-w-full`}
                  >
                    <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
                    <span className="truncate">{value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2.5 sm:pt-3.5 border-t border-white/[0.07] flex items-center justify-between gap-2 sm:gap-3">
            <span className="font-mono text-xs sm:text-sm font-semibold text-white tabular-nums shrink-0">
              {formatPrice(vehicle.price)}
            </span>
            <span className="text-[10px] sm:text-xs text-zinc-500 truncate">{vehicle.origin}</span>
          </div>
        </div>
      </button>
    </motion.article>
  );
}
