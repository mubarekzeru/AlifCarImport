import { useEffect, useState, type ChangeEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  ExternalLink,
  Film,
  Link2,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PRESET_VEHICLE_PHOTOS } from '../data/seedData';
import type {
  CustomerInquiry,
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
  formatPrice,
  getConfiguredSocialLinks,
  isTikTokVideoUrl,
  normalizeTikTokUrl,
  resolveTikTokAdminCardMode,
} from '../utils/inventory';
import {
  fetchCustomerInquiries,
  fetchTikTokVideoMetadata,
} from '../utils/storeClient';
import { SocialMediaIconRow } from './SocialIcons';
import { VehicleFormModal } from './VehicleFormModal';

const DEFAULT_TIKTOK_TITLE = 'New Imported Arrival Walkaround';
const DEFAULT_TIKTOK_CAPTION = 'Full interior and exterior showcase on our showroom floor.';

interface AdminDashboardProps {
  store: ShowroomStore;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  saveError?: string | null;
  onUpdateStore: (
    nextStore: ShowroomStore | ((prev: ShowroomStore) => ShowroomStore),
    immediate?: boolean
  ) => Promise<boolean>;
  onResetDefaults?: () => void;
  onPublishAndView: (sectionId?: string) => Promise<void>;
}

type AdminTab = 'inventory' | 'posts' | 'tiktok' | 'contact';

