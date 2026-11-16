import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Menu, Search, ShoppingCart, X } from 'lucide-react';
import type { BrandingSettings } from '../types/showroom';

interface NavbarProps {
  branding: BrandingSettings;
  searchQuery: string;
  availableCount: number;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onShopNow: () => void;
  onNavigateSection: (sectionId: string) => void;
}

export function Navbar({
  branding,
  searchQuery,
  availableCount,
  onSearchChange,
  onSearchSubmit,
  onShopNow,
  onNavigateSection,
}: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  const navItems = [
    { label: 'Inventory', id: 'inventory' },
    { label: 'Browse by Make', id: 'brand-showcase' },
    { label: 'TikTok Reels', id: 'tiktok-showcase' },
    { label: 'Location & Social', id: 'location-contact' },
  ];

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const handleNavClick = (id: string) => {
    setMenuOpen(false);
    onNavigateSection(id);
  };

  const handleSearchFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    onSearchSubmit();
  };

  return (
    <header
      ref={menuContainerRef}
      className="fixed top-3 left-3 right-3 sm:left-auto sm:top-5 sm:right-6 z-50 flex items-center justify-end gap-2"
    >
      <form
        role="search"
        onSubmit={handleSearchFormSubmit}
        className="flex-1 sm:flex-initial min-w-0 sm:w-64 md:w-72"
      >
        <div className="h-10 w-full rounded-full bg-[#141418]/75 backdrop-blur-md border border-white/15 focus-within:border-white/40 px-3.5 flex items-center gap-2 shadow-lg transition-colors">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search cars, makes, colors..."
            aria-label="Search showroom vehicles"
            className="w-full min-w-0 bg-transparent text-xs sm:text-sm text-white placeholder:text-zinc-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {searchQuery.trim() && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="w-5 h-5 rounded-full inline-flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </form>

      <button
        type="button"
        onClick={() => {
          setMenuOpen(false);
          onShopNow();
        }}
        aria-label={`Shop Now (${availableCount} available)`}
        title="Shop Now"
        className="relative inline-flex items-center justify-center h-10 w-10 sm:w-auto sm:px-3.5 sm:gap-1.5 rounded-full bg-[#141418]/75 backdrop-blur-md border border-white/15 hover:border-white/35 text-zinc-100 hover:bg-[#1d1d22]/90 shadow-lg transition-colors shrink-0 cursor-pointer"
      >
        <ShoppingCart className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline text-xs font-semibold whitespace-nowrap">
          Shop Now
        </span>
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D92027] text-white text-[10px] font-bold flex items-center justify-center shadow ring-2 ring-[#0a0a0c] tabular-nums"
        >
          {availableCount}
        </span>
      </button>

      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#141418]/75 backdrop-blur-md border border-white/15 shadow-lg text-zinc-100 hover:bg-[#1d1d22]/90 hover:border-white/35 transition-colors shrink-0 cursor-pointer"
      >
        {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-12 w-72 bg-[#141418] border border-zinc-800 rounded-xl shadow-2xl py-2 z-50">
          <div className="px-4 py-2.5 border-b border-zinc-800/80 mb-1 flex items-center gap-2.5">
            {branding.logoUrl && (
              <img
                src={branding.logoUrl}
                alt={branding.companyName}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-cover bg-white border border-zinc-700 shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-white truncate">
                {branding.companyName}
              </p>
              <p className="text-[11px] text-zinc-400 truncate">{branding.tagline}</p>
            </div>
          </div>

          <nav aria-label="Menu navigation" className="px-2 flex flex-col gap-0.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className="w-full text-left px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800/80 hover:text-white rounded-lg cursor-pointer transition-colors"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

