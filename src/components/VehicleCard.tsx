import type { Vehicle } from '../types/showroom';
import { formatPrice, formatVehicleTileModel } from '../utils/inventory';

interface VehicleCardProps {
  vehicle: Vehicle;
  rank?: number;
  onSelect: (vehicle: Vehicle) => void;
}

export function VehicleCard({ vehicle, rank, onSelect }: VehicleCardProps) {
  const modelDisplay = formatVehicleTileModel(vehicle);

  return (
    <article
      data-testid={`vehicle-card-${vehicle.id}`}
      className="group bg-[#141418] border border-zinc-800/90 hover:border-zinc-500 rounded-lg overflow-hidden transition-colors"
    >
      <button
        type="button"
        onClick={() => onSelect(vehicle)}
        aria-label={`${vehicle.title} — ${formatPrice(vehicle.price)}`}
        className="w-full h-full flex flex-col text-left cursor-pointer"
      >
        <div className="relative w-full aspect-[4/3] bg-zinc-900 overflow-hidden">
          <img
            src={vehicle.imageUrl}
            alt={vehicle.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />

          {typeof rank === 'number' && (
            <span
              aria-hidden="true"
              className="absolute top-0 left-0 px-1.5 py-0.5 sm:px-2 sm:py-0.5 bg-[#D92027] text-white text-[10px] sm:text-[11px] font-bold leading-tight rounded-br-md shadow-sm tabular-nums"
            >
              {rank}
            </span>
          )}

          {vehicle.status !== 'available' && (
            <span
              className={`absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${
                vehicle.status === 'reserved'
                  ? 'bg-amber-500/90 text-black'
                  : 'bg-zinc-900/90 text-zinc-300'
              }`}
            >
              {vehicle.status}
            </span>
          )}
        </div>

        <div className="px-2 py-2 sm:px-2.5 sm:py-2.5 flex-1 flex flex-col justify-between gap-1.5">
          <div className="space-y-0.5">
            <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wide text-white truncate">
              {vehicle.make}
            </p>
            <h3 className="text-[11px] sm:text-xs font-medium text-sky-400 leading-snug line-clamp-2 group-hover:text-sky-300 transition-colors">
              {modelDisplay}
            </h3>
          </div>

          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-[10px] sm:text-[11px] text-zinc-400">Price</span>
            <span className="font-mono text-[11px] sm:text-xs font-bold text-emerald-400 tabular-nums">
              {formatPrice(vehicle.price)}
            </span>
          </div>
        </div>
      </button>
    </article>
  );
}
