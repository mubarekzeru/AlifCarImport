import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MessageCircle, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import type { Vehicle } from '../types/showroom';
import { buildWhatsAppHref, formatPrice } from '../utils/inventory';

interface NavbarProps {
  companyName: string;
  contactPhone: string;
  searchQuery: string;
  orderedVehicles: Vehicle[];
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onShopNow: () => void;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onRemoveOrder: (vehicleId: string) => void;
  onClearOrders: () => void;
  onNavigateSection: (sectionId: string) => void;
}

export function Navbar({
  companyName,
  contactPhone,
  searchQuery,
  orderedVehicles,
  onSearchChange,
  onSearchSubmit,
  onShopNow,
  onSelectVehicle,
  onRemoveOrder,
  onClearOrders,
  onNavigateSection,
}: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const orderCount = orderedVehicles.length;

  const navItems = [
    { label: 'Inventory', id: 'inventory' },
    { label: 'Browse by Make', id: 'brand-showcase' },
    { label: 'TikTok Reels', id: 'tiktok-showcase' },
    { label: 'Location & Social', id: 'location-contact' },
  ];

  useEffect(() => {
    if (!menuOpen && !searchOpen && !cartOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setSearchOpen(false);
        setCartOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setSearchOpen(false);
        setCartOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen, searchOpen, cartOpen]);

  useEffect(() => {
    if (searchOpen) {
      const timer = window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [searchOpen]);

  const handleNavClick = (id: string) => {
    setMenuOpen(false);
    setCartOpen(false);
    onNavigateSection(id);
  };

  const handleSearchFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    setCartOpen(false);
    setSearchOpen(false);
    onSearchSubmit();
  };

  const whatsappCartHref = buildWhatsAppHref(
    contactPhone,
    orderedVehicles.length > 0
      ? `Hello ${companyName}, I would like to place an order for:\n${orderedVehicles
          .map((v, i) => `${i + 1}. ${v.title} (${formatPrice(v.price)})`)
          .join('\n')}`
      : `Hello ${companyName}, I would like to inquire about your showroom vehicles.`
  );

  return (
    <header
      ref={headerRef}
      className="fixed top-3 right-3 sm:top-5 sm:right-6 z-50 flex items-center justify-end gap-2"
    >
      {/* Expandable Search Input */}
      <AnimatePresence>
        {searchOpen && (
          <motion.form
            role="search"
            onSubmit={handleSearchFormSubmit}
            initial={{ opacity: 0, width: 0, x: 10 }}
            animate={{ opacity: 1, width: 'min(58vw, 250px)', x: 0 }}
            exit={{ opacity: 0, width: 0, x: 10 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="h-10 w-full rounded-full bg-[#141418]/85 backdrop-blur-md border border-white/25 focus-within:border-white/50 px-3.5 flex items-center gap-2 shadow-lg">
              <Search className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search cars, makes..."
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
          </motion.form>
        )}
      </AnimatePresence>

      {/* Compact Icon-Only Search Toggle */}
      <button
        type="button"
        onClick={() => {
          setMenuOpen(false);
          setCartOpen(false);
          setSearchOpen((prev) => !prev);
        }}
        aria-label={searchOpen ? 'Close search' : 'Search showroom vehicles'}
        aria-expanded={searchOpen}
        title="Search"
        className={`relative inline-flex items-center justify-center w-10 h-10 rounded-full backdrop-blur-md border shadow-lg transition-colors shrink-0 cursor-pointer ${
          searchOpen || searchQuery.trim()
            ? 'bg-[#1f1f26]/90 border-white/40 text-white'
            : 'bg-[#141418]/75 border-white/15 hover:border-white/35 text-zinc-100 hover:bg-[#1d1d22]/90'
        }`}
      >
        {searchOpen ? (
          <X className="w-4 h-4 shrink-0" aria-hidden="true" />
        ) : (
          <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
        )}
        {searchQuery.trim() && !searchOpen && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#D92027] ring-2 ring-[#0a0a0c]"
          />
        )}
      </button>

      {/* Shopping Cart Icon — badge only shown when orderCount > 0 */}
      <button
        type="button"
        onClick={() => {
          setMenuOpen(false);
          setSearchOpen(false);
          setCartOpen((prev) => !prev);
        }}
        aria-label={orderCount > 0 ? `Order Bag (${orderCount})` : 'Shop Now'}
        aria-expanded={cartOpen}
        title={orderCount > 0 ? `Order Bag (${orderCount})` : 'Order Bag'}
        className={`relative inline-flex items-center justify-center w-10 h-10 rounded-full backdrop-blur-md border shadow-lg transition-colors shrink-0 cursor-pointer ${
          cartOpen
            ? 'bg-[#1f1f26]/90 border-white/40 text-white'
            : 'bg-[#141418]/75 border-white/15 hover:border-white/35 text-zinc-100 hover:bg-[#1d1d22]/90'
        }`}
      >
        <ShoppingCart className="w-4 h-4 shrink-0" aria-hidden="true" />
        <AnimatePresence>
          {orderCount > 0 && (
            <motion.span
              data-testid="cart-badge-count"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D92027] text-white text-[10px] font-bold flex items-center justify-center shadow ring-2 ring-[#0a0a0c] tabular-nums"
            >
              {orderCount}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Animated Morphing Hamburger -> X Toggle Button */}
      <button
        type="button"
        onClick={() => {
          setSearchOpen(false);
          setCartOpen(false);
          setMenuOpen((prev) => !prev);
        }}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        className={`inline-flex items-center justify-center w-10 h-10 rounded-full backdrop-blur-md border shadow-lg transition-colors shrink-0 cursor-pointer ${
          menuOpen
            ? 'bg-[#1f1f26]/90 border-white/40 text-white'
            : 'bg-[#141418]/75 border-white/15 hover:border-white/35 text-zinc-100 hover:bg-[#1d1d22]/90'
        }`}
      >
        <span aria-hidden="true" className="relative w-5 h-5 flex items-center justify-center">
          <motion.span
            initial={false}
            animate={menuOpen ? { y: 0, rotate: 45 } : { y: -5.5, rotate: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="absolute w-4.5 h-0.5 rounded-full bg-current origin-center"
          />
          <motion.span
            initial={false}
            animate={menuOpen ? { opacity: 0, scaleX: 0 } : { opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute w-4.5 h-0.5 rounded-full bg-current origin-center"
          />
          <motion.span
            initial={false}
            animate={menuOpen ? { y: 0, rotate: -45 } : { y: 5.5, rotate: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="absolute w-4.5 h-0.5 rounded-full bg-current origin-center"
          />
        </span>
      </button>

      {/* Order Bag Popover */}
      <AnimatePresence>
        {cartOpen && (
          <motion.div
            data-testid="order-cart-drawer"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-12 w-80 max-w-[calc(100vw-1.5rem)] bg-[#141418] border border-zinc-800 rounded-xl shadow-2xl p-3 z-50 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="font-display text-xs font-semibold uppercase tracking-wider text-white">
                Your Order Bag ({orderCount})
              </span>
              {orderCount > 0 && (
                <button
                  type="button"
                  onClick={onClearOrders}
                  className="text-[11px] font-medium text-zinc-400 hover:text-red-400 transition-colors cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>

            {orderCount === 0 ? (
              <div className="py-4 text-center space-y-3">
                <p className="text-xs text-zinc-400">
                  No vehicles have been added to your order bag yet.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCartOpen(false);
                    onShopNow();
                  }}
                  className="inline-flex items-center justify-center px-4 py-2 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Browse Vehicles
                </button>
              </div>
            ) : (
              <>
                <ul className="max-h-60 overflow-y-auto divide-y divide-zinc-800/80">
                  {orderedVehicles.map((item) => (
                    <li key={item.id} className="py-2 flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setCartOpen(false);
                          onSelectVehicle(item);
                        }}
                        className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer group"
                      >
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-12 h-9 rounded object-cover bg-zinc-900 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-zinc-100 group-hover:text-sky-300 truncate transition-colors">
                            {item.title}
                          </p>
                          <p className="font-mono text-[11px] font-semibold text-emerald-400 tabular-nums">
                            {formatPrice(item.price)}
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => onRemoveOrder(item.id)}
                        aria-label={`Remove ${item.title} from order`}
                        className="w-7 h-7 rounded-md inline-flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>

                <a
                  href={whatsappCartHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-9 inline-flex items-center justify-center gap-2 px-3 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Complete Order via WhatsApp</span>
                </a>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clean Navigation Menu — starts directly with navigation links */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            data-testid="mobile-nav-menu"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-12 w-60 bg-[#141418] border border-zinc-800 rounded-xl shadow-2xl py-2 z-50"
          >
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
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
