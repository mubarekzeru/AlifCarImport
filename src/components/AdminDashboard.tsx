import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  BarChart3,
  Car,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  ExternalLink,
  Film,
  Link2,
  Loader2,
  LogOut,
  MapPin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ALIF_DEFAULT_LOGO } from '../data/seedData';
import type {
  ShowroomStore,
  TikTokPost,
  Vehicle,
  VehicleStatus,
} from '../types/showroom';
import {
  extractFramesFromVideoFile,
  readFileAsResizedDataUrl,
} from '../utils/imageUpload';
import {
  deriveTitleFromVideoDescription,
  extractTikTokVideoId,
  filterVehicles,
  getConfiguredSocialLinks,
  getPublicAssetFallbackUrls,
  isPlaceholderTikTokCover,
  isTikTokVideoUrl,
  normalizeTikTokUrl,
  resolvePublicAssetUrl,
  resolveTikTokAdminCardMode,
  shouldAutoFetchTikTokCover,
} from '../utils/inventory';
import { didTikTokPostChange } from '../utils/firestoreSyncLogic';
import {
  fetchCloudflareLoginAlerts,
  isCloudflareBackendEnabled,
  respondToCloudflareLoginAlert,
  type CloudflareLoginAlert,
} from '../utils/cloudflareStore';
import { fetchTikTokVideoMetadata } from '../utils/storeClient';
import {
  AdminSecurityTab,
  AdminVisitorsTab,
  PendingLoginAlertsBanner,
} from './AdminSecurityPanel';
import { SocialMediaIconRow } from './SocialIcons';
import { VehicleFormModal } from './VehicleFormModal';

const DEFAULT_TIKTOK_TITLE = 'New Imported Arrival Walkaround';
const DEFAULT_TIKTOK_CAPTION = 'Full interior and exterior showcase on our showroom floor.';

interface AdminDashboardProps {
  store: ShowroomStore;
  adminEmail?: string | null;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  saveError?: string | null;
  onDismissSaveError?: () => void;
  onUpdateStore: (
    nextStore: ShowroomStore | ((prev: ShowroomStore) => ShowroomStore),
    immediate?: boolean
  ) => Promise<boolean>;
  onDeleteVehicle?: (id: string) => Promise<boolean>;
  onDeleteTikTokPost?: (id: string) => Promise<boolean>;
  onResetDefaults?: () => void;
  onImportFromFirebase?: (
    onProgress?: (status: string) => void
  ) => Promise<{ vehicleCount: number; tiktokCount: number }>;
  onPublishAndView: (sectionId?: string) => Promise<void>;
  onSignOut?: () => void;
}

type AdminTab = 'inventory' | 'tiktok' | 'contact' | 'security' | 'visitors';
type InventorySort = 'newest' | 'price-desc' | 'price-asc' | 'year-desc';

