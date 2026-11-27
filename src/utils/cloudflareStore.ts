import { signOut, type Auth, type User } from 'firebase/auth';
import { INITIAL_SHOWROOM_STORE } from '../data/seedData';
import { auth } from '../firebase';
import type {
  CustomerInquiry,
  ShowroomStore,
  TikTokPost,
  Vehicle,
} from '../types/showroom';
import type { ShowroomSyncMeta } from './firestoreStore';
import {
  computeTikTokSortOrder,
  filterSyncableTikTokPosts,
  mergeShowroomSnapshotState,
  type RemoteShowroomConfigData,
  type RemoteTikTokPostEntry,
} from './firestoreSyncLogic';
import { DEFAULT_ADMIN_EMAILS, resolvePublicAssetUrl } from './inventory';

const CLOUDFLARE_REFRESH_EVENT = 'alif:cloudflare-refresh';

export interface CloudflareShowroomResponse {
  hasConfig?: boolean;
  branding?: RemoteShowroomConfigData['branding'] | null;
  hero?: RemoteShowroomConfigData['hero'] | null;
  tiktokHeader?: RemoteShowroomConfigData['tiktok'] | null;
  contact?: RemoteShowroomConfigData['contact'] | null;
  vehicles?: Vehicle[];
  tiktokPosts?: RemoteTikTokPostEntry[];
  updatedAtMs?: number;
}

export function normalizeCloudflareApiUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) return '';
  if (
    trimmed.includes('REPLACE_WITH') ||
    trimmed.includes('MY_CLOUDFLARE') ||
    trimmed.includes('<your-subdomain>')
  ) {
    return '';
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export const DEFAULT_CLOUDFLARE_API_URL =
  'https://alif-car-import-api.alifcarimports.workers.dev';

export function getCloudflareApiBaseUrl(): string {
  const envVal =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env.VITE_CLOUDFLARE_API_URL as string | undefined)
      : undefined;
  const trimmed = typeof envVal === 'string' ? envVal.trim() : '';
  if (
    trimmed.toLowerCase() === 'disabled' ||
    trimmed.toLowerCase() === 'false' ||
    trimmed.toLowerCase() === 'off'
  ) {
    return '';
  }
  return normalizeCloudflareApiUrl(trimmed || DEFAULT_CLOUDFLARE_API_URL);
}

export function isCloudflareBackendEnabled(): boolean {
  return Boolean(getCloudflareApiBaseUrl());
}

