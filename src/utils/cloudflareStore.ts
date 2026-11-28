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
  return normalizeCloudflareApiUrl(DEFAULT_CLOUDFLARE_API_URL);
}

export function isCloudflareBackendEnabled(): boolean {
  return Boolean(getCloudflareApiBaseUrl());
}

export function buildCloudflareEndpoint(path: string, baseUrlOverride?: string): string {
  const base = normalizeCloudflareApiUrl(baseUrlOverride ?? getCloudflareApiBaseUrl());
  if (!base) {
    throw new Error('Cloudflare API URL is not configured.');
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
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<T> {
  const url = buildCloudflareEndpoint(path);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const res = await fetch(url, {
      ...init,
      signal: init.signal ?? controller?.signal,
    });
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
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      const timeoutErr = new Error('Request timed out. Please try again.') as Error & {
        status?: number;
      };
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    throw err;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
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
    const res = await cloudflareFetchJson<{ adminEmails?: unknown }>(
      '/api/admin/access',
      {
        method: 'GET',
        headers,
      },
      3500
    );
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
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export interface CloudflareSecurityStatus {
  forceSignOutBeforeMs: number;
  twoFactorEnabled: boolean;
  hasTotpSecret: boolean;
  requireDeviceApproval: boolean;
  loginAlertsEnabled: boolean;
  trustedDeviceCount: number;
}

export interface CloudflareAdminSession {
  id: string;
  uid: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  email: string;
  location: string;
  loginAtMillis: number;
  lastActiveMillis: number;
  status: 'active' | 'revoked' | 'pending_verification' | string;
  userAgent: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface CloudflareLoginAlert {
  id: string;
  sessionId: string;
  uid: string;
  email: string;
  deviceName: string;
  platform: string;
  location: string;
  timestampMillis: number;
  decision: 'pending' | 'approved' | 'denied' | 'notified' | string;
  alertType: 'unauthorized_email' | 'new_device';
  verificationCode?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface CloudflareVisitorAnalytics {
  totalVisits: number;
  uniqueVisitors: number;
  todayVisits: number;
  todayUnique: number;
  last7DaysVisits: number;
  inquiriesCount: number;
  dailyStats: Array<{ dateKey: string; visits: number; uniqueVisitors: number }>;
  topPages: Array<{ page: string; visits: number }>;
  recent: Array<{
    id: string;
    page: string;
    visitorId: string;
    dateKey: string;
    referrer: string;
    userAgent: string;
    timestampMillis: number;
  }>;
}

export interface CloudflareStartLoginResult {
  status: 'verified' | 'requires_verification';
  sessionId: string;
  alertId?: string;
  challengeId?: string;
  twoFactorEnabled?: boolean;
  hasTotp?: boolean;
  requireDeviceApproval?: boolean;
  hasOtherDevices?: boolean;
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

export async function checkCloudflareSessionStatus(
  user: User,
  sessionId: string
): Promise<{
  revoked: boolean;
  forceSignOutBeforeMs: number;
  pendingAlertsCount: number;
}> {
  const headers = await getFirebaseAdminBearerHeaders(user);
  const res = await cloudflareFetchJson<{
    session?: CloudflareAdminSession | null;
    forceSignOutBeforeMs?: number;
    pendingAlertsCount?: number;
  }>(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers,
  });
  return {
    revoked: Boolean(res.session && res.session.status === 'revoked'),
    forceSignOutBeforeMs: Number(res.forceSignOutBeforeMs ?? 0),
    pendingAlertsCount: Number(res.pendingAlertsCount ?? 0),
  };
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
    status: 'active' | 'revoked' | 'pending_verification';
    userAgent: string;
    forceActivate?: boolean;
    recordAlert?: boolean;
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
  user: User | null | undefined,
  sessionId: string
): Promise<void> {
  const headers = await getFirebaseAdminBearerHeaders(user);
  await cloudflareFetchJson(`/api/admin/sessions/${encodeURIComponent(sessionId)}/revoke`, {
    method: 'POST',
    headers,
  });
}

export async function reportUnauthorizedLoginAttempt(
  user: User,
  payload: {
    deviceId: string;
    deviceName: string;
    platform: string;
    location: string;
  }
): Promise<{ alertId: string; authorized: boolean; decision: string }> {
  const headers = await getFirebaseAdminBearerHeaders(user);
  return cloudflareFetchJson('/api/auth/login-alert', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

export async function pollUnauthorizedAccessRequest(
  user: User,
  alertId: string
): Promise<{ id: string; decision: string; authorized: boolean }> {
  const headers = await getFirebaseAdminBearerHeaders(user);
  return cloudflareFetchJson(`/api/auth/request-status/${encodeURIComponent(alertId)}`, {
    method: 'GET',
    headers,
  });
}

export async function startCloudflareAdminLogin(
  user: User,
  payload: {
    deviceId: string;
    sessionId: string;
    deviceName: string;
    platform: string;
    location: string;
    userAgent: string;
  }
): Promise<CloudflareStartLoginResult> {
  const headers = await getFirebaseAdminBearerHeaders(user);
  return cloudflareFetchJson<CloudflareStartLoginResult>(
    '/api/admin/security/start-login',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
    3500
  );
}

export async function verifyCloudflareAuthCode(
  user: User,
  challengeId: string,
  code: string,
  trustDevice = true
): Promise<{ ok: boolean; verified: boolean; sessionId: string }> {
  const headers = await getFirebaseAdminBearerHeaders(user);
  return cloudflareFetchJson('/api/admin/security/verify-code', {
    method: 'POST',
    headers,
    body: JSON.stringify({ challengeId, code, trustDevice }),
  });
}

export async function pollCloudflareLoginChallenge(
  user: User,
  challengeId: string
): Promise<{ id: string; sessionId: string; status: string }> {
  const headers = await getFirebaseAdminBearerHeaders(user);
  return cloudflareFetchJson(`/api/admin/security/challenge/${encodeURIComponent(challengeId)}`, {
    method: 'GET',
    headers,
  });
}

export async function fetchCloudflareSecurityStatus(): Promise<CloudflareSecurityStatus> {
  const headers = await getFirebaseAdminBearerHeaders();
  const res = await cloudflareFetchJson<Partial<CloudflareSecurityStatus>>('/api/admin/security', {
    method: 'GET',
    headers,
  });
  return {
    forceSignOutBeforeMs: Number(res.forceSignOutBeforeMs ?? 0),
    twoFactorEnabled: Boolean(res.twoFactorEnabled),
    hasTotpSecret: Boolean(res.hasTotpSecret),
    requireDeviceApproval: res.requireDeviceApproval !== false,
    loginAlertsEnabled: res.loginAlertsEnabled !== false,
    trustedDeviceCount: Number(res.trustedDeviceCount ?? 0),
  };
}

export async function updateCloudflareSecuritySettings(patch: {
  twoFactorEnabled?: boolean;
  requireDeviceApproval?: boolean;
  loginAlertsEnabled?: boolean;
  clearTrustedDevices?: boolean;
}): Promise<CloudflareSecurityStatus> {
  const headers = await getFirebaseAdminBearerHeaders();
  const res = await cloudflareFetchJson<Partial<CloudflareSecurityStatus>>('/api/admin/security', {
    method: 'PUT',
    headers,
    body: JSON.stringify(patch),
  });
  return {
    forceSignOutBeforeMs: Number(res.forceSignOutBeforeMs ?? 0),
    twoFactorEnabled: Boolean(res.twoFactorEnabled),
    hasTotpSecret: Boolean(res.hasTotpSecret),
    requireDeviceApproval: res.requireDeviceApproval !== false,
    loginAlertsEnabled: res.loginAlertsEnabled !== false,
    trustedDeviceCount: Number(res.trustedDeviceCount ?? 0),
  };
}

export async function setupCloudflareTotp(): Promise<{
  secret: string;
  otpauthUrl: string;
  twoFactorEnabled: boolean;
}> {
  const headers = await getFirebaseAdminBearerHeaders();
  return cloudflareFetchJson('/api/admin/security/totp/setup', {
    method: 'POST',
    headers,
  });
}

export async function enableCloudflareTotp(code: string): Promise<{ ok: boolean; twoFactorEnabled: boolean }> {
  const headers = await getFirebaseAdminBearerHeaders();
  return cloudflareFetchJson('/api/admin/security/totp/enable', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code }),
  });
}

export async function disableCloudflareTotp(): Promise<{ ok: boolean; twoFactorEnabled: boolean }> {
  const headers = await getFirebaseAdminBearerHeaders();
  return cloudflareFetchJson('/api/admin/security/totp/disable', {
    method: 'POST',
    headers,
  });
}

export async function forceSignOutAllCloudflareDevices(): Promise<{ ok: boolean; forceSignOutBeforeMs: number }> {
  const headers = await getFirebaseAdminBearerHeaders();
  return cloudflareFetchJson('/api/admin/security/force-sign-out', {
    method: 'POST',
    headers,
  });
}

export async function fetchCloudflareAdminSessions(): Promise<{
  sessions: CloudflareAdminSession[];
  activeCount: number;
}> {
  const headers = await getFirebaseAdminBearerHeaders();
  const res = await cloudflareFetchJson<{
    sessions?: Array<Record<string, unknown>>;
    activeCount?: number;
  }>('/api/admin/sessions', {
    method: 'GET',
    headers,
  });
  const sessions: CloudflareAdminSession[] = (Array.isArray(res.sessions) ? res.sessions : []).map((r) => ({
    id: String(r.id ?? ''),
    uid: String(r.uid ?? ''),
    deviceId: String(r.deviceId ?? r.device_id ?? ''),
    deviceName: String(r.deviceName ?? r.device_name ?? 'Device'),
    platform: String(r.platform ?? 'Website'),
    email: String(r.email ?? ''),
    location: String(r.location ?? ''),
    loginAtMillis: Number(r.loginAtMillis ?? r.login_at_millis ?? 0),
    lastActiveMillis: Number(r.lastActiveMillis ?? r.last_active_millis ?? 0),
    status: String(r.status ?? 'active'),
    userAgent: String(r.userAgent ?? r.user_agent ?? ''),
    createdAtMs: Number(r.createdAtMs ?? r.created_at_ms ?? 0),
    updatedAtMs: Number(r.updatedAtMs ?? r.updated_at_ms ?? 0),
  }));
  const activeCount =
    typeof res.activeCount === 'number'
      ? res.activeCount
      : sessions.filter((s) => s.status === 'active').length;
  return { sessions, activeCount };
}

export async function fetchCloudflareLoginAlerts(): Promise<{
  alerts: CloudflareLoginAlert[];
  pendingCount: number;
}> {
  const headers = await getFirebaseAdminBearerHeaders();
  const res = await cloudflareFetchJson<{
    alerts?: CloudflareLoginAlert[];
    pendingCount?: number;
  }>('/api/admin/login-alerts', {
    method: 'GET',
    headers,
  });
  const alerts = Array.isArray(res.alerts) ? res.alerts : [];
  const pendingCount =
    typeof res.pendingCount === 'number'
      ? res.pendingCount
      : alerts.filter((a) => a.decision === 'pending').length;
  return { alerts, pendingCount };
}

export async function respondToCloudflareLoginAlert(
  alertId: string,
  decision: 'approved' | 'denied'
): Promise<{ ok: boolean; id: string; decision: string; grantedEmail?: string | null }> {
  const headers = await getFirebaseAdminBearerHeaders();
  return cloudflareFetchJson(`/api/admin/login-alerts/${encodeURIComponent(alertId)}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision }),
  });
}

export async function fetchCloudflareVisitorAnalytics(): Promise<CloudflareVisitorAnalytics> {
  const headers = await getFirebaseAdminBearerHeaders();
  const res = await cloudflareFetchJson<Partial<CloudflareVisitorAnalytics>>(
    '/api/admin/visits/summary',
    {
      method: 'GET',
      headers,
    }
  );
  const rawRecent = Array.isArray(res.recent) ? res.recent : [];
  return {
    totalVisits: Number(res.totalVisits ?? 0),
    uniqueVisitors: Number(res.uniqueVisitors ?? 0),
    todayVisits: Number(res.todayVisits ?? 0),
    todayUnique: Number(res.todayUnique ?? 0),
    last7DaysVisits: Number(res.last7DaysVisits ?? 0),
    inquiriesCount: Number(res.inquiriesCount ?? 0),
    dailyStats: Array.isArray(res.dailyStats) ? res.dailyStats : [],
    topPages: Array.isArray(res.topPages) ? res.topPages : [],
    recent: rawRecent.map((item) => {
      const r = item as Record<string, unknown>;
      return {
        id: String(r.id ?? ''),
        page: String(r.page ?? '/'),
        visitorId: String(r.visitorId ?? r.visitor_id ?? ''),
        dateKey: String(r.dateKey ?? r.date_key ?? ''),
        referrer: String(r.referrer ?? ''),
        userAgent: String(r.userAgent ?? r.user_agent ?? ''),
        timestampMillis: Number(r.timestampMillis ?? r.timestamp_millis ?? 0),
      };
    }),
  };
}

