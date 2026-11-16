import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Lock, Mail } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AdminDashboard } from './components/AdminDashboard';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { LocationContactSection } from './components/LocationContactSection';
import { Navbar } from './components/Navbar';
import { SearchFilterBar } from './components/SearchFilterBar';
import { TikTokShowcase } from './components/TikTokShowcase';
import { VehicleCard } from './components/VehicleCard';
import { VehicleDetailPage } from './components/VehicleDetailPage';
import { INITIAL_SHOWROOM_STORE } from './data/seedData';
import type { ShowroomStore, Vehicle, VehicleFilters, VehicleStatus } from './types/showroom';
import {
  filterVehicles,
  getAvailableColorSwatches,
  getFilterOptions,
} from './utils/inventory';
import {
  checkAdminSession,
  loadShowroomStore,
  loginAdminByEmail,
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

function CarDetailRoute({
  store,
  loaded,
  onBackHome,
  onFilterByMake,
  onSelectVehicle,
}: {
  store: ShowroomStore;
  loaded: boolean;
  onBackHome: () => void;
  onFilterByMake: (make: string) => void;
  onSelectVehicle: (vehicle: Vehicle) => void;
}) {
  const { id } = useParams<{ id: string }>();
  const decodedId = id ? decodeURIComponent(id) : '';
  const vehicle = store.vehicles.find((v) => v.id === decodedId) ?? null;

  if (!loaded && store.vehicles.length === 0) {
    return (
      <main className="flex-1 bg-[#0a0a0c] pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="h-96 rounded-xl bg-[#141418] border border-zinc-800 animate-pulse" />
      </main>
    );
  }

  if (!vehicle) {
    return (
      <main className="flex-1 bg-[#0a0a0c] pt-24 pb-16 px-4">
        <div className="max-w-xl mx-auto bg-[#141418] border border-zinc-800 rounded-xl p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-white uppercase">
            Vehicle Not Found
          </h1>
          <p className="text-sm text-zinc-400">
            This vehicle listing may have been sold or removed from the showroom inventory.
          </p>
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#D92027] hover:bg-[#B91C1C] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Back to Showroom</span>
          </button>
        </div>
      </main>
    );
  }

  return (
    <VehicleDetailPage
      vehicle={vehicle}
      allVehicles={store.vehicles}
      companyName={store.branding.companyName}
      contact={store.contact}
      onBackHome={onBackHome}
      onFilterByMake={onFilterByMake}
      onSelectVehicle={onSelectVehicle}
    />
  );
}

function AdminLoginView({
  logoUrl,
  companyName,
  authorizedEmails,
  onAuthenticated,
  onBackToShowroom,
}: {
  logoUrl?: string;
  companyName: string;
  authorizedEmails?: string[];
  onAuthenticated: (email: string) => void;
  onBackToShowroom: () => void;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please enter your admin email address.');
      return;
    }

    setSubmitting(true);
    try {
      const session = await loginAdminByEmail(trimmed, authorizedEmails);
      setEmail('');
      onAuthenticated(session.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a0c] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#141418] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-cover bg-white shrink-0"
              />
            ) : (
              <Lock className="w-4 h-4 text-[#D92027]" aria-hidden="true" />
            )}
            <h1 className="font-display text-lg font-semibold text-white">
              Admin Sign In
            </h1>
          </div>
          <button
            type="button"
            onClick={onBackToShowroom}
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Showroom</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-zinc-400 leading-relaxed">
            Enter your authorized {companyName} administrator email to access inventory and content controls.
          </p>

          <div>
            <label htmlFor="admin-login-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
              Admin Email *
            </label>
            <div className="relative">
              <Mail
                className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="admin-login-email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full h-11 pl-9 pr-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D92027]"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-[#D92027]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 bg-[#D92027] hover:bg-[#B91C1C] disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
          >
            {submitting ? 'Verifying...' : 'Sign In'}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');

  const [store, setStore] = useState<ShowroomStore>(INITIAL_SHOWROOM_STORE);
  const [loaded, setLoaded] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filters, setFilters] = useState<VehicleFilters>(INITIAL_FILTERS);
  const [matrixMode, setMatrixMode] = useState<MatrixMode>('make');
  const [showcaseTab, setShowcaseTab] = useState<ShowcaseTab>('all');
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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

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

  const makeMatrixItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of store.vehicles) {
      counts.set(v.make, (counts.get(v.make) ?? 0) + 1);
    }
    const items = Array.from(counts.entries()).map(([name, count]) => ({
      key: name,
      title: name,
      subtitle: `(${count})`,
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
        subtitle: `(${featuredCount})`,
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
        subtitle: `(${store.vehicles.length})`,
        active: false,
        onClick: () => {
          setFilters(INITIAL_FILTERS);
          setShowcaseTab('all');
          document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
        },
      });
    }
    return items;
  }, [store.vehicles, filters.make, showcaseTab]);

  const originMatrixItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of store.vehicles) {
      counts.set(v.origin, (counts.get(v.origin) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([origin, count]) => ({
      key: origin,
      title: origin,
      subtitle: `(${count})`,
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
        subtitle: `(${store.vehicles.length})`,
        active: showcaseTab === 'all',
        onClick: () => {
          setShowcaseTab('all');
          document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
        },
      },
      {
        key: 'available',
        title: 'Available Now',
        subtitle: `(${available})`,
        active: showcaseTab === 'available',
        onClick: () => {
          setShowcaseTab('available');
          document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
        },
      },
      {
        key: 'featured',
        title: 'Featured Arrivals',
        subtitle: `(${featured})`,
        active: showcaseTab === 'featured',
        onClick: () => {
          setShowcaseTab('featured');
          document.getElementById('inventory-grid')?.scrollIntoView({ behavior: 'smooth' });
        },
      },
      {
        key: 'reserved',
        title: 'Reserved Units',
        subtitle: `(${reserved})`,
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

  const visibleColorSwatches = useMemo(
    () => getAvailableColorSwatches(store.vehicles),
    [store.vehicles]
  );

  const navigateToSection = (sectionId: string) => {
    if (location.pathname !== '/') {
      navigate('/');
      window.setTimeout(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
      return;
    }
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
  };

  const openVehicleRoute = (vehicle: Vehicle) => {
    navigate(`/car/${encodeURIComponent(vehicle.id)}`);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen w-full flex flex-col bg-[#0a0a0c] text-zinc-100">
        {!isAdminRoute && (
          <Navbar
            branding={store.branding}
            searchQuery={filters.query}
            availableCount={availableCount}
            onSearchChange={(query) => setFilters((prev) => ({ ...prev, query }))}
            onSearchSubmit={() => navigateToSection('inventory-grid')}
            onShopNow={() => navigateToSection('inventory-grid')}
            onNavigateSection={navigateToSection}
          />
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex-1 flex flex-col"
          >
            <Routes location={location}>
              <Route
                path="/"
                element={
                  <main className="flex-1 bg-[#0a0a0c]">
                    <HeroSection
                      branding={store.branding}
                      hero={store.hero}
                      totalVehicles={store.vehicles.length}
                      availableCount={availableCount}
                      onBrowseClick={() => navigateToSection('inventory')}
                      onContactClick={() => navigateToSection('location-contact')}
                    />

                    {/* Docked Shop-by-Vehicle Filter + Brand Matrix + Inventory */}
                    <section
                      id="inventory"
                      className="scroll-mt-6 relative z-10 -mt-2 sm:-mt-5 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-14 space-y-10 sm:space-y-12"
                    >
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
                          document
                            .getElementById('inventory-grid')
                            ?.scrollIntoView({ behavior: 'smooth' })
                        }
                      />

                      {/* Select Vehicle By Brand / Origin / Status Matrix + Color Swatches */}
                      <div id="brand-showcase" className="scroll-mt-6 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <h2 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-tight text-white">
                            Select Your Vehicle{' '}
                            <span className="font-normal text-zinc-400">
                              By{' '}
                              {matrixMode === 'make'
                                ? 'Make'
                                : matrixMode === 'origin'
                                ? 'Origin'
                                : 'Status'}
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

                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          {activeMatrixItems.map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              onClick={item.onClick}
                              className={`px-3 py-1.5 rounded-lg border inline-flex items-baseline gap-1.5 text-left transition-colors cursor-pointer ${
                                item.active
                                  ? 'bg-[#201113] border-[#D92027] text-white'
                                  : 'bg-[#141418] border-zinc-800 hover:border-zinc-600 hover:bg-[#19191f] text-zinc-100'
                              }`}
                            >
                              <span className="font-display text-xs sm:text-sm font-semibold tracking-tight text-white">
                                {item.title}
                              </span>
                              <span className="text-[11px] font-medium text-[#D92027] tabular-nums">
                                {item.subtitle}
                              </span>
                            </button>
                          ))}
                        </div>

                        {visibleColorSwatches.length > 0 && (
                          <div className="flex items-center gap-2 overflow-x-auto pb-1">
                            {visibleColorSwatches.map((swatch) => {
                              const isActive = swatch.isReset
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
                        )}
                      </div>

                      {/* Full Vehicle Showroom Grid */}
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
                          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3.5">
                            {[1, 2, 3, 4, 5, 6].map((n) => (
                              <div
                                key={n}
                                className="h-56 rounded-lg bg-[#141418] border border-zinc-800 animate-pulse"
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
                                index={idx}
                                onSelect={openVehicleRoute}
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
                    />
                  </main>
                }
              />

              <Route
                path="/car/:id"
                element={
                  <CarDetailRoute
                    store={store}
                    loaded={loaded}
                    onBackHome={() => navigate('/')}
                    onFilterByMake={(make) => {
                      setFilters({ ...INITIAL_FILTERS, make });
                      setShowcaseTab('all');
                      navigate('/');
                      window.setTimeout(() => {
                        document
                          .getElementById('inventory-grid')
                          ?.scrollIntoView({ behavior: 'smooth' });
                      }, 120);
                    }}
                    onSelectVehicle={openVehicleRoute}
                  />
                }
              />

              <Route
                path="/admin"
                element={
                  adminEmail ? (
                    <AdminDashboard
                      store={store}
                      adminEmail={adminEmail}
                      saveState={saveState}
                      saveError={saveError}
                      onUpdateStore={handleUpdateStore}
                      onResetDefaults={handleResetDefaults}
                      onSignOut={() => void handleLogoutAdmin()}
                      onPublishAndView={async (sectionId) => {
                        if (saveTimerRef.current) {
                          window.clearTimeout(saveTimerRef.current);
                          saveTimerRef.current = null;
                        }
                        await persistStoreNow(storeRef.current);
                        navigate('/');
                        if (sectionId) {
                          window.setTimeout(() => {
                            document
                              .getElementById(sectionId)
                              ?.scrollIntoView({ behavior: 'smooth' });
                          }, 120);
                        }
                      }}
                    />
                  ) : (
                    <AdminLoginView
                      logoUrl={store.branding.logoUrl}
                      companyName={store.branding.companyName}
                      authorizedEmails={store.adminEmails}
                      onAuthenticated={(email) => setAdminEmail(email)}
                      onBackToShowroom={() => navigate('/')}
                    />
                  )
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>

        {!isAdminRoute && (
          <Footer
            branding={store.branding}
            contact={store.contact}
            tiktok={store.tiktok}
          />
        )}
      </div>
    </MotionConfig>
  );
}