export function buildCloudflareEndpoint(path: string, baseUrlOverride?: string): string {
  const base = normalizeCloudflareApiUrl(baseUrlOverride ?? getCloudflareApiBaseUrl());
  if (!base) {
    throw new Error('Cloudflare API URL (VITE_CLOUDFLARE_API_URL) is not configured.');
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export function mapRemoteShowroomResponse(
  raw: CloudflareShowroomResponse,
  fallbackStore: ShowroomStore
): { store: ShowroomStore; meta: ShowroomSyncMeta } {
  const remoteVehicles: Vehicle[] = Array.isArray(raw.vehicles)
    ? raw.vehicles
        .map((v) => ({
          ...v,
          imageUrl: resolvePublicAssetUrl(String(v.imageUrl ?? '')),
          galleryImages: Array.isArray(v.galleryImages)
            ? v.galleryImages
                .filter((u): u is string => typeof u === 'string')
                .map((u) => resolvePublicAssetUrl(u))
            : [],
          status: (v.status === 'reserved' || v.status === 'sold'
            ? v.status
            : 'available') as Vehicle['status'],
          featured: Boolean(v.featured),
          createdAt: String(v.createdAt ?? ''),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  const remotePosts: RemoteTikTokPostEntry[] = Array.isArray(raw.tiktokPosts)
    ? raw.tiktokPosts.map((p) => ({
        id: String(p.id ?? ''),
        title: String(p.title ?? ''),
        caption: String(p.caption ?? ''),
        tiktokUrl: String(p.tiktokUrl ?? ''),
        coverImageUrl: String(p.coverImageUrl ?? ''),
        sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : 0,
        updatedAtMillis: typeof p.updatedAtMillis === 'number' ? p.updatedAtMillis : 0,
      }))
    : [];

  const hasConfig = Boolean(raw.hasConfig);
  const configData: RemoteShowroomConfigData | null = hasConfig
    ? {
        branding: raw.branding ?? undefined,
        hero: raw.hero ?? undefined,
        tiktok: raw.tiktokHeader ?? undefined,
        contact: raw.contact ?? undefined,
      }
    : null;

  const merged = mergeShowroomSnapshotState({
    fallbackStore,
    hasConfig,
    configData,
    vehiclesLoaded: true,
    remoteVehicles,
    postsLoaded: true,
    remotePosts,
  });

  const meta: ShowroomSyncMeta = {
    hasConfig,
    vehiclesLoaded: true,
    postsLoaded: true,
    allLoaded: true,
    remoteVehicles,
  };

  const emptyRemoteFallback: ShowroomStore =
    fallbackStore.vehicles.length > 0 || INITIAL_SHOWROOM_STORE.vehicles.length === 0
      ? fallbackStore
      : {
          ...INITIAL_SHOWROOM_STORE,
          adminEmails: fallbackStore.adminEmails ?? INITIAL_SHOWROOM_STORE.adminEmails,
        };

  return {
    store: merged ?? emptyRemoteFallback,
    meta,
  };
}

async function getFirebaseAdminBearerHeaders(userOverride?: User | null): Promise<Record<string, string>> {
  const activeUser = userOverride ?? auth.currentUser;
  if (!activeUser) {
    throw new Error('Please sign in with an authorized admin account.');
  }
  const idToken = await activeUser.getIdToken();
  return {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
}

async function cloudflareFetchJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = buildCloudflareEndpoint(path);
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const msg =
      typeof data.error === 'string' && data.error.trim()
        ? data.error
        : `Cloudflare API request failed (${res.status}).`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

function notifyCloudflareShowroomChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CLOUDFLARE_REFRESH_EVENT));
  }
}

export function subscribeShowroomFromCloudflare(
  fallbackStore: ShowroomStore,
  onUpdate: (nextStore: ShowroomStore, meta: ShowroomSyncMeta) => void,
  onError?: (err: unknown) => void
): () => void {
  let disposed = false;
  let inFlight = false;
  let latestFallback = fallbackStore;

  const pullShowroom = async () => {
    if (disposed || inFlight) return;
    inFlight = true;
    try {
      const raw = await cloudflareFetchJson<CloudflareShowroomResponse>('/api/showroom', {
        method: 'GET',
        cache: 'no-cache',
      });
      if (disposed) return;
      const { store, meta } = mapRemoteShowroomResponse(raw, latestFallback);
      latestFallback = store;
      onUpdate(store, meta);
    } catch (err) {
      if (!disposed) {
        onError?.(err);
      }
    } finally {
      inFlight = false;
    }
  };

  void pullShowroom();

  const handleVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void pullShowroom();
    }
  };
  const handleOnline = () => void pullShowroom();
  const handleRefresh = () => void pullShowroom();

  const intervalId =
    typeof window !== 'undefined'
      ? window.setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') {
            void pullShowroom();
          }
        }, 45_000)
      : null;

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener(CLOUDFLARE_REFRESH_EVENT, handleRefresh);
  }

  return () => {
    disposed = true;
    if (intervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(intervalId);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(CLOUDFLARE_REFRESH_EVENT, handleRefresh);
    }
  };
}

export async function fetchAdminAllowlistFromCloudflare(
  userOverride?: User | null
): Promise<string[] | null> {
  try {
    const headers = await getFirebaseAdminBearerHeaders(userOverride);
    const res = await cloudflareFetchJson<{ adminEmails?: unknown }>('/api/admin/access', {
      method: 'GET',
      headers,
    });
    if (Array.isArray(res.adminEmails)) {
      return res.adminEmails.filter((e): e is string => typeof e === 'string' && Boolean(e.trim()));
    }
    return null;
  } catch {
    return null;
  }
}

