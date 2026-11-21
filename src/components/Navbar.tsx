import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MessageCircle, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import type { Vehicle } from '../types/showroom';
import { buildWhatsAppHref, formatPrice, resolvePublicAssetUrl } from '../utils/inventory';

interface NavbarProps {
  companyName: string;
  logoUrl?: string;
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
    { label: 'Home', id: 'top' },
    { label: 'Collection', id: 'inventory' },
    { label: 'Process', id: 'how-it-works' },
    { label: 'Reels', id: 'tiktok-showcase' },
    { label: 'Contact', id: 'location-contact' },
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
    <header ref={headerRef} className="fixed inset-x-0 top-0 z-50 pointer-events-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3.5 sm:pt-4 flex items-center justify-end pointer-events-none">
        {/* Floating Utility Icons Only: Search, Shop Bag & Menu */}
        <div className="relative flex items-center gap-2 shrink-0 pointer-events-auto">
          <AnimatePresence>
            {searchOpen && (
              <motion.form
                role="search"
                onSubmit={handleSearchFormSubmit}
                initial={{ opacity: 0, width: 0, x: 8 }}
                animate={{ opacity: 1, width: 'min(52vw, 230px)', x: 0 }}
                exit={{ opacity: 0, width: 0, x: 8 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="h-9 w-full rounded-full bg-black/75 backdrop-blur-md border border-white/25 focus-within:border-[#E11D2A] px-3 flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search make, model..."
                    aria-label="Search showroom vehicles"
                    className="w-full min-w-0 bg-transparent text-xs text-white placeholder:text-zinc-500 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
                  />
                  {searchQuery.trim() && (
                    <button
                      type="button"
                      onClick={() => onSearchChange('')}
                      aria-label="Clear search"
                      className="w-4 h-4 rounded-full inline-flex items-center justify-center text-zinc-400 hover:text-white shrink-0 cursor-pointer"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </motion.form>
            )}
          </AnimatePresence>

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
            className={`relative inline-flex items-center justify-center w-9 h-9 rounded-full border backdrop-blur-md transition-colors shrink-0 cursor-pointer ${
              searchOpen || searchQuery.trim()
                ? 'bg-black/80 border-white/40 text-white'
                : 'bg-black/50 border-white/15 hover:bg-black/70 hover:border-white/35 text-zinc-100 hover:text-white'
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
                className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#E11D2A] ring-2 ring-[#08080a]"
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setSearchOpen(false);
              setCartOpen((prev) => !prev);
            }}
            aria-label={orderCount > 0 ? `Order Bag (${orderCount})` : 'Order Bag'}
            aria-expanded={cartOpen}
            title={orderCount > 0 ? `Order Bag (${orderCount})` : 'Order Bag'}
            className={`relative inline-flex items-center justify-center w-9 h-9 rounded-full border backdrop-blur-md transition-colors shrink-0 cursor-pointer ${
              cartOpen
                ? 'bg-black/80 border-white/40 text-white'
                : 'bg-black/50 border-white/15 hover:bg-black/70 hover:border-white/35 text-zinc-100 hover:text-white'
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
                  className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#E11D2A] text-white text-[10px] font-bold flex items-center justify-center shadow ring-2 ring-[#08080a] tabular-nums"
                >
                  {orderCount}
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setCartOpen(false);
              setMenuOpen((prev) => !prev);
            }}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className={`inline-flex items-center justify-center w-9 h-9 rounded-full border backdrop-blur-md transition-colors shrink-0 cursor-pointer ${
              menuOpen
                ? 'bg-black/80 border-white/40 text-white'
                : 'bg-black/50 border-white/15 hover:bg-black/70 hover:border-white/35 text-zinc-100'
            }`}
          >
            <span aria-hidden="true" className="relative w-4 h-4 flex items-center justify-center">
              <motion.span
                initial={false}
                animate={menuOpen ? { y: 0, rotate: 45 } : { y: -4.5, rotate: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute w-4 h-0.5 rounded-full bg-current origin-center"
              />
              <motion.span
                initial={false}
                animate={menuOpen ? { opacity: 0, scaleX: 0 } : { opacity: 1, scaleX: 1 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="absolute w-4 h-0.5 rounded-full bg-current origin-center"
              />
              <motion.span
                initial={false}
                animate={menuOpen ? { y: 0, rotate: -45 } : { y: 4.5, rotate: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute w-4 h-0.5 rounded-full bg-current origin-center"
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
                className="absolute right-0 top-12 w-80 max-w-[calc(100vw-2rem)] bg-[#111115] border border-white/10 rounded-2xl shadow-2xl p-3.5 z-50 space-y-3"
              >
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <span className="font-display text-xs font-semibold uppercase tracking-wider text-white">
                    Your Order Bag ({orderCount})
                  </span>
                  {orderCount > 0 && (
                    <button
                      type="button"
                      onClick={onClearOrders}
                      className="text-[11px] font-medium text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
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
                      className="inline-flex items-center justify-center px-4 py-2 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold rounded-full transition-colors cursor-pointer"
                    >
                      Browse Vehicles
                    </button>
                  </div>
                ) : (
                  <>
                    <ul className="max-h-60 overflow-y-auto divide-y divide-white/[0.06]">
                      {orderedVehicles.map((item) => (
                        <li key={item.id} className="py-2.5 flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              setCartOpen(false);
                              onSelectVehicle(item);
                            }}
                            className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer group"
                          >
                            <img
                              src={resolvePublicAssetUrl(item.imageUrl)}
                              alt={item.title}
                              decoding="async"
                              referrerPolicy="no-referrer"
                              className="w-12 h-9 rounded-md object-cover bg-zinc-900 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-zinc-100 group-hover:text-rose-300 truncate transition-colors">
                                {item.title}
                              </p>
                              <p className="font-mono text-[11px] font-semibold text-zinc-300 tabular-nums">
                                {formatPrice(item.price)}
                              </p>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => onRemoveOrder(item.id)}
                            aria-label={`Remove ${item.title} from order`}
                            className="w-7 h-7 rounded-md inline-flex items-center justify-center text-zinc-400 hover:text-rose-400 hover:bg-white/[0.06] transition-colors shrink-0 cursor-pointer"
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
                      className="w-full h-9 inline-flex items-center justify-center gap-2 px-3 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold rounded-full transition-colors"
                    >
                      <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Complete Order via WhatsApp</span>
                    </a>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mobile Navigation Drawer */}
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                data-testid="mobile-nav-menu"
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.96 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="absolute right-0 top-12 w-60 bg-[#111115] border border-white/10 rounded-2xl shadow-2xl py-2.5 z-50"
              >
                <nav aria-label="Menu navigation" className="px-2 flex flex-col gap-0.5">
                  {navItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavClick(item.id)}
                      className="w-full text-left px-3 py-2.5 text-sm font-medium text-zinc-300 hover:bg-white/[0.06] hover:text-white rounded-xl cursor-pointer transition-colors"
                    >
                      {item.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onShopNow();
                    }}
                    className="mt-1.5 mx-1 py-2.5 px-3 rounded-full bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold text-center cursor-pointer transition-colors"
                  >
                    Browse Cars
                  </button>
                </nav>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
