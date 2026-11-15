import { useEffect, useRef, useState } from 'react';
import { Lock, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import type { BrandingSettings } from '../types/showroom';

interface NavbarProps {
  branding: BrandingSettings;
  adminEmail: string | null;
  isAdminView: boolean;
  onOpenAdminLogin: () => void;
  onToggleAdminView: () => void;
  onLogoutAdmin: () => void;
  onNavigateSection: (sectionId: string) => void;
}

export function Navbar({
  branding,
  adminEmail,
  isAdminView,
  onOpenAdminLogin,
  onToggleAdminView,
  onLogoutAdmin,
  onNavigateSection,
}: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  const navItems = [
    { label: 'Inventory', id: 'inventory' },
    { label: 'Browse by Make', id: 'brand-showcase' },
    { label: 'TikTok Reels', id: 'tiktok-showcase' },
    { label: 'Location', id: 'location-contact' },
    { label: 'Contact', id: 'inquiry-form' },
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

  return (
    <header ref={menuContainerRef} className="fixed top-4 right-4 sm:top-5 sm:right-6 z-50">
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#141418]/90 backdrop-blur-md border border-white/15 shadow-lg text-zinc-100 hover:bg-[#1d1d22] hover:border-white/30 transition-colors cursor-pointer"
      >
        {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Dark Hamburger Menu Drawer */}
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

          <nav
            aria-label="Menu navigation"
            className="px-2 pb-2 mb-2 border-b border-zinc-800 flex flex-col gap-0.5"
          >
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

          {/* Admin Access inside Hamburger Menu (Admin Dashboard hidden unless logged in by email) */}
          <div className="px-2 space-y-1">
            {adminEmail ? (
              <>
                <div className="px-3 py-2 text-xs text-zinc-400 border-b border-zinc-800 mb-1">
                  <span className="block font-medium text-white">Signed in as Admin</span>
                  <span className="block truncate">{adminEmail}</span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleAdminView();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-white hover:bg-zinc-800/80 rounded-lg cursor-pointer transition-colors"
                >
                  <ShieldCheck className="w-4 h-4 text-[#D92027]" aria-hidden="true" />
                  <span>{isAdminView ? 'View Showroom' : 'Admin Dashboard'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogoutAdmin();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-zinc-400 hover:bg-zinc-800/80 hover:text-white rounded-lg cursor-pointer transition-colors"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenAdminLogin();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800/80 hover:text-white rounded-lg cursor-pointer transition-colors"
              >
                <Lock className="w-4 h-4 text-[#D92027]" aria-hidden="true" />
                <span>Admin Login</span>
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