export function subscribeAdminAccessFromCloudflare(
  onUpdate: (adminEmails: string[]) => void,
  onError?: (err: unknown) => void
): () => void {
  let disposed = false;
  void fetchAdminAllowlistFromCloudflare()
    .then((emails) => {
      if (!disposed && emails && emails.length > 0) {
        onUpdate(emails);
      }
    })
    .catch((err) => {
      if (!disposed) onError?.(err);
    });
  return () => {
    disposed = true;
  };
}

function vehicleFingerprint(v: Vehicle): string {
  return JSON.stringify({
    id: v.id,
    title: v.title,
    make: v.make,
    model: v.model,
    year: v.year,
    price: v.price,
    originalPrice: v.originalPrice ?? null,
    mileage: v.mileage,
    transmission: v.transmission,
    fuelType: v.fuelType,
    color: v.color,
    origin: v.origin,
    imageUrl: v.imageUrl,
    galleryImages: v.galleryImages ?? [],
    description: v.description,
    tiktokUrl: v.tiktokUrl,
    status: v.status,
    featured: v.featured,
    createdAt: v.createdAt,
  });
}

function postFingerprint(post: TikTokPost, sortOrder: number): string {
  return JSON.stringify({
    id: post.id,
    title: post.title,
    caption: post.caption,
    tiktokUrl: post.tiktokUrl,
    coverImageUrl: post.coverImageUrl,
    sortOrder,
  });
}

export async function syncShowroomStoreToCloudflare(
  nextStore: ShowroomStore,
  prevStore?: ShowroomStore | null,
  forceFullSync = false
): Promise<void> {
  const headers = await getFirebaseAdminBearerHeaders();

  const prevVehiclesMap = new Map((prevStore?.vehicles ?? []).map((v) => [v.id, v]));
  const nextVehicleIds = new Set(nextStore.vehicles.map((v) => v.id));

  const upsertVehicles = nextStore.vehicles.filter((v) => {
    const prev = prevVehiclesMap.get(v.id);
    return forceFullSync || !prev || vehicleFingerprint(prev) !== vehicleFingerprint(v);
  });

  const deleteVehicleIds = (prevStore?.vehicles ?? [])
    .filter((v) => v.id.trim() && !nextVehicleIds.has(v.id))
    .map((v) => v.id.trim());

  const prevSyncablePosts = filterSyncableTikTokPosts(prevStore?.tiktok.posts ?? []);
  const nextSyncablePosts = filterSyncableTikTokPosts(nextStore.tiktok.posts);
  const prevPostsMap = new Map(
    prevSyncablePosts.map((p, idx) => [
      p.id,
      { post: p, sortOrder: computeTikTokSortOrder(idx, prevSyncablePosts.length) },
    ])
  );
  const nextPostIds = new Set(nextSyncablePosts.map((p) => p.id));

  const upsertTikTokPosts = nextSyncablePosts
    .map((post, i) => ({
      ...post,
      sortOrder: computeTikTokSortOrder(i, nextSyncablePosts.length),
    }))
    .filter((entry) => {
      const prev = prevPostsMap.get(entry.id);
      return (
        forceFullSync ||
        !prev ||
        postFingerprint(prev.post, prev.sortOrder) !== postFingerprint(entry, entry.sortOrder)
      );
    });

  const deleteTikTokPostIds = prevSyncablePosts
    .filter((p) => p.id.trim() && !nextPostIds.has(p.id))
    .map((p) => p.id.trim());

  const configUpdated =
    forceFullSync ||
    !prevStore ||
    JSON.stringify({
      branding: prevStore.branding,
      hero: prevStore.hero,
      tiktokHeader: {
        title: prevStore.tiktok.title,
        description: prevStore.tiktok.description,
        profileUrl: prevStore.tiktok.profileUrl,
        handle: prevStore.tiktok.handle,
      },
      contact: prevStore.contact,
      adminEmails: prevStore.adminEmails ?? DEFAULT_ADMIN_EMAILS,
    }) !==
      JSON.stringify({
        branding: nextStore.branding,
        hero: nextStore.hero,
        tiktokHeader: {
          title: nextStore.tiktok.title,
          description: nextStore.tiktok.description,
          profileUrl: nextStore.tiktok.profileUrl,
          handle: nextStore.tiktok.handle,
        },
        contact: nextStore.contact,
        adminEmails: nextStore.adminEmails ?? DEFAULT_ADMIN_EMAILS,
      });

  await cloudflareFetchJson('/api/admin/sync-store', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      configUpdated,
      ...(configUpdated
        ? {
            branding: nextStore.branding,
            hero: nextStore.hero,
            tiktokHeader: {
              title: nextStore.tiktok.title,
              description: nextStore.tiktok.description,
              profileUrl: nextStore.tiktok.profileUrl,
              handle: nextStore.tiktok.handle,
            },
            contact: nextStore.contact,
            adminEmails: nextStore.adminEmails ?? DEFAULT_ADMIN_EMAILS,
          }
        : {}),
      upsertVehicles,
      deleteVehicleIds,
      upsertTikTokPosts,
      deleteTikTokPostIds,
    }),
  });

  notifyCloudflareShowroomChanged();
}

