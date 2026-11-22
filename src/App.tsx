import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ArrowLeft, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AdminDashboard } from './components/AdminDashboard';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { HowItWorksSection } from './components/HowItWorksSection';
import { LocationContactSection } from './components/LocationContactSection';
import { Navbar } from './components/Navbar';
import { ScrollReveal } from './components/ScrollReveal';
import { SearchFilterBar } from './components/SearchFilterBar';
import { TikTokShowcase } from './components/TikTokShowcase';
import { VehicleCard } from './components/VehicleCard';
import { VehicleDetailPage } from './components/VehicleDetailPage';
import {
  ALIF_DEFAULT_HERO_POSTER,
  ALIF_DEFAULT_LOGO,
  INITIAL_SHOWROOM_STORE,
} from './data/seedData';
import { app, auth, formatFirestoreUserMessage } from './firebase';
import type { ShowroomStore, Vehicle, VehicleFilters, VehicleStatus } from './types/showroom';
import {
  fetchAdminAllowlistFromFirestore,
  subscribeAdminAccessFromFirestore,
  subscribeShowroomFromFirestore,
  type ShowroomSyncMeta,
} from './utils/firestoreStore';
import {
  filterVehicles,
  getAvailableColorSwatches,
  getFilterOptions,
  isAuthorizedAdminEmail,
  resolvePublicAssetUrl,
} from './utils/inventory';
import {
  cacheShowroomStoreLocally,
  ensureFirestoreSeeded,
  loadShowroomStore,
  logoutAdmin,
  readCachedShowroomStore,
  resetShowroomStore,
  saveShowroomStore,
  signInAdminWithEmailPassword,
  signInAdminWithGoogle,
} from './utils/storeClient';
import {
  checkForceSignOutBySecurityConfig,
  startWebAdminSession,
  stopWebSessionWatcher,
} from './utils/webAdminSessionSync';

const INITIAL_FILTERS: VehicleFilters = {
  query: '',
  make: '',
  model: '',
  year: '',
};

type MatrixMode = 'make' | 'origin' | 'status';
type ShowcaseTab = 'all' | 'featured' | 'available' | 'reserved';

const ORDERS_STORAGE_KEY = 'alif_car_import_orders_v1';

