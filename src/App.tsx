import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminLoginModal } from './components/AdminLoginModal';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { LocationContactSection } from './components/LocationContactSection';
import { Navbar } from './components/Navbar';
import { SearchFilterBar } from './components/SearchFilterBar';
import { TikTokShowcase } from './components/TikTokShowcase';
import { VehicleCard } from './components/VehicleCard';
import { VehicleDetailModal } from './components/VehicleDetailModal';
import { INITIAL_SHOWROOM_STORE } from './data/seedData';
import type { ShowroomStore, Vehicle, VehicleFilters, VehicleStatus } from './types/showroom';
import { filterVehicles, formatPrice, getFilterOptions } from './utils/inventory';
import {
  checkAdminSession,
  loadShowroomStore,
  logoutAdmin,
  resetShowroomStore,
  saveShowroomStore,
} from './utils/storeClient';

const INITIAL_FILTERS: VehicleFilters = {
  query: '',
  make: '',
  model: '',
  year: '',
};

type MatrixMode = 'make' | 'origin' | 'status';
type ShowcaseTab = 'all' | 'featured' | 'available' | 'reserved';

const COLOR_SWATCHES = [
  { label: 'All Colors', query: '', swatchClass: 'bg-zinc-900 border-zinc-700', isReset: true },
  { label: 'Pearl White', query: 'White', swatchClass: 'bg-[#f4f4f5] border-zinc-400' },
  { label: 'Obsidian Black', query: 'Black', swatchClass: 'bg-[#121215] border-zinc-600' },
  { label: 'Carmine Red', query: 'Red', swatchClass: 'bg-[#D92027] border-red-400/50' },
  { label: 'Titanium Silver', query: 'Silver', swatchClass: 'bg-[#9ca3af] border-zinc-500' },
  { label: 'Slate Gray', query: 'Gray', swatchClass: 'bg-[#52525b] border-zinc-500' },
  { label: 'Deep Emerald', query: 'Emerald', swatchClass: 'bg-[#14532d] border-emerald-700/50' },
  { label: 'Cobalt Blue', query: 'Blue', swatchClass: 'bg-[#1d4ed8] border-blue-500/50' },
];