async function inlineLocalAssetForR2(url: string): Promise<string> {
  const trimmed = (url ?? '').trim();
  if (!trimmed || trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (typeof window === 'undefined' || typeof FileReader === 'undefined') {
    return trimmed;
  }
  try {
    const res = await fetch(resolvePublicAssetUrl(trimmed));
    if (!res.ok) return trimmed;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size === 0 || blob.size > 4 * 1024 * 1024) {
      return trimmed;
    }
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(trimmed);
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : trimmed);
      reader.readAsDataURL(blob);
    });
  } catch {
    return trimmed;
  }
}

export async function migrateShowroomStoreToCloudflare(
  store: ShowroomStore,
  onProgress?: (status: string) => void
): Promise<{ vehicleCount: number; tiktokCount: number }> {
  const headers = await getFirebaseAdminBearerHeaders();

  onProgress?.('Transferring branding, contact & social links to Cloudflare...');
  await cloudflareFetchJson('/api/admin/config', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      branding: store.branding,
      hero: store.hero,
      tiktok: {
        title: store.tiktok.title,
        description: store.tiktok.description,
        profileUrl: store.tiktok.profileUrl,
        handle: store.tiktok.handle,
      },
      contact: store.contact,
      adminEmails: store.adminEmails ?? DEFAULT_ADMIN_EMAILS,
    }),
  });

  const vehicles = Array.isArray(store.vehicles) ? store.vehicles : [];
  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    onProgress?.(
      `Uploading vehicle ${i + 1} of ${vehicles.length}: ${vehicle.title || vehicle.model || vehicle.id}...`
    );
    const inlinedPrimary = await inlineLocalAssetForR2(vehicle.imageUrl);
    const inlinedGallery = Array.isArray(vehicle.galleryImages)
      ? await Promise.all(vehicle.galleryImages.map((img) => inlineLocalAssetForR2(img)))
      : [];
    await cloudflareFetchJson(`/api/admin/vehicles/${encodeURIComponent(vehicle.id)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...vehicle,
        imageUrl: inlinedPrimary,
        galleryImages: inlinedGallery,
      }),
    });
  }

  const syncablePosts = filterSyncableTikTokPosts(store.tiktok.posts);
  for (let i = 0; i < syncablePosts.length; i++) {
    const post = syncablePosts[i];
    onProgress?.(`Uploading TikTok video ${i + 1} of ${syncablePosts.length}...`);
    await cloudflareFetchJson(`/api/admin/tiktok/${encodeURIComponent(post.id)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...post,
        sortOrder: computeTikTokSortOrder(i, syncablePosts.length),
      }),
    });
  }

  notifyCloudflareShowroomChanged();
  return {
    vehicleCount: vehicles.length,
    tiktokCount: syncablePosts.length,
  };
}

export async function deleteVehicleFromCloudflare(vehicleId: string): Promise<void> {
  const exactId = vehicleId.trim();
  if (!exactId) return;
  const headers = await getFirebaseAdminBearerHeaders();
  await cloudflareFetchJson(`/api/admin/vehicles/${encodeURIComponent(exactId)}`, {
    method: 'DELETE',
    headers,
  });
  notifyCloudflareShowroomChanged();
}