export function AdminDashboard({
  store,
  adminEmail,
  saveState,
  saveError,
  onDismissSaveError,
  onUpdateStore,
  onDeleteVehicle,
  onDeleteTikTokPost,
  onImportFromFirebase,
  onPublishAndView,
  onSignOut,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [makeFilter, setMakeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | 'all'>('all');
  const [sortBy, setSortBy] = useState<InventorySort>('newest');
  const [formOpen, setFormOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [tiktokFetchStatus, setTiktokFetchStatus] = useState<
    Record<string, { loading: boolean; error?: string; note?: string }>
  >({});
  const [tiktokCoverOptions, setTiktokCoverOptions] = useState<
    Record<string, { label: string; url: string }[]>
  >({});
  const [syncingAllTikTok, setSyncingAllTikTok] = useState(false);
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);
  const [lastFetchedUrls, setLastFetchedUrls] = useState<Record<string, string>>({});
  const autoFetchAttemptedRef = useRef<Record<string, string>>({});
  const [tiktokPostModes, setTiktokPostModes] = useState<
    Record<string, 'edit' | 'change-link'>
  >({});
  const [selectedPublishedPostId, setSelectedPublishedPostId] = useState<string | null>(null);
  const [showTikTokShowcaseFeatures, setShowTikTokShowcaseFeatures] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<{
    type: 'success' | 'error';
    message: string;
    sectionId?: string;
  } | null>(null);
  const [importingMobileApp, setImportingMobileApp] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [loginAlerts, setLoginAlerts] = useState<CloudflareLoginAlert[]>([]);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const seenPendingAlertsRef = useRef<Set<string>>(new Set());
  const alertsInitializedRef = useRef(false);

  const refreshLoginAlerts = useCallback(async () => {
    if (!isCloudflareBackendEnabled()) return;
    try {
      const { alerts } = await fetchCloudflareLoginAlerts();
      setLoginAlerts(alerts);

      const pending = alerts.filter((a) => a.decision === 'pending');
      if (alertsInitializedRef.current) {
        for (const alert of pending) {
          if (!seenPendingAlertsRef.current.has(alert.id)) {
            seenPendingAlertsRef.current.add(alert.id);
            if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted'
            ) {
              try {
                const title =
                  alert.alertType === 'unauthorized_email'
                    ? 'Admin Access Request'
                    : 'New Device Admin Login';
                const body = `${alert.email} on ${alert.deviceName}${
                  alert.verificationCode ? ` · Code: ${alert.verificationCode}` : ''
                }`;
                new Notification(title, { body });
              } catch {
                // Ignore Notification errors on unsupported browsers
              }
            }
          }
        }
      } else {
        alertsInitializedRef.current = true;
        for (const alert of pending) {
          seenPendingAlertsRef.current.add(alert.id);
        }
      }
    } catch {
      // Non-fatal if Worker is not yet updated
    }
  }, []);

  useEffect(() => {
    void refreshLoginAlerts();
    const timer = window.setInterval(() => {
      void refreshLoginAlerts();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [refreshLoginAlerts]);

  const handleAlertDecision = async (alertId: string, decision: 'approved' | 'denied') => {
    setBusyAlertId(alertId);
    try {
      const res = await respondToCloudflareLoginAlert(alertId, decision);
      await refreshLoginAlerts();
      setUploadNotice({
        type: 'success',
        message:
          decision === 'approved'
            ? res.grantedEmail
              ? `Granted admin access to ${res.grantedEmail}.`
              : 'Login request approved.'
            : 'Login request denied and session blocked.',
      });
    } catch (err) {
      setUploadNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to respond to login alert.',
      });
    } finally {
      setBusyAlertId(null);
    }
  };

  const pendingAlertCount = useMemo(
    () => loginAlerts.filter((a) => a.decision === 'pending').length,
    [loginAlerts]
  );

  const handleImportFromMobileApp = async () => {
    if (!onImportFromFirebase || importingMobileApp) return;
    setImportingMobileApp(true);
    setImportProgress('Connecting to Firebase...');
    setUploadNotice(null);
    onDismissSaveError?.();
    try {
      const result = await onImportFromFirebase((msg) => setImportProgress(msg));
      setUploadNotice({
        type: 'success',
        message: `Imported ${result.vehicleCount} vehicle${result.vehicleCount === 1 ? '' : 's'}, ${result.tiktokCount} TikTok video${result.tiktokCount === 1 ? '' : 's'}, and showroom details from your mobile app to Cloudflare.`,
        sectionId: 'inventory',
      });
    } catch (err) {
      setUploadNotice({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to import data from Firebase right now.',
      });
    } finally {
      setImportingMobileApp(false);
      setImportProgress('');
    }
  };

  const availableMakes = useMemo(
    () =>
      Array.from(new Set(store.vehicles.map((v) => v.make).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [store.vehicles]
  );

  const filteredInventory = useMemo(() => {
    const base = filterVehicles(store.vehicles, {
      query: searchQuery,
      make: makeFilter,
      model: '',
      year: '',
      status: statusFilter,
    });
    if (sortBy === 'price-desc') {
      return [...base].sort((a, b) => b.price - a.price);
    }
    if (sortBy === 'price-asc') {
      return [...base].sort((a, b) => a.price - b.price);
    }
    if (sortBy === 'year-desc') {
      return [...base].sort((a, b) => b.year - a.year || b.price - a.price);
    }
    return base;
  }, [store.vehicles, searchQuery, makeFilter, statusFilter, sortBy]);

  const availableCount = store.vehicles.filter((v) => v.status === 'available').length;
  const reservedCount = store.vehicles.filter((v) => v.status === 'reserved').length;
  const soldCount = store.vehicles.filter((v) => v.status === 'sold').length;
  const featuredCount = store.vehicles.filter((v) => v.featured).length;
  const totalCatalogValue = store.vehicles.reduce(
    (sum, v) => (Number.isFinite(v.price) && v.price > 0 ? sum + v.price : sum),
    0
  );
  const logoSrc = resolvePublicAssetUrl(store.branding.logoUrl) || ALIF_DEFAULT_LOGO;

  const handlePublishSection = async (label: string, sectionId?: string) => {
    const ok = await onUpdateStore((prev) => prev, true);
    if (ok) {
      setUploadNotice({
        type: 'success',
        message: `${label} published to the visitors' dashboard.`,
        sectionId,
      });
    } else {
      setUploadNotice({
        type: 'error',
        message: saveError || 'Could not publish changes to the visitors dashboard.',
      });
    }
  };

  const handleSaveVehicle = async (
    saved: Vehicle,
    options?: { publishToTikTokReels?: boolean; tiktokCaption?: string }
  ) => {
    const ok = await onUpdateStore((prev) => {
      const exists = prev.vehicles.some((v) => v.id === saved.id);
      const nextVehicles = exists
        ? prev.vehicles.map((v) => (v.id === saved.id ? saved : v))
        : [saved, ...prev.vehicles];

      let nextPosts = prev.tiktok.posts;
      if (options?.publishToTikTokReels && isTikTokVideoUrl(saved.tiktokUrl)) {
        const normalizedUrl = normalizeTikTokUrl(saved.tiktokUrl);
        const targetVideoId = extractTikTokVideoId(normalizedUrl);
        const alreadyListed = prev.tiktok.posts.some((p) => {
          const existingNorm = normalizeTikTokUrl(p.tiktokUrl);
          if (existingNorm === normalizedUrl) return true;
          const existingId = extractTikTokVideoId(existingNorm);
          return Boolean(targetVideoId && existingId && existingId === targetVideoId);
        });
        if (!alreadyListed) {
          const newPost: TikTokPost = {
            id: `tt_${Date.now()}`,
            title: saved.title,
            caption: options.tiktokCaption || saved.description,
            tiktokUrl: normalizedUrl,
            coverImageUrl: saved.imageUrl,
          };
          nextPosts = [newPost, ...prev.tiktok.posts];
        }
      }

      return {
        ...prev,
        vehicles: nextVehicles,
        tiktok: {
          ...prev.tiktok,
          posts: nextPosts,
        },
      };
    }, true);

    setFormOpen(false);
    setEditingVehicle(null);
    if (ok) {
      setUploadNotice({
        type: 'success',
        message: options?.publishToTikTokReels
          ? `"${saved.title}" & its TikTok video published to the visitors' dashboard.`
          : `"${saved.title}" published to the visitors' dashboard.`,
        sectionId: options?.publishToTikTokReels ? 'tiktok-showcase' : 'inventory',
      });
    }
  };

  const handleQuickStatusChange = (id: string, nextStatus: VehicleStatus) => {
    void onUpdateStore(
      (prev) => ({
        ...prev,
        vehicles: prev.vehicles.map((v) => (v.id === id ? { ...v, status: nextStatus } : v)),
      }),
      true
    );
  };

  const handleQuickPriceChange = (id: string, rawPrice: string) => {
    const numeric = Number(rawPrice);
    if (!Number.isFinite(numeric) || numeric < 0) return;
    void onUpdateStore((prev) => ({
      ...prev,
      vehicles: prev.vehicles.map((v) => (v.id === id ? { ...v, price: numeric } : v)),
    }));
  };

  const handleDuplicateVehicle = (vehicle: Vehicle) => {
    const copy: Vehicle = {
      ...vehicle,
      id: `veh_${Date.now()}`,
      title: `${vehicle.title} (Copy)`,
      status: 'available',
      createdAt: new Date().toISOString(),
    };
    void onUpdateStore((prev) => ({ ...prev, vehicles: [copy, ...prev.vehicles] }), true);
  };

  const handleDeleteVehicle = (id: string) => {
    if (onDeleteVehicle) {
      void onDeleteVehicle(id);
    } else {
      void onUpdateStore(
        (prev) => ({
          ...prev,
          vehicles: prev.vehicles.filter((v) => v.id !== id),
        }),
        true
      );
    }
    setConfirmDeleteId(null);
  };

  const handleQuickToggleFeatured = (id: string) => {
    void onUpdateStore(
      (prev) => ({
        ...prev,
        vehicles: prev.vehicles.map((v) =>
          v.id === id ? { ...v, featured: !v.featured } : v
        ),
      }),
      true
    );
  };

  const handleQuickVehiclePhoto = (id: string, imageUrl: string) => {
    void onUpdateStore(
      (prev) => ({
        ...prev,
        vehicles: prev.vehicles.map((v) => (v.id === id ? { ...v, imageUrl } : v)),
      }),
      true
    );
  };

  const handleUploadImageForField = async (
    e: ChangeEvent<HTMLInputElement>,
    onResult: (dataUrl: string) => void | Promise<unknown>,
    label = 'Image'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadNotice(null);
    try {
      const dataUrl = await readFileAsResizedDataUrl(file, 1400, 0.85);
      await onResult(dataUrl);
      setUploadNotice({ type: 'success', message: `${label} uploaded and published.` });
    } catch (err) {
      setUploadNotice({
        type: 'error',
        message: err instanceof Error ? err.message : `Unable to upload ${label.toLowerCase()}.`,
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleAddTikTokPost = () => {
    const nextPost: TikTokPost = {
      id: `tt_${Date.now()}`,
      title: DEFAULT_TIKTOK_TITLE,
      caption: DEFAULT_TIKTOK_CAPTION,
      tiktokUrl: '',
      coverImageUrl: '',
    };
    setTiktokPostModes((prev) => ({ ...prev, [nextPost.id]: 'edit' }));
    setSelectedPublishedPostId(null);
    setShowTikTokShowcaseFeatures(true);
    void onUpdateStore(
      (prev) => ({
        ...prev,
        tiktok: {
          ...prev.tiktok,
          posts: [nextPost, ...prev.tiktok.posts],
        },
      }),
      true
    );
  };

  const handleUpdateTikTokPost = (
    id: string,
    patch: Partial<TikTokPost>,
    immediate = false
  ): Promise<boolean> => {
    return onUpdateStore(
      (prev) => ({
        ...prev,
        tiktok: {
          ...prev.tiktok,
          posts: prev.tiktok.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        },
      }),
      immediate
    );
  };

  const handleDeleteTikTokPost = (id: string) => {
    setTiktokPostModes((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      if (Object.keys(next).length === 0) {
        setShowTikTokShowcaseFeatures(false);
      }
      return next;
    });
    setSelectedPublishedPostId((prev) => (prev === id ? null : prev));
    if (onDeleteTikTokPost) {
      void onDeleteTikTokPost(id);
    } else {
      void onUpdateStore(
        (prev) => ({
          ...prev,
          tiktok: {
            ...prev.tiktok,
            posts: prev.tiktok.posts.filter((p) => p.id !== id),
          },
        }),
        true
      );
    }
  };

  const handleFetchTikTokPostMetadata = async (
    post: TikTokPost,
    overrideUrl?: string,
    forceOverwrite = false
  ) => {
    const targetUrl = normalizeTikTokUrl(overrideUrl ?? post.tiktokUrl);
    if (!isTikTokVideoUrl(targetUrl)) {
      setTiktokFetchStatus((prev) => ({
        ...prev,
        [post.id]: {
          loading: false,
          error:
            'Paste a TikTok video link (e.g. vt.tiktok.com/... or tiktok.com/@.../video/...) to fetch title & cover.',
        },
      }));
      return;
    }

    const prevFetchedUrl = lastFetchedUrls[post.id]
      ? normalizeTikTokUrl(lastFetchedUrls[post.id])
      : '';
    const isNewVideoLink = Boolean(prevFetchedUrl && prevFetchedUrl !== targetUrl);
    autoFetchAttemptedRef.current[post.id] = targetUrl;

    setTiktokFetchStatus((prev) => ({
      ...prev,
      [post.id]: { loading: true, note: 'Extracting cover from TikTok video...' },
    }));

    try {
      const meta = await fetchTikTokVideoMetadata(targetUrl);
      const nextResolvedUrl = meta.resolvedUrl || targetUrl;

      if (meta.coverOptions.length > 0) {
        setTiktokCoverOptions((prev) => ({
          ...prev,
          [post.id]: meta.coverOptions,
        }));
      }

      autoFetchAttemptedRef.current[post.id] = nextResolvedUrl;
      setLastFetchedUrls((prev) => ({
        ...prev,
        [post.id]: nextResolvedUrl,
      }));

      const shouldReplaceWithNewVideo = forceOverwrite || isNewVideoLink;
      const computeUpdatedPost = (current: TikTokPost): TikTokPost => {
        const hasCustomCaption =
          Boolean(current.caption.trim()) && current.caption !== DEFAULT_TIKTOK_CAPTION;
        const nextDescription =
          hasCustomCaption && !shouldReplaceWithNewVideo
            ? current.caption
            : meta.description || current.caption;
        const derivedTitle =
          meta.suggestedTitle ||
          (meta.description ? deriveTitleFromVideoDescription(meta.description) : '');
        const hasCustomTitle =
          Boolean(current.title.trim()) && current.title !== DEFAULT_TIKTOK_TITLE;
        const nextTitle =
          hasCustomTitle && !shouldReplaceWithNewVideo
            ? current.title
            : derivedTitle || current.title;
        const hasCustomCover = !isPlaceholderTikTokCover(current.coverImageUrl);
        const nextCover =
          hasCustomCover && !shouldReplaceWithNewVideo
            ? current.coverImageUrl
            : meta.coverImageUrl || meta.coverOptions[0]?.url || current.coverImageUrl;

        return {
          ...current,
          tiktokUrl: nextResolvedUrl,
          caption: nextDescription,
          title: nextTitle,
          coverImageUrl: nextCover,
        };
      };

      const previewNext = computeUpdatedPost(post);
      if (didTikTokPostChange(post, previewNext)) {
        await onUpdateStore(
          (prev) => ({
            ...prev,
            tiktok: {
              ...prev.tiktok,
              posts: prev.tiktok.posts.map((current) =>
                current.id === post.id ? computeUpdatedPost(current) : current
              ),
            },
          }),
          true
        );
      }

      setTiktokFetchStatus((prev) => ({
        ...prev,
        [post.id]: {
          loading: false,
          note:
            meta.coverOptions.length > 1
              ? `Cover page extracted (${meta.coverOptions.length} options from video)`
              : meta.coverImageUrl
              ? 'Cover page extracted from TikTok video'
              : 'Video link verified (no cover returned — upload or retry)',
        },
      }));
    } catch (err) {
      setTiktokFetchStatus((prev) => ({
        ...prev,
        [post.id]: {
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : 'Could not extract details from that TikTok link.',
        },
      }));
    }
  };

  // Automatically extract the video cover page as soon as a valid TikTok link is entered or changed
  useEffect(() => {
    if (activeTab !== 'tiktok') return;
    const timers: number[] = [];

    for (const post of store.tiktok.posts) {
      const normalized = normalizeTikTokUrl(post.tiktokUrl);
      if (!isTikTokVideoUrl(normalized)) continue;
      if (tiktokFetchStatus[post.id]?.loading) continue;
      if (autoFetchAttemptedRef.current[post.id] === normalized) continue;
      if (!shouldAutoFetchTikTokCover(post, lastFetchedUrls[post.id])) continue;

      const timer = window.setTimeout(() => {
        void handleFetchTikTokPostMetadata(post, normalized);
      }, 450);
      timers.push(timer);
    }

    return () => {
      for (const t of timers) {
        window.clearTimeout(t);
      }
    };
  }, [activeTab, store.tiktok.posts, lastFetchedUrls, tiktokFetchStatus]);

  const handlePublishTikTokPost = async (post: TikTokPost) => {
    const normalized = normalizeTikTokUrl(post.tiktokUrl);
    if (!isTikTokVideoUrl(normalized)) {
      setTiktokFetchStatus((prev) => ({
        ...prev,
        [post.id]: {
          loading: false,
          error:
            'Enter a valid TikTok video link (e.g. https://vt.tiktok.com/... or https://www.tiktok.com/@.../video/...) before publishing.',
        },
      }));
      return;
    }

    setPublishingPostId(post.id);
    setTiktokFetchStatus((prev) => ({
      ...prev,
      [post.id]: { loading: true, note: 'Publishing video to visitors dashboard...' },
    }));

    let resolvedUrl = normalized;
    let fetchedTitle = '';
    let fetchedDesc = '';
    let fetchedCover = '';

    const prevFetchedUrl = lastFetchedUrls[post.id]
      ? normalizeTikTokUrl(lastFetchedUrls[post.id])
      : '';
    const isNewVideoLink = Boolean(prevFetchedUrl && prevFetchedUrl !== normalized);
    const needsMetadata =
      isNewVideoLink ||
      !post.title.trim() ||
      post.title === DEFAULT_TIKTOK_TITLE ||
      isPlaceholderTikTokCover(post.coverImageUrl);

    if (needsMetadata && prevFetchedUrl !== normalized) {
      try {
        const meta = await fetchTikTokVideoMetadata(normalized);
        resolvedUrl = meta.resolvedUrl || normalized;
        fetchedDesc = meta.description || '';
        fetchedTitle =
          meta.suggestedTitle ||
          (fetchedDesc ? deriveTitleFromVideoDescription(fetchedDesc) : '');
        fetchedCover = meta.coverImageUrl || meta.coverOptions[0]?.url || '';
        if (meta.coverOptions.length > 0) {
          setTiktokCoverOptions((prev) => ({
            ...prev,
            [post.id]: meta.coverOptions,
          }));
        }
        autoFetchAttemptedRef.current[post.id] = resolvedUrl;
        setLastFetchedUrls((prev) => ({ ...prev, [post.id]: resolvedUrl }));
      } catch {
        // Proceed with the user's manually entered link, title, and cover image
      }
    }

    const ok = await onUpdateStore((prev) => ({
      ...prev,
      tiktok: {
        ...prev.tiktok,
        posts: prev.tiktok.posts.map((current) => {
          if (current.id !== post.id) return current;
          const keepTitle =
            !isNewVideoLink && current.title.trim() && current.title !== DEFAULT_TIKTOK_TITLE
              ? current.title.trim()
              : fetchedTitle || current.title || 'TikTok Walkaround Video';
          const keepCaption =
            !isNewVideoLink &&
            current.caption.trim() &&
            current.caption !== DEFAULT_TIKTOK_CAPTION
              ? current.caption.trim()
              : fetchedDesc || current.caption;
          const keepCover =
            !isNewVideoLink && !isPlaceholderTikTokCover(current.coverImageUrl)
              ? current.coverImageUrl
              : fetchedCover || current.coverImageUrl;

          return {
            ...current,
            tiktokUrl: resolvedUrl,
            title: keepTitle,
            caption: keepCaption,
            coverImageUrl: keepCover,
          };
        }),
      },
    }), true);

    setPublishingPostId(null);
    if (ok) {
      setTiktokPostModes((prev) => {
        if (!(post.id in prev)) return prev;
        const next = { ...prev };
        delete next[post.id];
        return next;
      });
      setSelectedPublishedPostId((prev) => (prev === post.id ? null : prev));
      setShowTikTokShowcaseFeatures(false);
      const displayTitle =
        post.title.trim() && post.title !== DEFAULT_TIKTOK_TITLE
          ? post.title.trim()
          : fetchedTitle || 'TikTok video';
      setTiktokFetchStatus((prev) => ({
        ...prev,
        [post.id]: {
          loading: false,
          note: 'Published to visitors dashboard!',
        },
      }));
      setUploadNotice({
        type: 'success',
        message: `Published "${displayTitle}" to the visitors' dashboard.`,
        sectionId: 'tiktok-showcase',
      });
    } else {
      setTiktokFetchStatus((prev) => ({
        ...prev,
        [post.id]: {
          loading: false,
          error: saveError || 'Could not publish video to server.',
        },
      }));
    }
  };

  const handleSyncAllTikTok = async () => {
    const syncTargets = store.tiktok.posts.filter((p) => isTikTokVideoUrl(p.tiktokUrl));
    if (syncTargets.length === 0) return;

    setSyncingAllTikTok(true);
    const updatedById = new Map<string, Partial<TikTokPost>>();
    const coverMap: Record<string, { label: string; url: string }[]> = {};
    const statusMap: Record<string, { loading: boolean; error?: string; note?: string }> = {};

    for (const post of syncTargets) {
      setTiktokFetchStatus((prev) => ({
        ...prev,
        [post.id]: { loading: true },
      }));
      try {
        const meta = await fetchTikTokVideoMetadata(normalizeTikTokUrl(post.tiktokUrl));
        const nextDescription = meta.description || post.caption;
        const nextTitle =
          meta.suggestedTitle ||
          (nextDescription ? deriveTitleFromVideoDescription(nextDescription) : '') ||
          post.title;
        const nextCover =
          meta.coverImageUrl || meta.coverOptions[0]?.url || post.coverImageUrl;

        updatedById.set(post.id, {
          tiktokUrl: meta.resolvedUrl || normalizeTikTokUrl(post.tiktokUrl),
          caption: nextDescription,
          title: nextTitle,
          coverImageUrl: nextCover,
        });
        if (meta.coverOptions.length > 0) {
          coverMap[post.id] = meta.coverOptions;
        }
        statusMap[post.id] = {
          loading: false,
          note:
            meta.coverOptions.length > 1
              ? `Fetched description title & ${meta.coverOptions.length} video cover options`
              : 'Fetched title & cover from video',
        };
      } catch (err) {
        statusMap[post.id] = {
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : 'Could not fetch video metadata.',
        };
      }
    }

    if (Object.keys(coverMap).length > 0) {
      setTiktokCoverOptions((prev) => ({ ...prev, ...coverMap }));
    }
    setTiktokFetchStatus((prev) => ({ ...prev, ...statusMap }));

    if (updatedById.size > 0) {
      await onUpdateStore(
        (prev) => ({
          ...prev,
          tiktok: {
            ...prev.tiktok,
            posts: prev.tiktok.posts.map((p) =>
              updatedById.has(p.id) ? { ...p, ...updatedById.get(p.id)! } : p
            ),
          },
        }),
        true
      );
    }
    setSyncingAllTikTok(false);
  };

  const handlePickCoverFromVideoFile = async (
    postId: string,
    e: ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTiktokFetchStatus((prev) => ({
      ...prev,
      [postId]: { loading: true, note: 'Extracting cover frames from video...' },
    }));
    try {
      const frames = await extractFramesFromVideoFile(file, 4, 960);
      const options = frames.map((f) => ({ label: f.label, url: f.dataUrl }));
      if (options.length > 0) {
        setTiktokCoverOptions((prev) => ({
          ...prev,
          [postId]: options,
        }));
        await handleUpdateTikTokPost(postId, { coverImageUrl: options[0].url }, true);
        setTiktokFetchStatus((prev) => ({
          ...prev,
          [postId]: {
            loading: false,
            note: `Extracted ${options.length} frames — click a thumbnail below to pick the cover`,
          },
        }));
      } else {
        setTiktokFetchStatus((prev) => ({
          ...prev,
          [postId]: { loading: false, error: 'No frames could be extracted from this video.' },
        }));
      }
    } catch (err) {
      setTiktokFetchStatus((prev) => ({
        ...prev,
        [postId]: {
          loading: false,
          error:
            err instanceof Error ? err.message : 'Failed to extract frames from video.',
        },
      }));
    } finally {
      e.target.value = '';
    }
  };

  const navItems: {
    id: AdminTab;
    label: string;
    icon: typeof Car;
    count?: number;
    highlightBadge?: boolean;
  }[] = [
    { id: 'inventory', label: 'Inventory Manager', icon: Car, count: store.vehicles.length },
    { id: 'tiktok', label: 'TikTok Video Links', icon: Film, count: store.tiktok.posts.length },
    { id: 'contact', label: 'Location & Contact', icon: MapPin },
    {
      id: 'security',
      label: 'Security & Devices',
      icon: Shield,
      count: pendingAlertCount > 0 ? pendingAlertCount : undefined,
      highlightBadge: pendingAlertCount > 0,
    },
    { id: 'visitors', label: 'Visitors & Interactions', icon: BarChart3 },
  ];

  const activeNav = navItems.find((item) => item.id === activeTab) ?? navItems[0];

  return (
    <div className="min-h-screen bg-[#08080a] text-zinc-100 flex flex-col lg:flex-row">
      {/* Desktop Workspace Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-[#0d0d11] border-r border-white/[0.07] sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-white/[0.07] flex items-center gap-3">
          <img
            src={logoSrc}
            alt={store.branding.companyName}
            referrerPolicy="no-referrer"
            onError={(e) => {
              if (!e.currentTarget.src.endsWith(ALIF_DEFAULT_LOGO)) {
                e.currentTarget.src = ALIF_DEFAULT_LOGO;
              }
            }}
            className="w-9 h-9 rounded-full object-cover bg-white ring-2 ring-white/15 shrink-0"
          />
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold text-white truncate">
              {store.branding.companyName}
            </p>
            <p className="text-[11px] text-zinc-400">Admin Console</p>
          </div>
        </div>

        <nav aria-label="Admin sections" role="tablist" className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#E11D2A]/12 text-white border border-[#E11D2A]/30'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#E11D2A]' : 'text-zinc-500'}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.count === 'number' && (
                  <span
                    className={`font-mono text-xs tabular-nums shrink-0 ${
                      item.highlightBadge
                        ? 'px-1.5 py-0.5 rounded bg-amber-500 text-black font-bold'
                        : 'text-zinc-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/[0.07] space-y-3">
          {adminEmail && (
            <div className="px-1">
              <p className="text-[11px] text-zinc-500">Signed in as</p>
              <p className="text-xs font-medium text-zinc-200 truncate">{adminEmail}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => void onPublishAndView()}
              className="w-full inline-flex items-center justify-between px-3 py-2 rounded-lg border border-white/[0.08] hover:border-white/25 text-xs font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer"
            >
              <span>View Showroom</span>
              <ExternalLink className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
            </button>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="w-full inline-flex items-center justify-between px-3 py-2 rounded-lg border border-transparent hover:bg-red-950/30 hover:border-red-900/50 text-xs font-medium text-zinc-400 hover:text-red-300 transition-colors cursor-pointer"
              >
                <span>Sign Out</span>
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile Top Navigation (< lg) */}
        <header className="lg:hidden sticky top-0 z-30 bg-[#0d0d11]/95 backdrop-blur-md border-b border-white/[0.08]">
          <div className="px-4 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={logoSrc}
                alt={store.branding.companyName}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  if (!e.currentTarget.src.endsWith(ALIF_DEFAULT_LOGO)) {
                    e.currentTarget.src = ALIF_DEFAULT_LOGO;
                  }
                }}
                className="w-7 h-7 rounded-full object-cover bg-white shrink-0"
              />
              <span className="font-display text-sm font-semibold text-white truncate">
                Alif <span className="text-[#E11D2A]">Car</span> Admin
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {onImportFromFirebase && (
                <button
                  type="button"
                  disabled={importingMobileApp}
                  onClick={() => void handleImportFromMobileApp()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                >
                  {importingMobileApp ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{importingMobileApp ? 'Importing...' : 'Import App'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void onPublishAndView()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/[0.1] text-xs font-medium text-zinc-200 hover:text-white cursor-pointer whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Showroom</span>
              </button>
              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  aria-label="Sign Out"
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-red-300 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Admin sections"
            className="px-4 pb-2.5 flex items-center gap-1.5 overflow-x-auto"
          >
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-[#E11D2A] text-white'
                      : 'bg-[#15151a] text-zinc-400 hover:text-white border border-white/[0.06]'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.highlightBadge && typeof item.count === 'number' && (
                    <span className="px-1.5 py-0.2 rounded bg-amber-400 text-black text-[10px] font-bold tabular-nums">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </header>

        {/* Desktop Workspace Top Bar */}
        <header className="hidden lg:flex items-center justify-between gap-8 px-8 py-4 border-b border-white/[0.07] bg-[#0a0a0d]/85 backdrop-blur-md sticky top-0 z-20">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span>{store.branding.companyName}</span>
              <span aria-hidden="true">/</span>
              <span className="text-zinc-200 font-medium">{activeNav.label}</span>
              {saveState === 'saving' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-300">Saving changes...</span>
                </>
              )}
              {saveState === 'saved' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-400">All changes published</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {onImportFromFirebase && (
              <button
                type="button"
                disabled={importingMobileApp}
                onClick={() => void handleImportFromMobileApp()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-medium text-amber-200 hover:text-white disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {importingMobileApp ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{importingMobileApp ? importProgress || 'Importing...' : 'Import from Mobile App'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void onPublishAndView()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/[0.1] hover:border-white/30 text-xs font-medium text-zinc-200 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span>View Showroom</span>
            </button>

            {activeTab === 'inventory' && (
              <button
                type="button"
                onClick={() => {
                  setEditingVehicle(null);
                  setFormOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add Vehicle</span>
              </button>
            )}

            {activeTab === 'tiktok' && (
              <button
                type="button"
                onClick={handleAddTikTokPost}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add TikTok Video</span>
              </button>
            )}

            {activeTab === 'contact' && (
              <button
                type="button"
                onClick={() =>
                  void handlePublishSection('Location & contact details', 'location-contact')
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Publish Changes</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
          {(uploadNotice || (saveState === 'error' && saveError)) && (
            <div
              role={uploadNotice?.type === 'error' || saveState === 'error' ? 'alert' : 'status'}
              className={`px-4 py-3 rounded-xl border text-xs font-medium flex flex-wrap items-center justify-between gap-3 ${
                uploadNotice?.type === 'error' || saveState === 'error'
                  ? 'bg-[#201113] border-red-900/70 text-red-300'
                  : 'bg-emerald-950/40 border-emerald-800/70 text-emerald-300'
              }`}
            >
              <span>{uploadNotice?.message || saveError}</span>
              <div className="flex items-center gap-3">
                {uploadNotice?.type === 'success' && (
                  <button
                    type="button"
                    onClick={() => void onPublishAndView(uploadNotice.sectionId)}
                    className="inline-flex items-center gap-1 text-xs font-semibold underline hover:text-white cursor-pointer"
                  >
                    <span>View on Visitors Dashboard</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setUploadNotice(null);
                    onDismissSaveError?.();
                  }}
                  className="text-xs underline opacity-80 hover:opacity-100 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <PendingLoginAlertsBanner
            alerts={loginAlerts}
            onDecide={handleAlertDecision}
            busyId={busyAlertId}
          />

          {/* Single-Elevation Summary KPI Strip */}
          {(activeTab === 'inventory' || activeTab === 'tiktok' || activeTab === 'contact') && (
          <div className="grid grid-cols-2 lg:grid-cols-4 bg-[#111115] border border-white/[0.08] rounded-2xl divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] overflow-hidden">
            <div className="p-4 sm:p-5">
              <span className="block text-xs text-zinc-400">Total Fleet</span>
              <span className="mt-1.5 block font-mono text-2xl font-semibold text-white tabular-nums">
                {store.vehicles.length}
              </span>
              <span className="mt-1 block text-xs text-zinc-500 tabular-nums">
                {featuredCount} featured · ${totalCatalogValue.toLocaleString()} total
              </span>
            </div>
            <div className="p-4 sm:p-5">
              <span className="block text-xs text-zinc-400">Available</span>
              <span className="mt-1.5 block font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
                {availableCount}
              </span>
              <span className="mt-1 block text-xs text-zinc-500">Ready on showroom floor</span>
            </div>
            <div className="p-4 sm:p-5">
              <span className="block text-xs text-zinc-400">Reserved</span>
              <span className="mt-1.5 block font-mono text-2xl font-semibold text-amber-400 tabular-nums">
                {reservedCount}
              </span>
              <span className="mt-1 block text-xs text-zinc-500">Held for buyers</span>
            </div>
            <div className="p-4 sm:p-5">
              <span className="block text-xs text-zinc-400">Sold</span>
              <span className="mt-1.5 block font-mono text-2xl font-semibold text-zinc-300 tabular-nums">
                {soldCount}
              </span>
              <span className="mt-1 block text-xs text-zinc-500">Completed deliveries</span>
            </div>
          </div>
          )}

          {/* TAB 1: INVENTORY MANAGER */}
          {activeTab === 'inventory' && (
            <section className="bg-[#111115] border border-white/[0.08] rounded-2xl overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-white/[0.07] space-y-3">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5 flex-1">
                    <div className="relative w-full sm:w-64">
                      <Search
                        className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search make, model, year..."
                        aria-label="Filter admin inventory"
                        className="w-full h-10 pl-9 pr-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E11D2A]"
                      />
                    </div>

                    <select
                      aria-label="Filter by make"
                      value={makeFilter}
                      onChange={(e) => setMakeFilter(e.target.value)}
                      className="h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-xs font-medium text-zinc-200 cursor-pointer focus:outline-none focus:border-[#E11D2A]"
                    >
                      <option value="">All Makes</option>
                      {availableMakes.map((make) => (
                        <option key={make} value={make}>
                          {make}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Sort inventory"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as InventorySort)}
                      className="h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-xs font-medium text-zinc-200 cursor-pointer focus:outline-none focus:border-[#E11D2A]"
                    >
                      <option value="newest">Sort: Default Order</option>
                      <option value="year-desc">Sort: Year (Newest)</option>
                      <option value="price-desc">Sort: Price (High–Low)</option>
                      <option value="price-asc">Sort: Price (Low–High)</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5">
                    <div className="flex items-center gap-1 p-1 bg-[#09090c] border border-white/[0.08] rounded-lg">
                      {(['all', 'available', 'reserved', 'sold'] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setStatusFilter(st)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                            statusFilter === st
                              ? 'bg-[#E11D2A] text-white'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setEditingVehicle(null);
                        setFormOpen(true);
                      }}
                      className="lg:hidden inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      <span>Add Vehicle</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="tabular-nums">
                    Showing <strong className="text-zinc-200">{filteredInventory.length}</strong> of{' '}
                    {store.vehicles.length} vehicles
                  </span>
                  {(searchQuery || makeFilter || statusFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setMakeFilter('');
                        setStatusFilter('all');
                      }}
                      className="text-xs font-medium text-zinc-300 hover:text-white underline cursor-pointer"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              </div>

              {filteredInventory.length === 0 ? (
                <div className="p-12 text-center space-y-3">
                  <p className="text-sm text-zinc-400">No vehicles match your current filters.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingVehicle(null);
                      setFormOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Add Vehicle</span>
                  </button>
                </div>
              ) : (
                <>
                  {/* Desktop High-Density Table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-white/[0.07] text-[11px] font-medium uppercase tracking-wider text-zinc-400 bg-[#0d0d11]/70">
                          <th scope="col" className="py-3 pl-5 pr-3">
                            Vehicle
                          </th>
                          <th scope="col" className="py-3 px-3">
                            Origin &amp; Powertrain
                          </th>
                          <th scope="col" className="py-3 px-3 text-right">
                            Price (USD)
                          </th>
                          <th scope="col" className="py-3 px-3">
                            Status
                          </th>
                          <th scope="col" className="py-3 px-3 text-center">
                            Featured
                          </th>
                          <th scope="col" className="py-3 pl-3 pr-5 text-right">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.06]">
                        {filteredInventory.map((vehicle) => (
                          <tr
                            key={vehicle.id}
                            className="hover:bg-white/[0.025] transition-colors"
                          >
                            <td className="py-3 pl-5 pr-3">
                              <div className="flex items-center gap-3.5 min-w-0">
                                <img
                                  src={resolvePublicAssetUrl(vehicle.imageUrl)}
                                  alt={vehicle.title}
                                  decoding="async"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    const el = e.currentTarget;
                                    const fallbacks = getPublicAssetFallbackUrls(vehicle.imageUrl);
                                    const nextIdx = Number(el.dataset.fallbackIdx || '0') + 1;
                                    if (nextIdx < fallbacks.length) {
                                      el.dataset.fallbackIdx = String(nextIdx);
                                      el.src = fallbacks[nextIdx];
                                    }
                                  }}
                                  className="w-16 h-11 rounded-lg object-cover border border-white/[0.08] bg-zinc-900 shrink-0"
                                />
                                <div className="min-w-0 max-w-xs">
                                  <h3 className="font-display text-sm font-semibold text-white truncate">
                                    {vehicle.title}
                                  </h3>
                                  <p className="text-xs text-zinc-400 tabular-nums truncate">
                                    {vehicle.make} · {vehicle.model} · {vehicle.year} ·{' '}
                                    {vehicle.mileage}
                                  </p>
                                </div>
                              </div>
                            </td>

                            <td className="py-3 px-3 text-xs text-zinc-400 whitespace-nowrap">
                              <span className="block text-zinc-200">{vehicle.origin}</span>
                              <span className="text-zinc-500">
                                {vehicle.fuelType} · {vehicle.transmission}
                              </span>
                            </td>

                            <td className="py-3 px-3 text-right">
                              <div className="inline-flex items-center justify-end gap-1">
                                <label
                                  htmlFor={`quick-price-${vehicle.id}`}
                                  className="text-xs text-zinc-500"
                                >
                                  $
                                </label>
                                <input
                                  id={`quick-price-${vehicle.id}`}
                                  type="number"
                                  aria-label={`Quick price for ${vehicle.title}`}
                                  value={vehicle.price}
                                  onChange={(e) =>
                                    handleQuickPriceChange(vehicle.id, e.target.value)
                                  }
                                  className="w-24 h-8 px-2 text-right bg-[#09090c] border border-white/[0.1] rounded-lg text-xs font-mono font-medium text-white tabular-nums focus:outline-none focus:border-[#E11D2A]"
                                />
                              </div>
                            </td>

                            <td className="py-3 px-3">
                              <select
                                aria-label={`Availability status for ${vehicle.title}`}
                                value={vehicle.status}
                                onChange={(e) =>
                                  handleQuickStatusChange(
                                    vehicle.id,
                                    e.target.value as VehicleStatus
                                  )
                                }
                                className={`h-8 px-2.5 bg-[#09090c] border border-white/[0.1] rounded-lg text-xs font-medium cursor-pointer focus:outline-none focus:border-[#E11D2A] ${
                                  vehicle.status === 'available'
                                    ? 'text-emerald-400'
                                    : vehicle.status === 'reserved'
                                    ? 'text-amber-400'
                                    : 'text-zinc-400'
                                }`}
                              >
                                <option value="available">Available</option>
                                <option value="reserved">Reserved</option>
                                <option value="sold">Sold</option>
                              </select>
                            </td>

                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleQuickToggleFeatured(vehicle.id)}
                                aria-pressed={vehicle.featured}
                                aria-label={`${vehicle.featured ? 'Unfeature' : 'Feature'} ${vehicle.title}`}
                                title={vehicle.featured ? 'Remove from featured' : 'Mark as featured'}
                                className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors cursor-pointer ${
                                  vehicle.featured
                                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                                    : 'border-white/[0.08] bg-[#09090c] text-zinc-500 hover:text-white hover:border-white/25'
                                }`}
                              >
                                <Star
                                  className={`w-3.5 h-3.5 ${vehicle.featured ? 'fill-amber-400' : ''}`}
                                  aria-hidden="true"
                                />
                              </button>
                            </td>

                            <td className="py-3 pl-3 pr-5 text-right">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <label
                                  title="Upload vehicle photo"
                                  className="inline-flex items-center gap-1 h-8 px-2.5 border border-white/[0.1] hover:border-white/30 bg-[#09090c] text-zinc-200 text-xs font-medium rounded-lg cursor-pointer transition-colors"
                                >
                                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Photo</span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) =>
                                      handleUploadImageForField(
                                        e,
                                        (url) => handleQuickVehiclePhoto(vehicle.id, url),
                                        `${vehicle.title} photo`
                                      )
                                    }
                                    className="sr-only"
                                  />
                                </label>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingVehicle(vehicle);
                                    setFormOpen(true);
                                  }}
                                  aria-label={`Edit ${vehicle.title}`}
                                  className="inline-flex items-center gap-1 h-8 px-2.5 border border-white/[0.1] hover:border-white/30 bg-[#09090c] text-zinc-200 text-xs font-medium rounded-lg cursor-pointer transition-colors"
                                >
                                  <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Edit</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDuplicateVehicle(vehicle)}
                                  aria-label={`Duplicate ${vehicle.title}`}
                                  title="Duplicate listing"
                                  className="inline-flex items-center justify-center w-8 h-8 border border-white/[0.1] hover:border-white/30 bg-[#09090c] text-zinc-300 rounded-lg cursor-pointer transition-colors"
                                >
                                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>

                                {confirmDeleteId === vehicle.id ? (
                                  <div className="flex items-center gap-1.5 bg-[#201113] px-2.5 h-8 rounded-lg border border-red-900/70">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteVehicle(vehicle.id)}
                                      className="text-xs font-semibold text-[#E11D2A] hover:underline cursor-pointer"
                                    >
                                      Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="text-xs text-zinc-400 hover:underline cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(vehicle.id)}
                                    aria-label={`Delete ${vehicle.title}`}
                                    title="Delete listing"
                                    className="inline-flex items-center justify-center w-8 h-8 border border-white/[0.1] hover:border-red-500/70 hover:text-[#E11D2A] bg-[#09090c] text-zinc-400 rounded-lg cursor-pointer transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Compact Rows */}
                  <div className="md:hidden divide-y divide-white/[0.07]">
                    {filteredInventory.map((vehicle) => (
                      <div key={vehicle.id} className="p-4 space-y-3">
                        <div className="flex items-start gap-3">
                          <img
                            src={resolvePublicAssetUrl(vehicle.imageUrl)}
                            alt={vehicle.title}
                            decoding="async"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              const el = e.currentTarget;
                              const fallbacks = getPublicAssetFallbackUrls(vehicle.imageUrl);
                              const nextIdx = Number(el.dataset.fallbackIdx || '0') + 1;
                              if (nextIdx < fallbacks.length) {
                                el.dataset.fallbackIdx = String(nextIdx);
                                el.src = fallbacks[nextIdx];
                              }
                            }}
                            className="w-20 h-14 rounded-lg object-cover border border-white/[0.08] bg-zinc-900 shrink-0"
                          />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <h3 className="font-display text-sm font-semibold text-white truncate">
                              {vehicle.title}
                            </h3>
                            <p className="text-xs text-zinc-400 tabular-nums">
                              {vehicle.make} · {vehicle.year} · {vehicle.mileage}
                            </p>
                            <p className="text-[11px] text-zinc-500 truncate">{vehicle.origin}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleQuickToggleFeatured(vehicle.id)}
                            aria-pressed={vehicle.featured}
                            aria-label={`${vehicle.featured ? 'Unfeature' : 'Feature'} ${vehicle.title}`}
                            className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border shrink-0 cursor-pointer ${
                              vehicle.featured
                                ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                                : 'border-white/[0.08] bg-[#09090c] text-zinc-500'
                            }`}
                          >
                            <Star
                              className={`w-4 h-4 ${vehicle.featured ? 'fill-amber-400' : ''}`}
                              aria-hidden="true"
                            />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                              $
                            </span>
                            <input
                              id={`mobile-quick-price-${vehicle.id}`}
                              type="number"
                              aria-label={`Quick price for ${vehicle.title}`}
                              value={vehicle.price}
                              onChange={(e) => handleQuickPriceChange(vehicle.id, e.target.value)}
                              className="w-full h-10 pl-6 pr-2.5 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm font-mono text-white tabular-nums focus:outline-none focus:border-[#E11D2A]"
                            />
                          </div>

                          <select
                            aria-label={`Availability status for ${vehicle.title}`}
                            value={vehicle.status}
                            onChange={(e) =>
                              handleQuickStatusChange(vehicle.id, e.target.value as VehicleStatus)
                            }
                            className="w-full h-10 px-2.5 bg-[#09090c] border border-white/[0.1] rounded-lg text-xs font-medium text-zinc-200 cursor-pointer focus:outline-none focus:border-[#E11D2A]"
                          >
                            <option value="available">Available</option>
                            <option value="reserved">Reserved</option>
                            <option value="sold">Sold</option>
                          </select>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex items-center justify-center gap-1.5 h-10 px-3 border border-white/[0.1] bg-[#09090c] text-zinc-200 text-xs font-medium rounded-lg cursor-pointer">
                            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Photo</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) =>
                                handleUploadImageForField(
                                  e,
                                  (url) => handleQuickVehiclePhoto(vehicle.id, url),
                                  `${vehicle.title} photo`
                                )
                              }
                              className="sr-only"
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() => {
                              setEditingVehicle(vehicle);
                              setFormOpen(true);
                            }}
                            className="inline-flex items-center justify-center gap-1.5 h-10 px-3 border border-white/[0.1] bg-[#09090c] text-zinc-200 text-xs font-medium rounded-lg cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDuplicateVehicle(vehicle)}
                            aria-label={`Duplicate ${vehicle.title}`}
                            className="inline-flex items-center justify-center w-10 h-10 border border-white/[0.1] bg-[#09090c] text-zinc-300 rounded-lg cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>

                          {confirmDeleteId === vehicle.id ? (
                            <div className="ml-auto flex items-center gap-2 bg-[#201113] px-3 h-10 rounded-lg border border-red-900/70">
                              <button
                                type="button"
                                onClick={() => handleDeleteVehicle(vehicle.id)}
                                className="text-xs font-semibold text-[#E11D2A]"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs text-zinc-400"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(vehicle.id)}
                              aria-label={`Delete ${vehicle.title}`}
                              className="ml-auto inline-flex items-center justify-center w-10 h-10 border border-white/[0.1] bg-[#09090c] text-zinc-400 hover:text-[#E11D2A] rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {/* TAB 2: TIKTOK VIDEO LINKS */}
          {activeTab === 'tiktok' && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-[#111115] border border-white/[0.08] rounded-2xl p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddTikTokPost}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>Add TikTok Video</span>
                  </button>

                  {store.tiktok.posts.some((p) => isTikTokVideoUrl(p.tiktokUrl)) && (
                    <button
                      type="button"
                      disabled={syncingAllTikTok}
                      onClick={handleSyncAllTikTok}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-white/[0.1] hover:border-white/30 bg-[#09090c] text-zinc-200 hover:text-white text-xs font-medium rounded-lg cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {syncingAllTikTok ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>{syncingAllTikTok ? 'Syncing...' : 'Sync All Videos'}</span>
                    </button>
                  )}

                  {store.tiktok.posts.some((p) => !isTikTokVideoUrl(p.tiktokUrl)) && (
                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateStore(
                          (prev) => ({
                            ...prev,
                            tiktok: {
                              ...prev.tiktok,
                              posts: prev.tiktok.posts.filter((p) =>
                                isTikTokVideoUrl(p.tiktokUrl)
                              ),
                            },
                          }),
                          true
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-white/[0.1] hover:border-red-500/60 bg-[#09090c] text-zinc-300 hover:text-[#E11D2A] text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Remove Unlinked</span>
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowTikTokShowcaseFeatures((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-white/[0.1] hover:border-white/30 bg-[#09090c] text-zinc-200 hover:text-white text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{showTikTokShowcaseFeatures ? 'Hide Settings' : 'Showcase Settings'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
              {store.tiktok.posts.map((post, idx) => {
                const fetchStatus = tiktokFetchStatus[post.id];
                const coverOptions = tiktokCoverOptions[post.id] || [];
                const canFetchVideo = isTikTokVideoUrl(post.tiktokUrl);
                const cardMode = resolveTikTokAdminCardMode(
                  post.tiktokUrl,
                  tiktokPostModes[post.id]
                );
                const isSelected = selectedPublishedPostId === post.id;

                if (cardMode === 'collapsed') {
                  return (
                    <div
                      key={post.id}
                      data-testid={`admin-tiktok-compact-${post.id}`}
                      className={`bg-[#141418] border rounded-xl p-3.5 transition-colors ${
                        isSelected
                          ? 'border-[#D92027]/70 bg-[#18181d]'
                          : 'border-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      <button
                        type="button"
                        aria-expanded={isSelected}
                        onClick={() =>
                          setSelectedPublishedPostId((prev) =>
                            prev === post.id ? null : post.id
                          )
                        }
                        className="w-full flex items-center gap-3 text-left cursor-pointer"
                      >
                        <div className="relative w-14 sm:w-16 aspect-[9/14] shrink-0 rounded-lg overflow-hidden bg-zinc-950 border border-zinc-800">
                          <img
                            src={post.coverImageUrl}
                            alt={post.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                            <span className="w-6 h-6 rounded-full bg-black/55 border border-white/25 text-white/85 inline-flex items-center justify-center">
                              <Play className="w-3 h-3 fill-current translate-x-[0.5px]" aria-hidden="true" />
                            </span>
                          </div>
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[11px] font-semibold text-zinc-400">
                                #{idx + 1}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                                <Check className="w-3 h-3" aria-hidden="true" />
                                Published
                              </span>
                            </div>
                            {isSelected ? (
                              <ChevronUp className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
                            )}
                          </div>

                          <h3 className="font-display text-sm font-semibold text-white leading-snug line-clamp-2">
                            {post.title}
                          </h3>

                          <p className="text-[11px] text-zinc-400 truncate">
                            {normalizeTikTokUrl(post.tiktokUrl)}
                          </p>

                          <p className="text-[11px] text-zinc-500">
                            {isSelected ? 'Choose an option below' : 'Tap to edit or change video link'}
                          </p>
                        </div>
                      </button>

                      {isSelected && (
                        <div className="pt-3 mt-3 border-t border-zinc-800 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const existingNormalized = normalizeTikTokUrl(post.tiktokUrl);
                              if (existingNormalized) {
                                setLastFetchedUrls((prev) => ({
                                  ...prev,
                                  [post.id]: existingNormalized,
                                }));
                              }
                              setTiktokPostModes((prev) => ({ ...prev, [post.id]: 'edit' }));
                              setSelectedPublishedPostId(null);
                            }}
                            className="inline-flex items-center gap-1.5 h-8 px-3 bg-[#1c1c21] border border-zinc-700 hover:border-white text-xs font-medium text-white rounded-lg cursor-pointer transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const existingNormalized = normalizeTikTokUrl(post.tiktokUrl);
                              if (existingNormalized) {
                                setLastFetchedUrls((prev) => ({
                                  ...prev,
                                  [post.id]: existingNormalized,
                                }));
                              }
                              setTiktokPostModes((prev) => ({
                                ...prev,
                                [post.id]: 'change-link',
                              }));
                              setSelectedPublishedPostId(null);
                            }}
                            className="inline-flex items-center gap-1.5 h-8 px-3 bg-[#D92027]/15 border border-[#D92027]/60 hover:bg-[#D92027] text-xs font-medium text-red-200 hover:text-white rounded-lg cursor-pointer transition-colors"
                          >
                            <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Change Video Link</span>
                          </button>

                          <a
                            href={normalizeTikTokUrl(post.tiktokUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 h-8 px-2.5 border border-zinc-800 hover:border-zinc-600 text-xs text-zinc-300 hover:text-white rounded-lg transition-colors"
                          >
                            <span>Open</span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </a>

                          <button
                            type="button"
                            onClick={() => handleDeleteTikTokPost(post.id)}
                            aria-label={`Remove TikTok post ${post.title}`}
                            className="ml-auto inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium text-zinc-400 hover:text-[#D92027] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Remove</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                if (cardMode === 'change-link') {
                  return (
                    <div
                      key={post.id}
                      data-testid={`admin-tiktok-change-link-${post.id}`}
                      className="bg-[#141418] border border-zinc-700 rounded-xl p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-10 aspect-[9/14] shrink-0 rounded-md overflow-hidden bg-zinc-950 border border-zinc-800">
                            <img
                              src={post.coverImageUrl}
                              alt={post.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <span className="block text-[11px] font-medium text-[#D92027]">
                              Change Video Link · #{idx + 1}
                            </span>
                            <h3 className="font-display text-xs font-semibold text-white truncate">
                              {post.title}
                            </h3>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setTiktokPostModes((prev) => {
                              const next = { ...prev };
                              delete next[post.id];
                              return next;
                            })
                          }
                          aria-label="Cancel changing video link"
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-white cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Cancel</span>
                        </button>
                      </div>

                      <div>
                        <label
                          htmlFor={`tt-change-url-${post.id}`}
                          className="block text-xs font-medium text-zinc-300 mb-1"
                        >
                          New TikTok Video Link
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id={`tt-change-url-${post.id}`}
                            type="url"
                            autoFocus
                            value={post.tiktokUrl}
                            onChange={(e) => {
                              const nextUrl = e.target.value;
                              setTiktokPostModes((prev) => ({
                                ...prev,
                                [post.id]: 'change-link',
                              }));
                              void handleUpdateTikTokPost(post.id, { tiktokUrl: nextUrl });
                            }}
                            onPaste={(e) => {
                              const pasted = normalizeTikTokUrl(
                                e.clipboardData.getData('text')
                              );
                              if (isTikTokVideoUrl(pasted)) {
                                e.preventDefault();
                                setTiktokPostModes((prev) => ({
                                  ...prev,
                                  [post.id]: 'change-link',
                                }));
                                void handleUpdateTikTokPost(
                                  post.id,
                                  { tiktokUrl: pasted },
                                  true
                                );
                                void handleFetchTikTokPostMetadata(post, pasted, true);
                              }
                            }}
                            placeholder="https://vt.tiktok.com/... or https://www.tiktok.com/@.../video/..."
                            className="flex-1 min-w-0 h-9 px-2.5 bg-[#1c1c21] border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-[#D92027]"
                          />
                          <button
                            type="button"
                            disabled={fetchStatus?.loading || !canFetchVideo}
                            onClick={() => handleFetchTikTokPostMetadata(post, undefined, true)}
                            aria-label={`Fetch title and cover from TikTok video ${idx + 1}`}
                            className="inline-flex items-center gap-1 h-9 px-2.5 bg-[#1c1c21] border border-zinc-700 hover:border-white disabled:opacity-45 text-xs font-medium text-zinc-200 hover:text-white rounded-lg cursor-pointer shrink-0 transition-colors"
                          >
                            {fetchStatus?.loading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>Fetch</span>
                          </button>
                        </div>
                        {post.tiktokUrl.trim() && !canFetchVideo && (
                          <p className="mt-1 text-[11px] text-amber-400">
                            Enter a valid TikTok video link (e.g. vt.tiktok.com/... or tiktok.com/@.../video/...).
                          </p>
                        )}
                        {fetchStatus?.error && (
                          <p className="mt-1 text-[11px] text-[#D92027]">{fetchStatus.error}</p>
                        )}
                        {!fetchStatus?.error && fetchStatus?.note && (
                          <p className="mt-1 text-[11px] text-emerald-400">{fetchStatus.note}</p>
                        )}
                      </div>

                      <div className="pt-2 border-t border-zinc-800 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={publishingPostId === post.id}
                          onClick={() => void handlePublishTikTokPost(post)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-[#D92027] hover:bg-[#B91C1C] disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                        >
                          {publishingPostId === post.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Send className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span>
                            {publishingPostId === post.id
                              ? 'Publishing...'
                              : 'Publish New Link'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setTiktokPostModes((prev) => ({ ...prev, [post.id]: 'edit' }))
                          }
                          className="inline-flex items-center gap-1 h-9 px-3 border border-zinc-700 hover:border-white bg-[#1c1c21] text-xs font-medium text-zinc-200 hover:text-white rounded-lg cursor-pointer transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Full Edit</span>
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={post.id}
                    data-testid={`admin-tiktok-edit-${post.id}`}
                    className="bg-[#141418] border border-zinc-800 rounded-xl p-4 sm:p-5 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-zinc-400">
                          TikTok Post #{idx + 1}
                        </span>
                        {canFetchVideo ? (
                          <span className="text-[10px] font-medium text-emerald-400">
                            Ready to publish
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium text-amber-400">
                            Add video link to publish
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {canFetchVideo && (
                          <button
                            type="button"
                            onClick={() =>
                              setTiktokPostModes((prev) => {
                                const next = { ...prev };
                                delete next[post.id];
                                return next;
                              })
                            }
                            className="text-xs font-medium text-zinc-400 hover:text-white cursor-pointer"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteTikTokPost(post.id)}
                          aria-label={`Remove TikTok post ${post.title}`}
                          className="text-xs font-medium text-zinc-400 hover:text-[#D92027] cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="flex items-start gap-3.5">
                      <div className="relative w-20 sm:w-24 aspect-[9/15] shrink-0 rounded-lg overflow-hidden bg-zinc-950 border border-zinc-800">
                        {post.coverImageUrl ? (
                          <img
                            src={post.coverImageUrl}
                            alt={post.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 p-2 text-center gap-1">
                            <Film className="w-5 h-5" aria-hidden="true" />
                            <span className="text-[10px] leading-tight">
                              Auto cover from TikTok link
                            </span>
                          </div>
                        )}
                        {fetchStatus?.loading && (
                          <div className="absolute inset-0 bg-black/70 backdrop-blur-[1px] flex flex-col items-center justify-center gap-1.5 text-white p-1.5 text-center">
                            <Loader2 className="w-4 h-4 animate-spin text-[#E11D2A]" aria-hidden="true" />
                            <span className="text-[9px] font-medium leading-tight">
                              Loading cover...
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs font-medium rounded-lg cursor-pointer">
                          <Upload className="w-3 h-3" aria-hidden="true" />
                          <span>Upload Cover</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) =>
                              handleUploadImageForField(
                                e,
                                (url) =>
                                  handleUpdateTikTokPost(post.id, { coverImageUrl: url }, true),
                                'TikTok cover image'
                              )
                            }
                            className="sr-only"
                          />
                        </label>

                        <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-zinc-700 hover:border-white bg-[#1c1c21] text-zinc-200 hover:text-white text-xs font-medium rounded-lg cursor-pointer">
                          <Film className="w-3 h-3" aria-hidden="true" />
                          <span>From Video File</span>
                          <input
                            type="file"
                            accept="video/*"
                            onChange={(e) => handlePickCoverFromVideoFile(post.id, e)}
                            className="sr-only"
                          />
                        </label>

                        {post.tiktokUrl && (
                          <a
                            href={normalizeTikTokUrl(post.tiktokUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white"
                          >
                            Test Link <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>

                    {coverOptions.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="block text-[11px] font-medium text-zinc-400">
                          Pick Cover Image from Video
                        </span>
                        <div className="grid grid-cols-4 gap-2">
                          {coverOptions.map((opt) => {
                            const selected = post.coverImageUrl === opt.url;
                            return (
                              <button
                                key={opt.url}
                                type="button"
                                onClick={() =>
                                  void handleUpdateTikTokPost(
                                    post.id,
                                    { coverImageUrl: opt.url },
                                    true
                                  )
                                }
                                aria-label={`Use ${opt.label} as cover for ${post.title}`}
                                className={`group relative rounded-md overflow-hidden border bg-zinc-950 aspect-[3/4] cursor-pointer transition-all ${
                                  selected
                                    ? 'border-[#D92027] ring-2 ring-[#D92027]/40'
                                    : 'border-zinc-700 hover:border-zinc-400'
                                }`}
                              >
                                <img
                                  src={opt.url}
                                  alt={opt.label}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                                <span className="absolute inset-x-0 bottom-0 bg-black/75 px-1 py-0.5 text-[9px] font-medium text-zinc-200 truncate">
                                  {opt.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div>
                      <label
                        htmlFor={`tt-url-${post.id}`}
                        className="block text-xs font-medium text-zinc-300 mb-1"
                      >
                        TikTok Video Link (auto-fetches title &amp; cover)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id={`tt-url-${post.id}`}
                          type="url"
                          value={post.tiktokUrl}
                          onChange={(e) => {
                            const nextUrl = e.target.value;
                            setTiktokPostModes((prev) =>
                              prev[post.id] ? prev : { ...prev, [post.id]: 'edit' }
                            );
                            void handleUpdateTikTokPost(post.id, { tiktokUrl: nextUrl });
                          }}
                          onPaste={(e) => {
                            const pasted = normalizeTikTokUrl(
                              e.clipboardData.getData('text')
                            );
                            if (isTikTokVideoUrl(pasted)) {
                              e.preventDefault();
                              setTiktokPostModes((prev) =>
                                prev[post.id] ? prev : { ...prev, [post.id]: 'edit' }
                              );
                              void handleUpdateTikTokPost(
                                post.id,
                                { tiktokUrl: pasted },
                                true
                              );
                              void handleFetchTikTokPostMetadata(post, pasted);
                            }
                          }}
                          onBlur={() => {
                            const normalized = normalizeTikTokUrl(post.tiktokUrl);
                            if (normalized !== post.tiktokUrl && normalized) {
                              void handleUpdateTikTokPost(
                                post.id,
                                { tiktokUrl: normalized },
                                true
                              );
                            }
                            if (
                              isTikTokVideoUrl(normalized) &&
                              lastFetchedUrls[post.id] !== normalized &&
                              (!post.title.trim() ||
                                post.title === DEFAULT_TIKTOK_TITLE ||
                                isPlaceholderTikTokCover(post.coverImageUrl))
                            ) {
                              void handleFetchTikTokPostMetadata(post, normalized);
                            }
                          }}
                          placeholder="https://vt.tiktok.com/... or https://www.tiktok.com/@.../video/..."
                          className="flex-1 min-w-0 h-9 px-2.5 bg-[#1c1c21] border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-[#D92027]"
                        />
                        <button
                          type="button"
                          disabled={fetchStatus?.loading || !canFetchVideo}
                          onClick={() => handleFetchTikTokPostMetadata(post, undefined, true)}
                          aria-label={`Fetch title and cover from TikTok video ${idx + 1}`}
                          title="Fetch description title & cover image from TikTok video"
                          className="inline-flex items-center gap-1 h-9 px-2.5 bg-[#1c1c21] border border-zinc-700 hover:border-white disabled:opacity-45 text-xs font-medium text-zinc-200 hover:text-white rounded-lg cursor-pointer shrink-0 transition-colors"
                        >
                          {fetchStatus?.loading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span>Fetch</span>
                        </button>
                      </div>
                      {post.tiktokUrl.trim() && !canFetchVideo && (
                        <p className="mt-1 text-[11px] text-amber-400">
                          Paste a direct TikTok video link (e.g. vt.tiktok.com/... or tiktok.com/@.../video/...) so it appears on the visitors dashboard.
                        </p>
                      )}
                      {fetchStatus?.error && (
                        <p className="mt-1 text-[11px] text-[#D92027]">{fetchStatus.error}</p>
                      )}
                      {!fetchStatus?.error && fetchStatus?.note && (
                        <p className="mt-1 text-[11px] text-emerald-400">{fetchStatus.note}</p>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label
                          htmlFor={`tt-title-${post.id}`}
                          className="block text-xs font-medium text-zinc-300"
                        >
                          Video Post Title
                        </label>
                        {post.caption.trim() && (
                          <button
                            type="button"
                            onClick={() => {
                              const derived = deriveTitleFromVideoDescription(post.caption);
                              if (derived) {
                                void handleUpdateTikTokPost(post.id, { title: derived }, true);
                              }
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-white cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3 text-[#D92027]" aria-hidden="true" />
                            <span>From Description</span>
                          </button>
                        )}
                      </div>
                      <input
                        id={`tt-title-${post.id}`}
                        type="text"
                        value={post.title}
                        onChange={(e) =>
                          void handleUpdateTikTokPost(post.id, { title: e.target.value })
                        }
                        className="w-full h-9 px-2.5 bg-[#1c1c21] border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-[#D92027]"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`tt-caption-${post.id}`}
                        className="block text-xs font-medium text-zinc-300 mb-1"
                      >
                        Video Description / Caption
                      </label>
                      <textarea
                        id={`tt-caption-${post.id}`}
                        rows={2}
                        value={post.caption}
                        onChange={(e) => {
                          const nextCaption = e.target.value;
                          const shouldAutoTitle =
                            !post.title.trim() || post.title === DEFAULT_TIKTOK_TITLE;
                          const derived = shouldAutoTitle
                            ? deriveTitleFromVideoDescription(nextCaption)
                            : '';
                          void handleUpdateTikTokPost(post.id, {
                            caption: nextCaption,
                            ...(derived ? { title: derived } : {}),
                          });
                        }}
                        className="w-full p-2.5 bg-[#1c1c21] border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-[#D92027]"
                      />
                    </div>

                    <div className="pt-2 border-t border-zinc-800 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={publishingPostId === post.id}
                        onClick={() => void handlePublishTikTokPost(post)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-[#D92027] hover:bg-[#B91C1C] disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                      >
                        {publishingPostId === post.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Send className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>
                          {publishingPostId === post.id
                            ? 'Publishing...'
                            : 'Publish to Visitors Dashboard'}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {showTikTokShowcaseFeatures && (
              <div
                data-testid="tiktok-showcase-settings-panel"
                className="bg-[#141418] border border-zinc-800 rounded-xl p-5 sm:p-6 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-white">
                      TikTok Showcase Settings
                    </h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Only posts with an inserted TikTok video link are shown on the website. Paste a link to pull its title &amp; cover from the video.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {store.tiktok.posts.some((p) => !isTikTokVideoUrl(p.tiktokUrl)) && (
                      <button
                        type="button"
                        onClick={() =>
                          void onUpdateStore(
                            (prev) => ({
                              ...prev,
                              tiktok: {
                                ...prev.tiktok,
                                posts: prev.tiktok.posts.filter((p) =>
                                  isTikTokVideoUrl(p.tiktokUrl)
                                ),
                              },
                            }),
                            true
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-zinc-700 hover:border-red-500 bg-[#1c1c21] text-zinc-300 hover:text-[#D92027] text-xs font-medium rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Remove Unlinked</span>
                      </button>
                    )}
                    {store.tiktok.posts.some((p) => isTikTokVideoUrl(p.tiktokUrl)) && (
                      <button
                        type="button"
                        disabled={syncingAllTikTok}
                        onClick={handleSyncAllTikTok}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-zinc-700 hover:border-white bg-[#1c1c21] text-zinc-200 hover:text-white text-xs font-medium rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        {syncingAllTikTok ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>{syncingAllTikTok ? 'Syncing Videos...' : 'Sync All Videos'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setTiktokPostModes({});
                        setSelectedPublishedPostId(null);
                        setShowTikTokShowcaseFeatures(false);
                        void handlePublishSection('TikTok walkaround videos', 'tiktok-showcase');
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-zinc-700 hover:border-white bg-[#1c1c21] text-zinc-200 hover:text-white text-xs font-medium rounded-lg cursor-pointer shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Publish All to Dashboard</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTikTokShowcaseFeatures(false)}
                      aria-label="Hide TikTok Showcase Settings"
                      className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Hide</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="tt-handle" className="block text-xs font-medium text-zinc-300 mb-1">
                      TikTok Handle
                    </label>
                    <input
                      id="tt-handle"
                      type="text"
                      value={store.tiktok.handle}
                      onChange={(e) => {
                        const val = e.target.value;
                        void onUpdateStore((prev) => ({
                          ...prev,
                          tiktok: { ...prev.tiktok, handle: val },
                        }));
                      }}
                      className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                    />
                  </div>
                  <div>
                    <label htmlFor="tt-profile-url" className="block text-xs font-medium text-zinc-300 mb-1">
                      TikTok Profile URL
                    </label>
                    <input
                      id="tt-profile-url"
                      type="url"
                      value={store.tiktok.profileUrl}
                      onChange={(e) => {
                        const val = e.target.value;
                        void onUpdateStore((prev) => ({
                          ...prev,
                          tiktok: { ...prev.tiktok, profileUrl: val },
                        }));
                      }}
                      className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="tt-section-title" className="block text-xs font-medium text-zinc-300 mb-1">
                      Section Title
                    </label>
                    <input
                      id="tt-section-title"
                      type="text"
                      value={store.tiktok.title}
                      onChange={(e) => {
                        const val = e.target.value;
                        void onUpdateStore((prev) => ({
                          ...prev,
                          tiktok: { ...prev.tiktok, title: val },
                        }));
                      }}
                      className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="tt-section-desc" className="block text-xs font-medium text-zinc-300 mb-1">
                      Section Write-up
                    </label>
                    <textarea
                      id="tt-section-desc"
                      rows={2}
                      value={store.tiktok.description}
                      onChange={(e) => {
                        const val = e.target.value;
                        void onUpdateStore((prev) => ({
                          ...prev,
                          tiktok: { ...prev.tiktok, description: val },
                        }));
                      }}
                      className="w-full p-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* TAB 3: LOCATION & CONTACT */}
        {activeTab === 'contact' && (
          <section className="max-w-4xl">
            <div className="bg-[#111115] border border-white/[0.08] rounded-2xl p-6 sm:p-8 space-y-5">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">
                  Showroom Location &amp; Contact Details
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  All changes update the public Location &amp; Contact section and Footer immediately.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="loc-address" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Street Address / Showroom
                  </label>
                  <input
                    id="loc-address"
                    type="text"
                    value={store.contact.addressLine}
                    onChange={(e) => {
                      const val = e.target.value;
                      void onUpdateStore((prev) => ({
                        ...prev,
                        contact: { ...prev.contact, addressLine: val },
                      }));
                    }}
                    className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-city" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    City &amp; Country
                  </label>
                  <input
                    id="loc-city"
                    type="text"
                    value={store.contact.cityCountry}
                    onChange={(e) => {
                      const val = e.target.value;
                      void onUpdateStore((prev) => ({
                        ...prev,
                        contact: { ...prev.contact, cityCountry: val },
                      }));
                    }}
                    className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-hours" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Opening Hours
                  </label>
                  <input
                    id="loc-hours"
                    type="text"
                    value={store.contact.hours}
                    onChange={(e) => {
                      const val = e.target.value;
                      void onUpdateStore((prev) => ({
                        ...prev,
                        contact: { ...prev.contact, hours: val },
                      }));
                    }}
                    className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="loc-landmark" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Landmark / Directions Note
                  </label>
                  <input
                    id="loc-landmark"
                    type="text"
                    value={store.contact.landmarkNote}
                    onChange={(e) => {
                      const val = e.target.value;
                      void onUpdateStore((prev) => ({
                        ...prev,
                        contact: { ...prev.contact, landmarkNote: val },
                      }));
                    }}
                    className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-phone" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Phone Number
                  </label>
                  <input
                    id="loc-phone"
                    type="text"
                    value={store.contact.phone}
                    onChange={(e) => {
                      const val = e.target.value;
                      void onUpdateStore((prev) => ({
                        ...prev,
                        contact: { ...prev.contact, phone: val },
                      }));
                    }}
                    className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-whatsapp" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    WhatsApp Number or Link
                  </label>
                  <input
                    id="loc-whatsapp"
                    type="text"
                    value={store.contact.whatsapp}
                    onChange={(e) => {
                      const val = e.target.value;
                      void onUpdateStore((prev) => ({
                        ...prev,
                        contact: { ...prev.contact, whatsapp: val },
                      }));
                    }}
                    placeholder="+251 91 100 4580 or https://wa.me/..."
                    className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Email Address
                  </label>
                  <input
                    id="loc-email"
                    type="email"
                    value={store.contact.email}
                    onChange={(e) => {
                      const val = e.target.value;
                      void onUpdateStore((prev) => ({
                        ...prev,
                        contact: { ...prev.contact, email: val },
                      }));
                    }}
                    className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-maps" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Google Maps Link
                  </label>
                  <input
                    id="loc-maps"
                    type="url"
                    value={store.contact.mapsUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      void onUpdateStore((prev) => ({
                        ...prev,
                        contact: { ...prev.contact, mapsUrl: val },
                      }));
                    }}
                    className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                  />
                </div>

                {/* Social Media Accounts */}
                <div className="sm:col-span-2 pt-4 border-t border-white/[0.08] space-y-3">
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-200">
                      Social Media Accounts (Username or Link)
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Enter a username (like @alifcarimport) or full profile URL. Icons appear on the visitors dashboard for every added account.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="loc-telegram" className="block text-xs font-medium text-zinc-300 mb-1.5">
                        Telegram Username or Link
                      </label>
                      <input
                        id="loc-telegram"
                        type="text"
                        value={store.contact.telegram ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          void onUpdateStore((prev) => ({
                            ...prev,
                            contact: { ...prev.contact, telegram: val },
                          }));
                        }}
                        placeholder="@alifcarimport or https://t.me/alifcarimport"
                        className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                      />
                    </div>

                    <div>
                      <label htmlFor="loc-instagram" className="block text-xs font-medium text-zinc-300 mb-1.5">
                        Instagram Username or Link
                      </label>
                      <input
                        id="loc-instagram"
                        type="text"
                        value={store.contact.instagram ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          void onUpdateStore((prev) => ({
                            ...prev,
                            contact: { ...prev.contact, instagram: val },
                          }));
                        }}
                        placeholder="@alifcarimport or https://instagram.com/..."
                        className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                      />
                    </div>

                    <div>
                      <label htmlFor="loc-facebook" className="block text-xs font-medium text-zinc-300 mb-1.5">
                        Facebook Username or Link
                      </label>
                      <input
                        id="loc-facebook"
                        type="text"
                        value={store.contact.facebook ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          void onUpdateStore((prev) => ({
                            ...prev,
                            contact: { ...prev.contact, facebook: val },
                          }));
                        }}
                        placeholder="AlifCarImport or https://facebook.com/..."
                        className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                      />
                    </div>

                    <div>
                      <label htmlFor="loc-x" className="block text-xs font-medium text-zinc-300 mb-1.5">
                        X (Twitter) Username or Link
                      </label>
                      <input
                        id="loc-x"
                        type="text"
                        value={store.contact.x ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          void onUpdateStore((prev) => ({
                            ...prev,
                            contact: { ...prev.contact, x: val },
                          }));
                        }}
                        placeholder="@alifcarimport or https://x.com/..."
                        className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                      />
                    </div>
                  </div>

                  {(() => {
                    const previewLinks = getConfiguredSocialLinks(
                      store.contact,
                      store.tiktok,
                      store.branding.companyName
                    );
                    if (previewLinks.length === 0) return null;
                    return (
                      <div className="p-3.5 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-2">
                        <p className="text-[11px] font-medium text-zinc-400">
                          Visitor Icons Preview ({previewLinks.length})
                        </p>
                        <SocialMediaIconRow
                          links={previewLinks}
                          companyName={store.branding.companyName}
                          showLabels
                        />
                      </div>
                    );
                  })()}
                </div>

                <div className="sm:col-span-2 pt-3 border-t border-white/[0.08]">
                  <label htmlFor="admin-emails-list" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Authorized Admin Emails (comma-separated)
                  </label>
                  <input
                    id="admin-emails-list"
                    type="text"
                    value={(store.adminEmails ?? []).join(', ')}
                    onChange={(e) => {
                      const emails = e.target.value
                        .split(',')
                        .map((part) => part.trim().toLowerCase())
                        .filter(Boolean);
                      void onUpdateStore((prev) => ({
                        ...prev,
                        adminEmails: emails,
                      }));
                    }}
                    placeholder="alifcarimports@gmail.com"
                    className="w-full h-10 px-3 bg-[#09090c] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-[#E11D2A]"
                  />
                </div>

                <div className="sm:col-span-2 pt-3 border-t border-white/[0.08] flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      void handlePublishSection('Location & contact details', 'location-contact')
                    }
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-[#E11D2A] hover:bg-[#C81722] text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Publish Location &amp; Contact</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

          {/* TAB 4: SECURITY, 2FA, ACTIVE DEVICES & LOGIN ALERTS */}
          {activeTab === 'security' && (
            <AdminSecurityTab
              alerts={loginAlerts}
              onAlertsUpdated={refreshLoginAlerts}
              onForceSignOutSelf={() => onSignOut?.()}
            />
          )}

          {/* TAB 5: VISITORS & INTERACTIONS */}
          {activeTab === 'visitors' && <AdminVisitorsTab />}
        </main>
      </div>

      <VehicleFormModal
        isOpen={formOpen}
        initialVehicle={editingVehicle}
        onClose={() => {
          setFormOpen(false);
          setEditingVehicle(null);
        }}
        onSave={handleSaveVehicle}
      />
    </div>
  );
}
