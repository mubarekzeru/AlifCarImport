import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Car, ChevronDown, RotateCcw, Search, X } from 'lucide-react';
import type { Vehicle, VehicleFilters } from '../types/showroom';

interface SearchFilterBarProps {
  filters: VehicleFilters;
  vehicles: Vehicle[];
  makes: string[];
  models: string[];
  years: number[];
  totalCount: number;
  filteredCount: number;
  onChange: (next: VehicleFilters) => void;
  onReset: () => void;
  onSubmitSearch?: () => void;
}

interface DarkComboFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  options: string[];
  allOptionLabel: string;
  onChange: (value: string) => void;
  inputMode?: 'text' | 'numeric';
}

function DarkComboField({
  id,
  label,
  value,
  placeholder,
  options,
  allOptionLabel,
  onChange,
  inputMode = 'text',
}: DarkComboFieldProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const filteredOptions = value.trim()
    ? options.filter((opt) => opt.toLowerCase().includes(value.trim().toLowerCase()))
    : options;

  const displayOptions = filteredOptions.length > 0 ? filteredOptions : options;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex flex-col justify-center bg-[#1c1c21] border border-zinc-700/80 hover:border-zinc-500 focus-within:border-[#D92027] rounded-lg px-3 py-1.5 transition-colors">
        <label
          htmlFor={id}
          className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 leading-none mb-0.5"
        >
          {label}
        </label>
        <div className="flex items-center gap-1">
          <input
            id={id}
            type="text"
            inputMode={inputMode}
            value={value}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
            }}
            placeholder={placeholder}
            aria-expanded={open}
            aria-autocomplete="list"
            autoComplete="off"
            className="w-full h-6 bg-transparent text-xs sm:text-sm font-medium text-white placeholder:text-zinc-500 focus:outline-none pr-12"
          />

          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label={`Clear ${label}`}
              className="absolute right-8 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-label={`Toggle ${label} options`}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700/60 cursor-pointer"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {open && (
        <ul
          role="listbox"
          aria-label={`${label} options`}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-56 overflow-y-auto bg-[#18181d] border border-zinc-700 rounded-lg shadow-2xl py-1"
        >
          <li>
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                value === ''
                  ? 'bg-[#D92027]/20 text-white'
                  : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              {allOptionLabel}
            </button>
          </li>
          {displayOptions.map((option) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                  value.toLowerCase() === option.toLowerCase()
                    ? 'bg-[#D92027]/25 text-white font-semibold'
                    : 'text-zinc-200 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SearchFilterBar({
  filters,
  vehicles,
  makes,
  models,
  years,
  totalCount,
  filteredCount,
  onChange,
  onReset,
  onSubmitSearch,
}: SearchFilterBarProps) {
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!searchMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSearchMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [searchMenuOpen]);

  const hasActiveFilter = Boolean(filters.query || filters.make || filters.model || filters.year);

  const quickSearchSuggestions = vehicles
    .filter((v) => {
      if (!filters.query.trim()) return true;
      const q = filters.query.trim().toLowerCase();
      return (
        v.title.toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        String(v.year).includes(q)
      );
    })
    .slice(0, 8);

  return (
    <div className="bg-[#141418] border border-zinc-800 rounded-xl p-3 sm:p-4 shadow-2xl space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-stretch">
        {/* Left Title Block matching Rvinyl "SHOP BY VEHICLE" */}
        <div className="lg:col-span-2 flex items-center justify-between lg:justify-start gap-2.5 px-1 sm:px-2 py-1">
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-[#D92027] shrink-0" aria-hidden="true" />
            <span className="font-display text-xs font-bold uppercase tracking-wider text-white whitespace-nowrap">
              Shop By Vehicle
            </span>
          </div>
          <span className="lg:hidden text-[11px] font-mono text-zinc-400 tabular-nums">
            {filteredCount}/{totalCount}
          </span>
        </div>

        {/* Year + Make + Model + Keyword Comboboxes */}
        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <DarkComboField
            id="filter-year"
            label="Year"
            value={filters.year}
            placeholder="All Years"
            options={years.map(String)}
            allOptionLabel="All Years"
            inputMode="numeric"
            onChange={(year) => onChange({ ...filters, year })}
          />

          <DarkComboField
            id="filter-make"
            label="Make"
            value={filters.make}
            placeholder="All Makes"
            options={makes}
            allOptionLabel="All Makes"
            onChange={(make) =>
              onChange({
                ...filters,
                make,
                model: '',
              })
            }
          />

          <DarkComboField
            id="filter-model"
            label="Model"
            value={filters.model}
            placeholder="All Models"
            options={models}
            allOptionLabel="All Models"
            onChange={(model) => onChange({ ...filters, model })}
          />

          {/* Keyword Search with typing + dropdown options */}
          <div ref={searchBoxRef} className="relative">
            <div className="relative flex flex-col justify-center bg-[#1c1c21] border border-zinc-700/80 hover:border-zinc-500 focus-within:border-[#D92027] rounded-lg px-3 py-1.5 transition-colors">
              <label
                htmlFor="vehicle-search"
                className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 leading-none mb-0.5"
              >
                Keyword
              </label>
              <div className="flex items-center gap-1">
                <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
                <input
                  id="vehicle-search"
                  type="text"
                  value={filters.query}
                  onFocus={() => setSearchMenuOpen(true)}
                  onChange={(e) => {
                    onChange({ ...filters, query: e.target.value });
                    setSearchMenuOpen(true);
                  }}
                  placeholder="Search trim..."
                  aria-label="Search imported vehicles"
                  aria-expanded={searchMenuOpen}
                  autoComplete="off"
                  className="w-full h-6 bg-transparent text-xs sm:text-sm font-medium text-white placeholder:text-zinc-500 focus:outline-none pr-8"
                />
                {filters.query && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...filters, query: '' })}
                    aria-label="Clear search query"
                    className="absolute right-8 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSearchMenuOpen((prev) => !prev)}
                  aria-label="Toggle quick vehicle options"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700/60 cursor-pointer"
                >
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${searchMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>
            </div>

            {searchMenuOpen && (
              <ul
                role="listbox"
                aria-label="Quick vehicle options"
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-60 overflow-y-auto bg-[#18181d] border border-zinc-700 rounded-lg shadow-2xl py-1"
              >
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ ...filters, query: '' });
                      setSearchMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white cursor-pointer"
                  >
                    All Vehicles ({totalCount})
                  </button>
                </li>
                {quickSearchSuggestions.map((vehicle) => (
                  <li key={vehicle.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({ ...filters, query: vehicle.title });
                        setSearchMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800 hover:text-white cursor-pointer flex items-center justify-between gap-2"
                    >
                      <span className="font-medium truncate">{vehicle.title}</span>
                      <span className="text-[11px] text-zinc-400 shrink-0">{vehicle.year}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right Crimson Primary CTA Button matching "Find parts ->" */}
        <div className="lg:col-span-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (onSubmitSearch) {
                onSubmitSearch();
              } else {
                document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            className="w-full h-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Find Vehicles</span>
            <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/80 text-xs text-zinc-400">
        <span>
          Showing{' '}
          <strong className="text-white font-semibold tabular-nums">{filteredCount}</strong> of{' '}
          <span className="tabular-nums text-zinc-300">{totalCount}</span> imported vehicles
          <span className="hidden sm:inline text-zinc-500">
            {' '}
            · Type directly or click the down arrow to browse options
          </span>
        </span>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D92027] hover:text-red-400 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reset Filters</span>
          </button>
        )}
      </div>
    </div>
  );
}