export async function deleteTikTokPostFromCloudflare(postId: string): Promise<void> {
  const exactId = postId.trim();
  if (!exactId) return;
  const headers = await getFirebaseAdminBearerHeaders();
  await cloudflareFetchJson(`/api/admin/tiktok/${encodeURIComponent(exactId)}`, {
    method: 'DELETE',
    headers,
  });
  notifyCloudflareShowroomChanged();
}

export async function resetCloudflareToDefaults(): Promise<void> {
  const headers = await getFirebaseAdminBearerHeaders();
  await cloudflareFetchJson('/api/admin/reset', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      branding: INITIAL_SHOWROOM_STORE.branding,
      hero: INITIAL_SHOWROOM_STORE.hero,
      tiktok: {
        title: INITIAL_SHOWROOM_STORE.tiktok.title,
        description: INITIAL_SHOWROOM_STORE.tiktok.description,
        profileUrl: INITIAL_SHOWROOM_STORE.tiktok.profileUrl,
        handle: INITIAL_SHOWROOM_STORE.tiktok.handle,
      },
      contact: INITIAL_SHOWROOM_STORE.contact,
      adminEmails: INITIAL_SHOWROOM_STORE.adminEmails ?? DEFAULT_ADMIN_EMAILS,
    }),
  });
  notifyCloudflareShowroomChanged();
}

export async function submitInquiryToCloudflare(input: {
  name: string;
  phone: string;
  email: string;
  vehicleTitle: string;
  message: string;
}): Promise<CustomerInquiry> {
  return cloudflareFetchJson<CustomerInquiry>('/api/inquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function fetchInquiriesFromCloudflare(): Promise<CustomerInquiry[]> {
  const headers = await getFirebaseAdminBearerHeaders();
  const res = await cloudflareFetchJson<{ inquiries?: CustomerInquiry[] }>('/api/admin/inquiries', {
    method: 'GET',
    headers,
  });
  return Array.isArray(res.inquiries) ? res.inquiries : [];
}

export async function trackVisitToCloudflare(payload: {
  id: string;
  page: string;
  visitorId: string;
  dateKey: string;
  referrer: string;
  userAgent: string;
  timestampMillis: number;
}): Promise<void> {
  await cloudflareFetchJson('/api/visits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function checkCloudflareSecurityForceSignOut(
  firebaseAuth: Auth,
  user: User,
  onForcedSignOut?: () => void
): Promise<boolean> {
  try {
    const headers = await getFirebaseAdminBearerHeaders(user);
    const res = await cloudflareFetchJson<{ forceSignOutBeforeMs?: number }>('/api/admin/security', {
      method: 'GET',
      headers,
    });
    const cutoffMs = Number(res.forceSignOutBeforeMs ?? 0);
    if (cutoffMs <= 0) return false;

    const tokenResult = await user.getIdTokenResult();
    const authTimeMs = new Date(tokenResult.authTime).getTime();
    if (Number.isFinite(authTimeMs) && authTimeMs < cutoffMs) {
      onForcedSignOut?.();
      await signOut(firebaseAuth).catch(() => undefined);
      return true;
    }
    return false;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 401 && err instanceof Error && err.message.includes('FORCE_SIGN_OUT')) {
      onForcedSignOut?.();
      await signOut(firebaseAuth).catch(() => undefined);
      return true;
    }
    return false;
  }
}

export async function upsertCloudflareAdminSession(
  user: User,
  sessionId: string,
  payload: {
    deviceId: string;
    deviceName: string;
    platform: string;
    location: string;
    loginAtMillis: number;
    status: 'active' | 'revoked';
    userAgent: string;
  }
): Promise<void> {
  const headers = await getFirebaseAdminBearerHeaders(user);
  await cloudflareFetchJson(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
}

export async function revokeCloudflareAdminSession(
  user: User,
  sessionId: string
): Promise<void> {
  const headers = await getFirebaseAdminBearerHeaders(user);
  await cloudflareFetchJson(`/api/admin/sessions/${encodeURIComponent(sessionId)}/revoke`, {
    method: 'POST',
    headers,
  });
}