function readStoredOrderIds(): string[] {
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function CarDetailRoute({
  store,
  loaded,
  orderedVehicleIds,
  onPlaceOrder,
  onRemoveOrder,
  onBackHome,
  onFilterByMake,
  onSelectVehicle,
}: {
  store: ShowroomStore;
  loaded: boolean;
  orderedVehicleIds: string[];
  onPlaceOrder: (vehicle: Vehicle) => void;
  onRemoveOrder: (vehicleId: string) => void;
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
      isInOrder={orderedVehicleIds.includes(vehicle.id)}
      onPlaceOrder={onPlaceOrder}
      onRemoveOrder={onRemoveOrder}
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
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const session = await signInAdminWithEmailPassword(email, password, authorizedEmails);
      setPassword('');
      onAuthenticated(session.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setSubmitting(true);
    try {
      const session = await signInAdminWithGoogle(authorizedEmails);
      onAuthenticated(session.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#08080a] bg-[radial-gradient(ellipse_at_top,rgba(225,29,42,0.08),transparent_60%)] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-4xl lg:grid lg:grid-cols-12 rounded-2xl overflow-hidden bg-[#111115] border border-white/[0.08] shadow-[0_32px_90px_rgba(0,0,0,0.75)]">
        {/* Left editorial showroom panel on desktop */}
        <aside className="hidden lg:flex lg:col-span-5 relative flex-col justify-between p-8 bg-[#0b0b0e] border-r border-white/[0.07] overflow-hidden">
          <img
            src={resolvePublicAssetUrl(ALIF_DEFAULT_HERO_POSTER)}
            alt={companyName}
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-35 select-none pointer-events-none"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-[#08080a] via-[#08080a]/75 to-[#08080a]/55 pointer-events-none"
          />

          <div className="relative z-10 flex items-center gap-3">
            <img
              src={resolvePublicAssetUrl(logoUrl) || ALIF_DEFAULT_LOGO}
              alt={companyName}
              referrerPolicy="no-referrer"
              onError={(e) => {
                if (!e.currentTarget.src.endsWith(ALIF_DEFAULT_LOGO)) {
                  e.currentTarget.src = ALIF_DEFAULT_LOGO;
                }
              }}
              className="w-10 h-10 rounded-full object-cover bg-white ring-2 ring-white/20 shrink-0"
            />
            <div className="min-w-0">
              <p className="font-display text-sm font-semibold text-white truncate">
                {companyName}
              </p>
              <p className="text-xs text-zinc-400">Showroom Console</p>
            </div>
          </div>

          <div className="relative z-10 space-y-4">
            <h2 className="font-display text-2xl font-bold tracking-tight text-white leading-snug text-balance">
              Dealership Control Center
            </h2>
            <p className="text-sm text-zinc-300 leading-relaxed">
              Manage your imported vehicle fleet, publish TikTok walkaround reels, and keep showroom
              contact details synchronized across all visitors.
            </p>
            <div className="pt-3 border-t border-white/[0.08] flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
              <span>Live Fleet Sync</span>
              <span aria-hidden="true">·</span>
              <span>TikTok Reels</span>
              <span aria-hidden="true">·</span>
              <span>Contact</span>
            </div>
          </div>
        </aside>

        {/* Right sign-in panel */}
        <div className="lg:col-span-7 p-6 sm:p-10 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 lg:hidden">
                <img
                  src={resolvePublicAssetUrl(logoUrl) || ALIF_DEFAULT_LOGO}
                  alt={companyName}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    if (!e.currentTarget.src.endsWith(ALIF_DEFAULT_LOGO)) {
                      e.currentTarget.src = ALIF_DEFAULT_LOGO;
                    }
                  }}
                  className="w-9 h-9 rounded-full object-cover bg-white ring-2 ring-white/15 shrink-0"
                />
                <span className="text-xs font-medium text-zinc-400">{companyName}</span>
              </div>

              <h1 className="hidden lg:block font-display text-2xl font-bold tracking-tight text-white">
                Alif <span className="text-[#E11D2A]">Car</span> Admin
              </h1>

              <button
                type="button"
                onClick={onBackToShowroom}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] hover:border-white/25 text-xs font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Showroom</span>
              </button>
            </div>

            <div>
              <h1 className="lg:hidden font-display text-2xl font-bold tracking-tight text-white">
                Alif <span className="text-[#E11D2A]">Car</span> Admin
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1 lg:mt-0">
                Sign in to manage your dealership inventory and showroom.
              </p>
            </div>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="admin-login-email"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Admin Email
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="admin-login-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alifcarimports@gmail.com"
                  className="w-full h-11 pl-10 pr-3.5 bg-[#09090c] border border-white/[0.1] rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E11D2A] transition-colors"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-login-password"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock
                  className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="admin-login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  className="w-full h-11 pl-10 pr-11 bg-[#09090c] border border-white/[0.1] rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E11D2A] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-white cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="text-xs font-medium text-red-300 bg-red-950/50 border border-red-900/60 rounded-xl p-3 leading-relaxed"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 bg-[#E11D2A] hover:bg-[#C81722] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-white/[0.08]" />
              <span className="text-xs text-zinc-500">or continue with</span>
              <span className="h-px flex-1 bg-white/[0.08]" />
            </div>

            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              disabled={submitting}
              className="w-full h-11 inline-flex items-center justify-center gap-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] disabled:opacity-60 text-zinc-100 text-sm font-medium rounded-xl transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.8-5.4 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.8 9.1-9.2 0-.6-.1-1.1-.2-1.6H12z"
                />
              </svg>
              <span>Sign in with Google</span>
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');

  const initialStore = useMemo(
    () => readCachedShowroomStore() ?? INITIAL_SHOWROOM_STORE,
    []
  );
  const [store, setStore] = useState<ShowroomStore>(initialStore);
  const [loaded, setLoaded] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filters, setFilters] = useState<VehicleFilters>(INITIAL_FILTERS);
  const [matrixMode, setMatrixMode] = useState<MatrixMode>('make');
  const [showcaseTab, setShowcaseTab] = useState<ShowcaseTab>('all');
  const [orderedVehicleIds, setOrderedVehicleIds] = useState<string[]>(() => readStoredOrderIds());
  const saveTimerRef = useRef<number | null>(null);
  const storeRef = useRef<ShowroomStore>(initialStore);
  const lastSyncedStoreRef = useRef<ShowroomStore | null>(null);
  const seededOnceRef = useRef(false);
  const [remoteSyncMeta, setRemoteSyncMeta] = useState<ShowroomSyncMeta | null>(null);

  useEffect(() => {
    let active = true;
    loadShowroomStore().then((data) => {
      if (!active) return;
      if (!lastSyncedStoreRef.current) {
        storeRef.current = data;
        setStore(data);
      }
      setLoaded(true);
    });

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (user?.email && user.emailVerified) {
        let allowed = isAuthorizedAdminEmail(user.email, storeRef.current.adminEmails);
        if (!allowed) {
          const remoteAllowlist = await fetchAdminAllowlistFromFirestore();
          allowed = isAuthorizedAdminEmail(user.email, [
            ...(storeRef.current.adminEmails ?? []),
            ...(remoteAllowlist ?? []),
          ]);
        }
        if (!active) return;
        if (allowed) {
          const handleForcedSignOut = () => {
            if (!active) return;
            setAdminEmail(null);
          };
          const forcedOut = await checkForceSignOutBySecurityConfig(auth, app, user, {
            onForcedSignOut: handleForcedSignOut,
          });
          if (!active) return;
          if (forcedOut) {
            stopWebSessionWatcher();
            setAdminEmail(null);
            setAuthReady(true);
            return;
          }
          setAdminEmail(user.email);
          void startWebAdminSession(auth, app, user, {
            onForcedSignOut: handleForcedSignOut,
            skipInitialSecurityCheck: true,
          });
        } else {
          stopWebSessionWatcher();
          setAdminEmail(null);
        }
      } else {
        stopWebSessionWatcher();
        setAdminEmail(null);
      }
      setAuthReady(true);
    });

    return () => {
      active = false;
      unsubAuth();
      stopWebSessionWatcher();
    };
  }, []);

  // Subscribe ONCE to public showroom collections (config/showroom, vehicles, tiktokPosts)
  // so signing in/out as admin never re-reads all vehicles and TikTok posts a second time.
  useEffect(() => {
    const unsubscribe = subscribeShowroomFromFirestore(
      storeRef.current,
      (remoteStore, meta) => {
        const mergedWithAdminEmails: ShowroomStore = {
          ...remoteStore,
          adminEmails: storeRef.current.adminEmails ?? remoteStore.adminEmails,
        };
        storeRef.current = mergedWithAdminEmails;
        if (meta.allLoaded) {
          cacheShowroomStoreLocally(mergedWithAdminEmails);
          if (meta.hasConfig) {
            lastSyncedStoreRef.current = mergedWithAdminEmails;
          }
        }
        setRemoteSyncMeta(meta);
        setStore(mergedWithAdminEmails);
        setLoaded(true);
      },
      (err) => {
        setSaveState('error');
        setSaveError(formatFirestoreUserMessage(err));
      }
    );
    return () => {
      unsubscribe();
    };
  }, []);

  // Subscribe to config/adminAccess only when an authorized admin is signed in.
  useEffect(() => {
    if (!authReady || !adminEmail) return;
    const unsubscribe = subscribeAdminAccessFromFirestore(
      (adminEmails) => {
        const nextStore: ShowroomStore = {
          ...storeRef.current,
          adminEmails,
        };
        storeRef.current = nextStore;
        if (lastSyncedStoreRef.current) {
          lastSyncedStoreRef.current = {
            ...lastSyncedStoreRef.current,
            adminEmails,
          };
        }
        setStore(nextStore);
      },
      (err) => {
        setSaveState('error');
        setSaveError(formatFirestoreUserMessage(err));
      }
    );
    return () => {
      unsubscribe();
    };
  }, [authReady, adminEmail]);

  // Run catalog seeding at most once per session using already-loaded snapshot state (0 extra reads).
  useEffect(() => {
    if (!adminEmail || !remoteSyncMeta?.allLoaded || seededOnceRef.current) return;
    seededOnceRef.current = true;
    void ensureFirestoreSeeded(storeRef.current, remoteSyncMeta).catch((err) => {
      setSaveState('error');
      setSaveError(formatFirestoreUserMessage(err));
    });
  }, [adminEmail, remoteSyncMeta]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orderedVehicleIds));
    } catch {
      // Ignore storage quota errors
    }
  }, [orderedVehicleIds]);

  const persistStoreNow = async (
    targetStore: ShowroomStore,
    prevStoreSnapshot: ShowroomStore | null
  ): Promise<boolean> => {
    setSaveState('saving');
    setSaveError(null);
    try {
      await saveShowroomStore(targetStore, prevStoreSnapshot);
      lastSyncedStoreRef.current = targetStore;
      setSaveState('saved');
      return true;
    } catch (err) {
      setSaveState('error');
      setSaveError(
        err instanceof Error ? err.message : 'Unable to publish changes to Firebase.'
      );
      return false;
    }
  };

  const handleUpdateStore = async (
    nextStoreOrUpdater: ShowroomStore | ((prev: ShowroomStore) => ShowroomStore),
    immediate = false
  ): Promise<boolean> => {
    if (!adminEmail) return false;
    const prevBeforeEdit = storeRef.current;
    const prevSnapshot = lastSyncedStoreRef.current ?? prevBeforeEdit;
    const nextStore =
      typeof nextStoreOrUpdater === 'function'
        ? nextStoreOrUpdater(prevBeforeEdit)
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
      return persistStoreNow(nextStore, prevSnapshot);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void persistStoreNow(storeRef.current, lastSyncedStoreRef.current ?? prevBeforeEdit);
    }, 800);
    return true;
  };

  const handleResetDefaults = async () => {
    if (!adminEmail) return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const fresh = await resetShowroomStore();
      storeRef.current = fresh;
      lastSyncedStoreRef.current = fresh;
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

  const orderedVehicles = useMemo(
    () =>
      orderedVehicleIds
        .map((id) => store.vehicles.find((v) => v.id === id))
        .filter((v): v is Vehicle => Boolean(v)),
    [orderedVehicleIds, store.vehicles]
  );

  const handlePlaceOrder = (vehicle: Vehicle) => {
    setOrderedVehicleIds((prev) => (prev.includes(vehicle.id) ? prev : [...prev, vehicle.id]));
  };

  const handleRemoveOrder = (vehicleId: string) => {
    setOrderedVehicleIds((prev) => prev.filter((id) => id !== vehicleId));
  };

  const handleClearOrders = () => {
    setOrderedVehicleIds([]);
  };

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
      <div className="min-h-screen w-full flex flex-col bg-[#08080a] text-zinc-100">
        {!isAdminRoute && (
          <Navbar
            companyName={store.branding.companyName}
            logoUrl={store.branding.logoUrl}
            contactPhone={store.contact.whatsapp || store.contact.phone}
            searchQuery={filters.query}
            orderedVehicles={orderedVehicles}
            onSearchChange={(query) => setFilters((prev) => ({ ...prev, query }))}
            onSearchSubmit={() => navigateToSection('inventory-grid')}
            onShopNow={() => navigateToSection('inventory-grid')}
            onSelectVehicle={openVehicleRoute}
            onRemoveOrder={handleRemoveOrder}
            onClearOrders={handleClearOrders}
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
                  <main className="flex-1 bg-[#08080a]">
                    <HeroSection
                      branding={store.branding}
                      hero={store.hero}
                      totalVehicles={store.vehicles.length}
                      availableCount={availableCount}
                      onBrowseClick={() => navigateToSection('inventory-grid')}
                      onContactClick={() => navigateToSection('location-contact')}
                    />

                    {/* Curated Collection: Filter Bar + Brand Matrix + 3-Column Vehicle Grid */}
                    <section
                      id="inventory"
                      className="scroll-mt-20 relative z-10 pt-14 sm:pt-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 space-y-12 sm:space-y-14"
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
                      <div id="brand-showcase" className="scroll-mt-20 space-y-4">
                        <ScrollReveal
                          y={24}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
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
                            className="inline-flex items-center gap-1 bg-[#111115] border border-white/[0.08] rounded-xl p-1 self-start sm:self-auto"
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
                                className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer ${
                                  matrixMode === mode.id
                                    ? 'bg-[#E11D2A] text-white'
                                    : 'text-zinc-400 hover:text-white'
                                }`}
                              >
                                {mode.label}
                              </button>
                            ))}
                          </div>
                        </ScrollReveal>

                        <ScrollReveal
                          y={22}
                          delay={0.05}
                          className="flex flex-wrap items-center gap-2"
                        >
                          {activeMatrixItems.map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              onClick={item.onClick}
                              className={`px-3.5 py-2 rounded-xl border inline-flex items-baseline gap-1.5 text-left transition-colors cursor-pointer ${
                                item.active
                                  ? 'bg-[#201113] border-[#E11D2A] text-white'
                                  : 'bg-[#111115] border-white/[0.08] hover:border-white/25 hover:bg-[#17171d] text-zinc-100'
                              }`}
                            >
                              <span className="font-display text-xs sm:text-sm font-semibold tracking-tight text-white">
                                {item.title}
                              </span>
                              <span className="text-[11px] font-medium text-[#E11D2A] tabular-nums">
                                {item.subtitle}
                              </span>
                            </button>
                          ))}
                        </ScrollReveal>

                        {visibleColorSwatches.length > 0 && (
                          <ScrollReveal
                            y={20}
                            delay={0.09}
                            className="flex items-center gap-2 overflow-x-auto p-1"
                          >
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
                                      ? 'ring-2 ring-[#E11D2A] ring-offset-2 ring-offset-[#08080a] scale-105'
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
                          </ScrollReveal>
                        )}
                      </div>

                      {/* Full Vehicle Showroom Grid */}
                      <div id="inventory-grid" className="scroll-mt-20 space-y-6">
                        <ScrollReveal
                          y={24}
                          className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"
                        >
                          <div className="space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#E11D2A]">
                              Featured Collection
                            </p>
                            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
                              Handpicked Excellence{' '}
                              <span className="font-normal text-zinc-400">
                                at {store.branding.companyName}
                              </span>
                            </h2>
                          </div>

                          <div
                            role="tablist"
                            aria-label="Filter vehicle availability"
                            className="inline-flex items-center gap-1 bg-[#111115] border border-white/[0.08] rounded-xl p-1 self-start sm:self-auto"
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
                                className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                                  showcaseTab === tab.id
                                    ? 'bg-[#E11D2A] text-white'
                                    : 'text-zinc-400 hover:text-white'
                                }`}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                        </ScrollReveal>

                        {!loaded && store.vehicles.length === 0 ? (
                          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5 lg:gap-6">
                            {[1, 2, 3, 4, 5, 6].map((n) => (
                              <div
                                key={n}
                                className="h-56 sm:h-80 rounded-xl sm:rounded-2xl bg-[#111115] border border-white/[0.08] animate-pulse"
                              />
                            ))}
                          </div>
                        ) : filteredVehicles.length === 0 ? (
                          <ScrollReveal
                            y={24}
                            className="border border-white/[0.08] rounded-2xl p-12 text-center space-y-3 bg-[#111115]"
                          >
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
                              className="inline-flex items-center px-5 py-2.5 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold rounded-full cursor-pointer"
                            >
                              Show All Vehicles
                            </button>
                          </ScrollReveal>
                        ) : (
                          <div
                            data-testid="vehicle-grid"
                            className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5 lg:gap-6"
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

                    <HowItWorksSection
                      brands={filterOptions.makes}
                      onStartOrder={() => navigateToSection('location-contact')}
                      onBrowseCollection={() => navigateToSection('inventory-grid')}
                    />

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
                    orderedVehicleIds={orderedVehicleIds}
                    onPlaceOrder={handlePlaceOrder}
                    onRemoveOrder={handleRemoveOrder}
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
                      onDismissSaveError={() => {
                        setSaveError(null);
                        setSaveState('idle');
                      }}
                      onUpdateStore={handleUpdateStore}
                      onResetDefaults={handleResetDefaults}
                      onSignOut={() => void handleLogoutAdmin()}
                      onPublishAndView={async (sectionId) => {
                        if (saveTimerRef.current) {
                          window.clearTimeout(saveTimerRef.current);
                          saveTimerRef.current = null;
                        }
                        await persistStoreNow(storeRef.current, lastSyncedStoreRef.current);
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
            onNavigateSection={navigateToSection}
          />
        )}
      </div>
    </MotionConfig>
  );
}