export function AdminDashboard({
  store,
  saveState,
  saveError,
  onUpdateStore,
  onPublishAndView,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | 'all'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [inquiries, setInquiries] = useState<CustomerInquiry[]>([]);
  const [tiktokFetchStatus, setTiktokFetchStatus] = useState<
    Record<string, { loading: boolean; error?: string; note?: string }>
  >({});
  const [tiktokCoverOptions, setTiktokCoverOptions] = useState<
    Record<string, { label: string; url: string }[]>
  >({});
  const [syncingAllTikTok, setSyncingAllTikTok] = useState(false);
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);
  const [lastFetchedUrls, setLastFetchedUrls] = useState<Record<string, string>>({});
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

  useEffect(() => {
    if (activeTab === 'contact') {
      fetchCustomerInquiries().then(setInquiries);
    }
  }, [activeTab]);

  const filteredInventory = filterVehicles(store.vehicles, {
    query: searchQuery,
    make: '',
    model: '',
    year: '',
    status: statusFilter,
  });

  const availableCount = store.vehicles.filter((v) => v.status === 'available').length;
  const reservedCount = store.vehicles.filter((v) => v.status === 'reserved').length;
  const soldCount = store.vehicles.filter((v) => v.status === 'sold').length;

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
    void onUpdateStore(
      (prev) => ({
        ...prev,
        vehicles: prev.vehicles.filter((v) => v.id !== id),
      }),
      true
    );
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
      coverImageUrl: PRESET_VEHICLE_PHOTOS[0].url,
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

    setTiktokFetchStatus((prev) => ({
      ...prev,
      [post.id]: { loading: true },
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

      setLastFetchedUrls((prev) => ({
        ...prev,
        [post.id]: nextResolvedUrl,
      }));

      await onUpdateStore((prev) => ({
        ...prev,
        tiktok: {
          ...prev.tiktok,
          posts: prev.tiktok.posts.map((current) => {
            if (current.id !== post.id) return current;
            const hasCustomCaption =
              Boolean(current.caption.trim()) && current.caption !== DEFAULT_TIKTOK_CAPTION;
            const nextDescription =
              hasCustomCaption && !forceOverwrite
                ? current.caption
                : meta.description || current.caption;
            const derivedTitle =
              meta.suggestedTitle ||
              (meta.description ? deriveTitleFromVideoDescription(meta.description) : '');
            const hasCustomTitle =
              Boolean(current.title.trim()) && current.title !== DEFAULT_TIKTOK_TITLE;
            const nextTitle =
              hasCustomTitle && !forceOverwrite
                ? current.title
                : derivedTitle || current.title;
            const hasCustomCover =
              Boolean(current.coverImageUrl) &&
              !current.coverImageUrl.startsWith('/src/assets/images/') &&
              !current.coverImageUrl.includes('/assets/aistudio/');
            const nextCover =
              hasCustomCover && !forceOverwrite
                ? current.coverImageUrl
                : meta.coverImageUrl || meta.coverOptions[0]?.url || current.coverImageUrl;

            return {
              ...current,
              tiktokUrl: nextResolvedUrl,
              caption: nextDescription,
              title: nextTitle,
              coverImageUrl: nextCover,
            };
          }),
        },
      }), true);

      setTiktokFetchStatus((prev) => ({
        ...prev,
        [post.id]: {
          loading: false,
          note:
            meta.coverOptions.length > 1
              ? `Fetched description title & ${meta.coverOptions.length} video cover options`
              : 'Fetched title & cover from video',
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

    const needsMetadata =
      !post.title.trim() ||
      post.title === DEFAULT_TIKTOK_TITLE ||
      !post.coverImageUrl ||
      post.coverImageUrl.startsWith('/src/assets/images/');

    if (needsMetadata && lastFetchedUrls[post.id] !== normalized) {
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
            current.title.trim() && current.title !== DEFAULT_TIKTOK_TITLE
              ? current.title.trim()
              : fetchedTitle || current.title || 'TikTok Walkaround Video';
          const keepCaption =
            current.caption.trim() && current.caption !== DEFAULT_TIKTOK_CAPTION
              ? current.caption.trim()
              : fetchedDesc || current.caption;
          const keepCover =
            current.coverImageUrl && !current.coverImageUrl.startsWith('/src/assets/images/')
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

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#0a0a0c] pt-16 pb-8 sm:pt-16 sm:pb-10 xl:py-10 text-zinc-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        {(uploadNotice || (saveState === 'error' && saveError)) && (
          <div
            role={uploadNotice?.type === 'error' || saveState === 'error' ? 'alert' : 'status'}
            className={`px-4 py-2.5 rounded-xl border text-xs font-medium flex flex-wrap items-center justify-between gap-3 ${
              uploadNotice?.type === 'error' || saveState === 'error'
                ? 'bg-[#201113] border-red-900 text-red-300'
                : 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
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
                onClick={() => setUploadNotice(null)}
                className="text-xs underline opacity-80 hover:opacity-100 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-[#141418] border border-zinc-800 rounded-xl p-4">
            <span className="block text-xs text-zinc-400">Total Inventory</span>
            <span className="mt-1 block font-mono text-2xl font-semibold text-white tabular-nums">
              {store.vehicles.length}
            </span>
          </div>
          <div className="bg-[#141418] border border-zinc-800 rounded-xl p-4">
            <span className="block text-xs text-zinc-400">Available</span>
            <span className="mt-1 block font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
              {availableCount}
            </span>
          </div>
          <div className="bg-[#141418] border border-zinc-800 rounded-xl p-4">
            <span className="block text-xs text-zinc-400">Reserved</span>
            <span className="mt-1 block font-mono text-2xl font-semibold text-amber-400 tabular-nums">
              {reservedCount}
            </span>
          </div>
          <div className="bg-[#141418] border border-zinc-800 rounded-xl p-4">
            <span className="block text-xs text-zinc-400">Sold</span>
            <span className="mt-1 block font-mono text-2xl font-semibold text-zinc-400 tabular-nums">
              {soldCount}
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Admin sections"
          className="flex flex-wrap items-center gap-1 p-1 bg-[#141418] border border-zinc-800 rounded-xl w-fit"
        >
          {(
            [
              { id: 'inventory', label: 'Inventory Manager' },
              { id: 'posts', label: 'Photo, Post Title & Write-up' },
              { id: 'tiktok', label: 'TikTok Video Links' },
              { id: 'contact', label: 'Location & Contact' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[#D92027] text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB 1: INVENTORY MANAGER */}
        {activeTab === 'inventory' && (
          <section className="bg-[#141418] border border-zinc-800 rounded-xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 flex-1">
                <div className="relative w-full sm:w-72">
                  <Search
                    className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter inventory..."
                    aria-label="Filter admin inventory"
                    className="w-full h-10 pl-9 pr-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-[#1c1c21] border border-zinc-800 rounded-lg">
                  {(['all', 'available', 'reserved', 'sold'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize cursor-pointer transition-colors ${
                        statusFilter === st
                          ? 'bg-[#D92027] text-white shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditingVehicle(null);
                  setFormOpen(true);
                }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#D92027] hover:bg-[#B91C1C] text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Add Vehicle</span>
              </button>
            </div>

            {filteredInventory.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <p className="text-sm text-zinc-400">No vehicles match this filter.</p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingVehicle(null);
                    setFormOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#D92027] text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add First Vehicle
                </button>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {filteredInventory.map((vehicle) => (
                  <div
                    key={vehicle.id}
                    className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#19191f] transition-colors"
                  >
                    <div className="flex items-start sm:items-center gap-4 min-w-0">
                      <img
                        src={vehicle.imageUrl}
                        alt={vehicle.title}
                        referrerPolicy="no-referrer"
                        className="w-24 h-18 rounded-lg object-cover border border-zinc-800 bg-zinc-900 shrink-0"
                      />
                      <div className="min-w-0 space-y-1">
                        <h3 className="font-display text-base font-semibold text-white truncate">
                          {vehicle.title}
                        </h3>
                        <p className="text-xs text-zinc-400 tabular-nums">
                          {vehicle.make} · {vehicle.model} · {vehicle.year} · {vehicle.mileage}
                        </p>
                        <p className="text-xs text-zinc-400 line-clamp-1 max-w-xl">
                          {vehicle.description}
                        </p>
                      </div>
                    </div>

                    {/* Quick inline controls */}
                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      <label className="inline-flex items-center gap-1.5 h-9 px-3 border border-zinc-700 hover:border-white bg-[#1c1c21] text-zinc-200 text-xs font-medium rounded-lg cursor-pointer transition-colors">
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
                        onClick={() => handleQuickToggleFeatured(vehicle.id)}
                        aria-pressed={vehicle.featured}
                        aria-label={`${vehicle.featured ? 'Unfeature' : 'Feature'} ${vehicle.title}`}
                        className={`inline-flex items-center gap-1 h-9 px-3 border text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                          vehicle.featured
                            ? 'border-amber-500/60 bg-amber-500/10 text-amber-300 hover:border-amber-400'
                            : 'border-zinc-700 bg-[#1c1c21] text-zinc-400 hover:border-white hover:text-white'
                        }`}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${vehicle.featured ? 'fill-amber-400 text-amber-400' : ''}`}
                          aria-hidden="true"
                        />
                        <span>{vehicle.featured ? 'Featured' : 'Feature'}</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        <label
                          htmlFor={`quick-price-${vehicle.id}`}
                          className="text-xs text-zinc-400"
                        >
                          $
                        </label>
                        <input
                          id={`quick-price-${vehicle.id}`}
                          type="number"
                          aria-label={`Quick price for ${vehicle.title}`}
                          value={vehicle.price}
                          onChange={(e) => handleQuickPriceChange(vehicle.id, e.target.value)}
                          className="w-28 h-9 px-2.5 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm font-mono font-medium text-white tabular-nums focus:outline-none focus:border-[#D92027]"
                        />
                      </div>

                      <select
                        aria-label={`Availability status for ${vehicle.title}`}
                        value={vehicle.status}
                        onChange={(e) =>
                          handleQuickStatusChange(vehicle.id, e.target.value as VehicleStatus)
                        }
                        className="h-9 px-2.5 bg-[#1c1c21] border border-zinc-700 rounded-lg text-xs font-medium text-zinc-200 cursor-pointer focus:outline-none focus:border-[#D92027]"
                      >
                        <option value="available">Available</option>
                        <option value="reserved">Reserved</option>
                        <option value="sold">Sold</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingVehicle(vehicle);
                          setFormOpen(true);
                        }}
                        aria-label={`Edit ${vehicle.title}`}
                        className="inline-flex items-center gap-1.5 h-9 px-3 border border-zinc-700 hover:border-white bg-[#1c1c21] text-zinc-200 text-xs font-medium rounded-lg cursor-pointer transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDuplicateVehicle(vehicle)}
                        aria-label={`Duplicate ${vehicle.title}`}
                        title="Duplicate listing"
                        className="inline-flex items-center justify-center w-9 h-9 border border-zinc-700 hover:border-white bg-[#1c1c21] text-zinc-300 rounded-lg cursor-pointer transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>

                      {confirmDeleteId === vehicle.id ? (
                        <div className="flex items-center gap-1.5 bg-[#201113] px-2.5 py-1.5 rounded-lg border border-red-900">
                          <button
                            type="button"
                            onClick={() => handleDeleteVehicle(vehicle.id)}
                            className="text-xs font-semibold text-[#D92027] hover:underline cursor-pointer"
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
                          className="inline-flex items-center justify-center w-9 h-9 border border-zinc-700 hover:border-red-500 hover:text-[#D92027] bg-[#1c1c21] text-zinc-400 rounded-lg cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: PHOTO, POST TITLE & WRITE-UP */}
        {activeTab === 'posts' && (
          <section>
            {/* Featured Vehicles Spotlight Photo & Link Quick Editor */}
            <div className="bg-[#141418] border border-zinc-800 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-white">
                    Featured Vehicles &amp; Photos
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Update photos, titles, or TikTok links on featured spotlight vehicles.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('inventory')}
                  className="text-xs font-medium text-[#D92027] hover:underline cursor-pointer shrink-0"
                >
                  All Inventory
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(store.vehicles.filter((v) => v.featured).length > 0
                  ? store.vehicles.filter((v) => v.featured)
                  : store.vehicles.slice(0, 2)
                ).map((vehicle) => (
                  <div
                    key={vehicle.id}
                    className="p-3 rounded-lg border border-zinc-800 bg-[#1c1c21] flex items-center gap-3"
                  >
                    <img
                      src={vehicle.imageUrl}
                      alt={vehicle.title}
                      referrerPolicy="no-referrer"
                      className="w-16 h-12 rounded-md object-cover border border-zinc-700 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate">
                        {vehicle.title}
                      </p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {vehicle.featured ? 'Featured Spotlight' : 'Spotlight Fallback'} · {formatPrice(vehicle.price)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <label className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#D92027] hover:bg-[#B91C1C] text-white text-[11px] font-medium rounded-md cursor-pointer">
                        <Upload className="w-3 h-3" aria-hidden="true" />
                        <span>Upload</span>
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
                        className="px-2.5 py-1.5 border border-zinc-700 hover:border-white text-[11px] font-medium text-zinc-200 hover:text-white rounded-md cursor-pointer"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* TAB 3: TIKTOK VIDEO LINKS */}
        {activeTab === 'tiktok' && (
          <section className="space-y-5">
            <div className="flex items-center justify-start">
              <button
                type="button"
                onClick={handleAddTikTokPost}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-semibold rounded-lg cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Add TikTok Video</span>
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
                                void handleFetchTikTokPostMetadata(post, pasted);
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
                      <div className="w-20 sm:w-24 aspect-[9/14] shrink-0 rounded-lg overflow-hidden bg-zinc-950 border border-zinc-800">
                        <img
                          src={post.coverImageUrl}
                          alt={post.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
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

                        <select
                          aria-label={`Pick preset cover for TikTok post ${idx + 1}`}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              void handleUpdateTikTokPost(
                                post.id,
                                { coverImageUrl: e.target.value },
                                true
                              );
                            }
                          }}
                          className="h-7 px-2 bg-[#1c1c21] border border-zinc-700 rounded-lg text-[11px] text-zinc-200 cursor-pointer"
                        >
                          <option value="">Preset cover...</option>
                          {PRESET_VEHICLE_PHOTOS.map((preset) => (
                            <option key={preset.label} value={preset.url}>
                              {preset.label}
                            </option>
                          ))}
                        </select>

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

                    <div>
                      <label
                        htmlFor={`tt-cover-url-${post.id}`}
                        className="block text-[11px] font-medium text-zinc-400 mb-1"
                      >
                        Cover Image URL
                      </label>
                      <input
                        id={`tt-cover-url-${post.id}`}
                        type="text"
                        value={post.coverImageUrl}
                        onChange={(e) =>
                          void handleUpdateTikTokPost(post.id, { coverImageUrl: e.target.value })
                        }
                        placeholder="https://... or uploaded image"
                        className="w-full h-8 px-2.5 bg-[#1c1c21] border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-[#D92027]"
                      />
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
                                post.coverImageUrl.includes('/assets/aistudio/') ||
                                post.coverImageUrl.startsWith('/src/assets/images/'))
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

        {/* TAB 4: LOCATION & CONTACT */}
        {activeTab === 'contact' && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-[#141418] border border-zinc-800 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">
                  Showroom Location & Contact Details
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  All changes update the public Location & Contact section and Footer immediately.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="loc-address" className="block text-xs font-medium text-zinc-300 mb-1">
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
                    className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-city" className="block text-xs font-medium text-zinc-300 mb-1">
                    City & Country
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
                    className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-hours" className="block text-xs font-medium text-zinc-300 mb-1">
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
                    className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="loc-landmark" className="block text-xs font-medium text-zinc-300 mb-1">
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
                    className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-phone" className="block text-xs font-medium text-zinc-300 mb-1">
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
                    className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-whatsapp" className="block text-xs font-medium text-zinc-300 mb-1">
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
                    className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-email" className="block text-xs font-medium text-zinc-300 mb-1">
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
                    className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                <div>
                  <label htmlFor="loc-maps" className="block text-xs font-medium text-zinc-300 mb-1">
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
                    className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                {/* Social Media Accounts */}
                <div className="sm:col-span-2 pt-3 border-t border-zinc-800 space-y-3">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      Social Media Accounts (Username or Link)
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Enter a username (like @alifcarimport) or full profile URL. Icons appear on the visitors dashboard for every added account.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="loc-telegram" className="block text-xs font-medium text-zinc-300 mb-1">
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
                        className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                      />
                    </div>

                    <div>
                      <label htmlFor="loc-instagram" className="block text-xs font-medium text-zinc-300 mb-1">
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
                        className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                      />
                    </div>

                    <div>
                      <label htmlFor="loc-facebook" className="block text-xs font-medium text-zinc-300 mb-1">
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
                        className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                      />
                    </div>

                    <div>
                      <label htmlFor="loc-x" className="block text-xs font-medium text-zinc-300 mb-1">
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
                        className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
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
                      <div className="p-3.5 rounded-lg bg-[#1c1c21] border border-zinc-800 space-y-2">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
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

                <div className="sm:col-span-2 pt-2 border-t border-zinc-800">
                  <label htmlFor="admin-emails-list" className="block text-xs font-medium text-zinc-300 mb-1">
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
                    placeholder="mubyzeru@gmail.com, admin@alifcarimport.com"
                    className="w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#D92027]"
                  />
                </div>

                <div className="sm:col-span-2 pt-2 border-t border-zinc-800 flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      void handlePublishSection('Location & contact details', 'location-contact')
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Publish Location &amp; Contact</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Customer Inquiries Panel */}
            <div className="lg:col-span-5 bg-[#141418] border border-zinc-800 rounded-xl p-6 space-y-4 h-fit">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">
                  Recent Customer Inquiries
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Messages submitted from your storefront contact form.
                </p>
              </div>

              {inquiries.length === 0 ? (
                <p className="text-sm text-zinc-400 py-4 border-t border-zinc-800">
                  No customer inquiries submitted yet.
                </p>
              ) : (
                <div className="divide-y divide-zinc-800 border-t border-zinc-800 max-h-[420px] overflow-y-auto">
                  {inquiries.map((inq) => (
                    <div key={inq.id} className="py-3.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-white">{inq.name}</span>
                        <span className="text-xs font-mono text-zinc-400 tabular-nums">
                          {inq.phone}
                        </span>
                      </div>
                      {inq.vehicleTitle && (
                        <p className="text-xs font-medium text-[#D92027]">
                          Vehicle: {inq.vehicleTitle}
                        </p>
                      )}
                      {inq.message && (
                        <p className="text-xs text-zinc-300 leading-relaxed">{inq.message}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
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
    </main>
  );
}