export default function App() {
  const [store, setStore] = useState<ShowroomStore>(INITIAL_SHOWROOM_STORE);
  const [loaded, setLoaded] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filters, setFilters] = useState<VehicleFilters>(INITIAL_FILTERS);
  const [matrixMode, setMatrixMode] = useState<MatrixMode>('make');
  const [showcaseTab, setShowcaseTab] = useState<ShowcaseTab>('all');
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [inquiryVehicleTitle, setInquiryVehicleTitle] = useState('');
  const saveTimerRef = useRef<number | null>(null);
  const storeRef = useRef<ShowroomStore>(INITIAL_SHOWROOM_STORE);

  useEffect(() => {
    let active = true;
    loadShowroomStore().then(async (data) => {
      const session = await checkAdminSession(data.adminEmails);
      if (!active) return;
      storeRef.current = data;
      setStore(data);
      setAdminEmail(session.authenticated ? session.email : null);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const persistStoreNow = async (targetStore: ShowroomStore): Promise<boolean> => {
    setSaveState('saving');
    setSaveError(null);
    try {
      await saveShowroomStore(targetStore);
      setSaveState('saved');
      return true;
    } catch (err) {
      setSaveState('error');
      setSaveError(
        err instanceof Error ? err.message : 'Unable to publish changes to server.'
      );
      return false;
    }
  };

  const handleUpdateStore = async (
    nextStoreOrUpdater: ShowroomStore | ((prev: ShowroomStore) => ShowroomStore),
    immediate = false
  ): Promise<boolean> => {
    if (!adminEmail) return false;
    const nextStore =
      typeof nextStoreOrUpdater === 'function'
        ? nextStoreOrUpdater(storeRef.current)
        : nextStoreOrUpdater;

    storeRef.current = nextStore;
    setStore(nextStore);
    setSaveState('saving');
    setSaveError(null);

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (immediate) {
      return persistStoreNow(nextStore);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void persistStoreNow(storeRef.current);
    }, 250);
    return true;
  };

  const handleResetDefaults = async () => {
    if (!adminEmail) return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const fresh = await resetShowroomStore();
      storeRef.current = fresh;
      setStore(fresh);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      setSaveError(err instanceof Error ? err.message : 'Failed to reset defaults.');
    }
  };

  const handleLogoutAdmin = async () => {
    await logoutAdmin();
    setAdminEmail(null);
    setIsAdminView(false);
  };

  const filterOptions = useMemo(
    () => getFilterOptions(store.vehicles, filters.make),
    [store.vehicles, filters.make]
  );

  const effectiveStatusFilter: VehicleStatus | 'all' =
    showcaseTab === 'available'
      ? 'available'
      : showcaseTab === 'reserved'
      ? 'reserved'
      : 'all';

  const filteredVehicles = useMemo(() => {
    const base = filterVehicles(store.vehicles, {
      ...filters,
      status: effectiveStatusFilter,
    });
    if (showcaseTab === 'featured') {
      return base.filter((v) => v.featured);
    }
    return base;
  }, [store.vehicles, filters, effectiveStatusFilter, showcaseTab]);

  const featuredSpotlight = useMemo(() => {
    const picks = store.vehicles.filter((v) => v.featured);
    return (picks.length >= 2 ? picks : store.vehicles).slice(0, 2);
  }, [store.vehicles]);

  const makeMatrixItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of store.vehicles) {
      counts.set(v.make, (counts.get(v.make) ?? 0) + 1);
    }
    const items = Array.from(counts.entries()).map(([name, count]) => ({
      key: name,
      title: name,
      subtitle: `${count} ${count === 1 ? 'vehicle' : 'vehicles'}`,
      active: filters.make.toLowerCase() === name.toLowerCase(),
      onClick: () => {
        setFilters((prev) => ({
          ...prev,
          make: prev.make.toLowerCase() === name.toLowerCase() ? '' : name,
          model: '',
        }));
        document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
      },
    }));

    const featuredCount = store.vehicles.filter((v) => v.featured).length;
    if (items.length % 4 !== 0) {
      items.push({
        key: '__featured',
        title: 'Featured',
        subtitle: `${featuredCount} ${featuredCount === 1 ? 'vehicle' : 'vehicles'}`,
        active: showcaseTab === 'featured',
        onClick: () => {
          setShowcaseTab((prev) => (prev === 'featured' ? 'all' : 'featured'));
          document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
        },
      });
    }
    if (items.length % 4 !== 0) {
      items.push({
        key: '__all_imports',
        title: 'All Imports',
        subtitle: `${store.vehicles.length} vehicles`,
        active: false,
        onClick: () => {
          setFilters(INITIAL_FILTERS);
          setShowcaseTab('all');
          document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
        },
      });
    }
    return items;
  }, [store.vehicles, filters.make, filters.query, showcaseTab]);

  const originMatrixItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of store.vehicles) {
      counts.set(v.origin, (counts.get(v.origin) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([origin, count]) => ({
      key: origin,
      title: origin,
      subtitle: `${count} ${count === 1 ? 'vehicle' : 'vehicles'}`,
      active: filters.query.toLowerCase() === origin.toLowerCase(),
      onClick: () => {
        setFilters((prev) => ({
          ...prev,
          query: prev.query.toLowerCase() === origin.toLowerCase() ? '' : origin,
        }));
        document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
      },
    }));
  }, [store.vehicles, filters.query]);

  const statusMatrixItems = useMemo(() => {
    const available = store.vehicles.filter((v) => v.status === 'available').length;
    const reserved = store.vehicles.filter((v) => v.status === 'reserved').length;
    const featured = store.vehicles.filter((v) => v.featured).length;
    return [
      {
        key: 'all',
        title: 'All Imports',
        subtitle: `${store.vehicles.length} vehicles`,
        active: showcaseTab === 'all',
        onClick: () => {
          setShowcaseTab('all');
          document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
        },
      },
      {
        key: 'available',
        title: 'Available Now',
        subtitle: `${available} vehicles`,
        active: showcaseTab === 'available',
        onClick: () => {
          setShowcaseTab('available');
          document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
        },
      },
      {
        key: 'featured',
        title: 'Featured Arrivals',
        subtitle: `${featured} vehicles`,
        active: showcaseTab === 'featured',
        onClick: () => {
          setShowcaseTab('featured');
          document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
        },
      },
      {
        key: 'reserved',
        title: 'Reserved Units',
        subtitle: `${reserved} vehicles`,
        active: showcaseTab === 'reserved',
        onClick: () => {
          setShowcaseTab('reserved');
          document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
        },
      },
    ];
  }, [store.vehicles, showcaseTab]);

  const activeMatrixItems =
    matrixMode === 'make'
      ? makeMatrixItems
      : matrixMode === 'origin'
      ? originMatrixItems
      : statusMatrixItems;

  const availableCount = useMemo(
    () => store.vehicles.filter((v) => v.status === 'available').length,
    [store.vehicles]
  );

  const scrollToSection = (sectionId: string) => {
    if (isAdminView) {
      setIsAdminView(false);
      window.setTimeout(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
      return;
    }
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
  };

  const canShowAdminDashboard = Boolean(adminEmail && isAdminView);

  return (
    <div className="min-h-screen w-full flex flex-col bg-[#0a0a0c] text-zinc-100">
      <Navbar
        branding={store.branding}
        adminEmail={adminEmail}
        isAdminView={canShowAdminDashboard}
        onOpenAdminLogin={() => setLoginModalOpen(true)}
        onToggleAdminView={() => {
          if (!adminEmail) {
            setLoginModalOpen(true);
            return;
          }
          setIsAdminView((prev) => !prev);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onLogoutAdmin={handleLogoutAdmin}
        onNavigateSection={scrollToSection}
      />

      {canShowAdminDashboard ? (
        <AdminDashboard
          store={store}
          saveState={saveState}
          saveError={saveError}
          onUpdateStore={handleUpdateStore}
          onResetDefaults={handleResetDefaults}
          onPublishAndView={async (sectionId) => {
            if (saveTimerRef.current) {
              window.clearTimeout(saveTimerRef.current);
              saveTimerRef.current = null;
            }
            await persistStoreNow(storeRef.current);
            setIsAdminView(false);
            window.setTimeout(() => {
              if (sectionId) {
                document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
              } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }, 60);
          }}
        />
      ) : (
        <main className="flex-1 bg-[#0a0a0c]">
          <HeroSection
            branding={store.branding}
            hero={store.hero}
            totalVehicles={store.vehicles.length}
            availableCount={availableCount}
            onBrowseClick={() => scrollToSection('inventory')}
            onContactClick={() => scrollToSection('location-contact')}
          />

          {/* Docked Shop-by-Vehicle Filter + Editorial Spotlight + Brand Matrix + Inventory */}
          <section
            id="inventory"
            className="scroll-mt-6 relative z-10 -mt-2 sm:-mt-5 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-14 space-y-10 sm:space-y-12"
          >
            {/* 1. Docked Dark Filter Strip matching reference "SHOP BY VEHICLE" bar */}
            <SearchFilterBar
              filters={filters}
              vehicles={store.vehicles}
              makes={filterOptions.makes}
              models={filterOptions.models}
              years={filterOptions.years}
              totalCount={store.vehicles.length}
              filteredCount={filteredVehicles.length}
              onChange={setFilters}
              onReset={() => {
                setFilters(INITIAL_FILTERS);
                setShowcaseTab('all');
              }}
              onSubmitSearch={() =>
                document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' })
              }
            />

            {/* 2. Two-Column Dark Featured Editorial Spotlight Cards */}
            {featuredSpotlight.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {featuredSpotlight.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    type="button"
                    onClick={() => setSelectedVehicle(vehicle)}
                    className="group relative aspect-[16/10] sm:aspect-[16/9] w-full rounded-xl overflow-hidden border border-zinc-800 hover:border-zinc-600 bg-[#141418] text-left cursor-pointer transition-colors"
                  >
                    <img
                      src={vehicle.imageUrl}
                      alt={vehicle.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#09090c] via-[#09090c]/85 via-55% to-black/15 p-5 sm:p-6 flex flex-col justify-end">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-red-400 mb-1 drop-shadow-sm">
                        {vehicle.origin} · {formatPrice(vehicle.price)}
                      </span>
                      <h3 className="font-display text-lg sm:text-xl font-bold uppercase tracking-tight text-white leading-tight">
                        {vehicle.title}
                      </h3>
                      <p className="mt-1 text-xs sm:text-sm text-zinc-300 line-clamp-2 max-w-md">
                        {vehicle.description}
                      </p>
                      <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white group-hover:text-[#D92027] transition-colors">
                        <span>View Specs</span>
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* 3. Select Vehicle By Brand / Origin / Status Matrix + Color Swatches */}
            <div id="brand-showcase" className="scroll-mt-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-tight text-white">
                  Select Your Vehicle{' '}
                  <span className="font-normal text-zinc-400">
                    By {matrixMode === 'make' ? 'Make' : matrixMode === 'origin' ? 'Origin' : 'Status'}
                  </span>
                </h2>

                <div
                  role="tablist"
                  aria-label="Browse matrix mode"
                  className="inline-flex items-center gap-1 bg-[#141418] border border-zinc-800 rounded-lg p-1 self-start sm:self-auto"
                >
                  {(
                    [
                      { id: 'make', label: 'MAKE' },
                      { id: 'origin', label: 'ORIGIN' },
                      { id: 'status', label: 'STATUS' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      role="tab"
                      aria-selected={matrixMode === mode.id}
                      onClick={() => setMatrixMode(mode.id)}
                      className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-md transition-colors cursor-pointer ${
                        matrixMode === mode.id
                          ? 'bg-[#D92027] text-white'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 border border-zinc-800 bg-[#121216] rounded-xl overflow-hidden">
                {activeMatrixItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={item.onClick}
                    className={`p-5 sm:p-6 border-b border-r border-zinc-800 flex flex-col items-center justify-center text-center gap-1 transition-colors cursor-pointer ${
                      item.active
                        ? 'bg-[#201113] text-white'
                        : 'hover:bg-[#19191f] text-zinc-100'
                    }`}
                  >
                    <span className="font-display text-base sm:text-lg font-bold tracking-tight text-white">
                      {item.title}
                    </span>
                    <span className="text-[11px] font-medium text-[#D92027]">{item.subtitle}</span>
                  </button>
                ))}
              </div>

              {/* Clickable Exterior Color Swatch Row matching reference screenshot */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {COLOR_SWATCHES.map((swatch) => {
                  const isActive =
                    swatch.isReset
                      ? filters.query === ''
                      : filters.query.toLowerCase() === swatch.query.toLowerCase();
                  return (
                    <button
                      key={swatch.label}
                      type="button"
                      title={swatch.label}
                      aria-label={`Filter by ${swatch.label}`}
                      onClick={() => {
                        setFilters((prev) => ({
                          ...prev,
                          query:
                            swatch.isReset ||
                            prev.query.toLowerCase() === swatch.query.toLowerCase()
                              ? ''
                              : swatch.query,
                        }));
                        document
                          .getElementById('inventory-grid')
                          ?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className={`shrink-0 w-10 h-10 rounded-md border-2 transition-transform cursor-pointer flex items-center justify-center ${
                        swatch.swatchClass
                      } ${
                        isActive
                          ? 'ring-2 ring-[#D92027] ring-offset-2 ring-offset-[#0a0a0c] scale-105'
                          : 'opacity-85 hover:opacity-100'
                      }`}
                    >
                      {swatch.isReset && (
                        <span className="text-[10px] font-semibold uppercase text-zinc-300">
                          All
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Full Vehicle Showroom Grid matching "THIS MONTH AT..." */}
            <div id="inventory-grid" className="scroll-mt-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-tight text-white">
                  Showroom{' '}
                  <span className="font-normal text-zinc-400">
                    at {store.branding.companyName}
                  </span>
                </h2>

                <div
                  role="tablist"
                  aria-label="Filter vehicle availability"
                  className="inline-flex items-center gap-1 bg-[#141418] border border-zinc-800 rounded-lg p-1 self-start sm:self-auto"
                >
                  {(
                    [
                      { id: 'all', label: 'ALL' },
                      { id: 'featured', label: 'FEATURED' },
                      { id: 'available', label: 'AVAILABLE' },
                      { id: 'reserved', label: 'RESERVED' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={showcaseTab === tab.id}
                      onClick={() => setShowcaseTab(tab.id)}
                      className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-md transition-colors cursor-pointer ${
                        showcaseTab === tab.id
                          ? 'bg-[#D92027] text-white'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {!loaded && store.vehicles.length === 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className="h-96 rounded-xl bg-[#141418] border border-zinc-800 animate-pulse"
                    />
                  ))}
                </div>
              ) : filteredVehicles.length === 0 ? (
                <div className="border border-zinc-800 rounded-xl p-12 text-center space-y-3 bg-[#141418]">
                  <h3 className="font-display text-lg font-semibold text-white">
                    No matching vehicles found
                  </h3>
                  <p className="text-sm text-zinc-400 max-w-md mx-auto">
                    Try clearing one of your Make, Model, or Year filters to browse all available imports.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(INITIAL_FILTERS);
                      setShowcaseTab('all');
                    }}
                    className="inline-flex items-center px-4 py-2 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Show All Vehicles
                  </button>
                </div>
              ) : (
                <div
                  data-testid="vehicle-grid"
                  className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3.5"
                >
                  {filteredVehicles.map((vehicle, idx) => (
                    <VehicleCard
                      key={vehicle.id}
                      vehicle={vehicle}
                      rank={idx + 1}
                      onSelect={setSelectedVehicle}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <TikTokShowcase tiktok={store.tiktok} />

          <LocationContactSection
            contact={store.contact}
            companyName={store.branding.companyName}
            logoUrl={store.branding.logoUrl}
            tiktok={store.tiktok}
            selectedVehicleTitle={inquiryVehicleTitle}
            onClearSelectedVehicle={() => setInquiryVehicleTitle('')}
          />
        </main>
      )}

      {!canShowAdminDashboard && (
        <Footer
          branding={store.branding}
          contact={store.contact}
          tiktok={store.tiktok}
          isAdminAuthenticated={Boolean(adminEmail)}
          onOpenAdmin={() => {
            if (!adminEmail) return;
            setIsAdminView(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}

      <VehicleDetailModal
        vehicle={selectedVehicle}
        contact={store.contact}
        onClose={() => setSelectedVehicle(null)}
        onInquireVehicle={(vehicle) => {
          setInquiryVehicleTitle(vehicle.title);
          scrollToSection('inquiry-form');
        }}
      />

      <AdminLoginModal
        isOpen={loginModalOpen}
        logoUrl={store.branding.logoUrl}
        companyName={store.branding.companyName}
        authorizedEmails={store.adminEmails}
        onClose={() => setLoginModalOpen(false)}
        onAuthenticated={(email) => {
          setAdminEmail(email);
          setLoginModalOpen(false);
          setIsAdminView(true);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}
