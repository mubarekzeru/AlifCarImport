import {
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { INITIAL_SHOWROOM_STORE } from '../data/seedData';
import { app, auth, formatFirestoreUserMessage, googleProvider } from '../firebase';
import type { CustomerInquiry, ShowroomStore } from '../types/showroom';
import {
  deleteTikTokPostFromCloudflare,
  deleteVehicleFromCloudflare,
  fetchAdminAllowlistFromCloudflare,
  fetchInquiriesFromCloudflare,
  isCloudflareBackendEnabled,
  migrateShowroomStoreToCloudflare,
  resetCloudflareToDefaults,
  submitInquiryToCloudflare,
  syncShowroomStoreToCloudflare,
} from './cloudflareStore';
import {
  checkFirestoreHasShowroom,
  deleteTikTokPostFromFirestore,
  deleteVehicleFromFirestore,
  fetchAdminAllowlistFromFirestore,
  fetchInquiriesFromFirestore,
  fetchShowroomSnapshotFromFirestore,
  resetFirestoreToDefaults,
  submitInquiryToFirestore,
  syncShowroomStoreToFirestore,
} from './firestoreStore';
import { compressImageUrlToDataUrl } from './imageUpload';
import {
  deriveTitleFromVideoDescription,
  isAuthorizedAdminEmail,
  normalizeTikTokUrl,
  resolveHeroVideoUrl,
  resolvePublicAssetUrl,
} from './inventory';
import { endWebAdminSession } from './webAdminSessionSync';

function normalizeStoreAssetPaths(store: ShowroomStore): ShowroomStore {
  const normalizedVehicles = Array.isArray(store.vehicles)
    ? store.vehicles.map((v) => ({
        ...v,
        imageUrl: resolvePublicAssetUrl(v.imageUrl),
        galleryImages: Array.isArray(v.galleryImages)
          ? v.galleryImages.map((u) => resolvePublicAssetUrl(u))
          : [],
      }))
    : [];

  return {
    ...store,
    branding: {
      ...store.branding,
      logoUrl: resolvePublicAssetUrl(store.branding?.logoUrl) || INITIAL_SHOWROOM_STORE.branding.logoUrl,
    },
    hero: {
      ...store.hero,
      imageUrl: resolvePublicAssetUrl(store.hero?.imageUrl),
      videoUrl: resolveHeroVideoUrl(store.hero?.videoUrl, INITIAL_SHOWROOM_STORE.hero.videoUrl),
    },
    vehicles: normalizedVehicles,
  };
}

const LEGACY_LOCAL_STORAGE_KEY = 'alif_car_import_store_v1';
const LOCAL_STORAGE_KEY = 'alif_car_import_store_v2';
const CONFIG_LOCAL_STORAGE_KEY = 'alif_car_import_config_v1';

interface CachedShowroomConfig {
  branding: ShowroomStore['branding'];
  hero: ShowroomStore['hero'];
  tiktok: Omit<ShowroomStore['tiktok'], 'posts'>;
  contact: ShowroomStore['contact'];
}

export function cacheShowroomConfigLocally(store: ShowroomStore): void {
  try {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    const lightweightConfig: CachedShowroomConfig = {
      branding: store.branding,
      hero: store.hero,
      tiktok: {
        title: store.tiktok.title,
        description: store.tiktok.description,
        profileUrl: store.tiktok.profileUrl,
        handle: store.tiktok.handle,
      },
      contact: store.contact,
    };
    localStorage.setItem(CONFIG_LOCAL_STORAGE_KEY, JSON.stringify(lightweightConfig));
  } catch {
    // Ignore local storage errors
  }
}

export function cacheShowroomStoreLocally(store: ShowroomStore): void {
  // Always persist lightweight Contact, Social Media, Location & Branding (< 2 KB)
  // so mobile/web updates never get lost if base64 vehicle images exceed the 5 MB quota.
  cacheShowroomConfigLocally(store);
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Remove stale full-store cache if quota is exceeded so old contact/vehicles never stick
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

function readCachedShowroomConfig(): CachedShowroomConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedShowroomConfig>;
    if (parsed && parsed.contact && typeof parsed.contact === 'object') {
      return parsed as CachedShowroomConfig;
    }
    return null;
  } catch {
    return null;
  }
}

export function readCachedShowroomStore(): ShowroomStore | null {
  try {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    const cachedConfig = readCachedShowroomConfig();
    const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as ShowroomStore;
      if (parsed && Array.isArray(parsed.vehicles)) {
        const merged: ShowroomStore = cachedConfig
          ? {
              ...parsed,
              branding: cachedConfig.branding ?? parsed.branding,
              hero: cachedConfig.hero ?? parsed.hero,
              tiktok: {
                ...(cachedConfig.tiktok ?? parsed.tiktok),
                posts: parsed.tiktok?.posts ?? [],
              },
              contact: cachedConfig.contact,
            }
          : parsed;
        return normalizeStoreAssetPaths(merged);
      }
    }
    if (cachedConfig) {
      return normalizeStoreAssetPaths({
        ...INITIAL_SHOWROOM_STORE,
        branding: cachedConfig.branding ?? INITIAL_SHOWROOM_STORE.branding,
        hero: cachedConfig.hero ?? INITIAL_SHOWROOM_STORE.hero,
        tiktok: {
          ...(cachedConfig.tiktok ?? INITIAL_SHOWROOM_STORE.tiktok),
          posts: [],
        },
        contact: cachedConfig.contact,
      });
    }
    return null;
  } catch {
    return null;
  }
}

export async function signInAdminWithEmailPassword(
  email: string,
  password: string,
  extraAdminEmails?: string[]
): Promise<{ authenticated: boolean; email: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    throw new Error('Please enter a valid admin email address.');
  }
  if (!password) {
    throw new Error('Please enter your admin password.');
  }

  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, normalized, password);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'auth/operation-not-allowed') {
      throw new Error(
        'Email/Password sign-in is not enabled yet in Firebase Console (Authentication → Sign-in method → Email/Password). Enable it there or use Sign in with Google below.'
      );
    }
    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found'
    ) {
      throw new Error('Incorrect admin email or password.');
    }
    if (code === 'auth/too-many-requests') {
      throw new Error('Too many failed login attempts. Please wait a moment and try again.');
    }
    if (code === 'auth/unauthorized-domain') {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      throw new Error(
        `Domain "${host}" must be added under Firebase Console → Authentication → Settings → Authorized domains.`
      );
    }
    throw new Error(
      err instanceof Error ? err.message : 'Unable to sign in with email and password.'
    );
  }

  const user = credential.user;
  const signedEmail = user.email?.trim() ?? normalized;
  if (!user.emailVerified) {
    await sendEmailVerification(user).catch(() => undefined);
    await signOut(auth).catch(() => undefined);
    throw new Error(
      `Email "${signedEmail}" is not verified yet. A verification link was sent to your inbox — click it once (or sign in once with Google to verify), then try again.`
    );
  }

  const remoteAllowlist = isCloudflareBackendEnabled()
    ? await fetchAdminAllowlistFromCloudflare(user)
    : await fetchAdminAllowlistFromFirestore();
  const combinedAllowlist = [...(extraAdminEmails ?? []), ...(remoteAllowlist ?? [])];

  if (!isAuthorizedAdminEmail(signedEmail, combinedAllowlist)) {
    await signOut(auth).catch(() => undefined);
    throw new Error('This email is not authorized for admin access.');
  }

  return { authenticated: true, email: signedEmail };
}

export async function signInAdminWithGoogle(
  extraAdminEmails?: string[]
): Promise<{ authenticated: boolean; email: string }> {
  let credential;
  try {
    credential = await signInWithPopup(auth, googleProvider);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google sign-in popup was closed before completing.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Browser blocked the Google sign-in popup. Please allow popups and try again.');
    }
    if (code === 'auth/unauthorized-domain') {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      throw new Error(
        `Domain "${host}" must be added under Firebase Console → Authentication → Settings → Authorized domains.`
      );
    }
    throw new Error(
      err instanceof Error ? err.message : 'Unable to complete Google sign-in.'
    );
  }

  const user = credential.user;
  const email = user.email?.trim() ?? '';
  if (!email || !user.emailVerified) {
    await signOut(auth).catch(() => undefined);
    throw new Error('A verified Google account email is required for admin access.');
  }

  const remoteAllowlist = isCloudflareBackendEnabled()
    ? await fetchAdminAllowlistFromCloudflare(user)
    : await fetchAdminAllowlistFromFirestore();
  const combinedAllowlist = [
    ...(extraAdminEmails ?? []),
    ...(remoteAllowlist ?? []),
  ];

  if (!isAuthorizedAdminEmail(email, combinedAllowlist)) {
    await signOut(auth).catch(() => undefined);
    throw new Error('This email is not authorized for admin access.');
  }

  return { authenticated: true, email };
}

export async function checkFirebaseAdminUser(
  extraAdminEmails?: string[]
): Promise<{ authenticated: boolean; email: string | null }> {
  const user = auth.currentUser;
  if (!user || !user.email || !user.emailVerified) {
    return { authenticated: false, email: null };
  }

  const remoteAllowlist = isCloudflareBackendEnabled()
    ? await fetchAdminAllowlistFromCloudflare(user)
    : await fetchAdminAllowlistFromFirestore();
  const combinedAllowlist = [
    ...(extraAdminEmails ?? []),
    ...(remoteAllowlist ?? []),
  ];

  if (!isAuthorizedAdminEmail(user.email, combinedAllowlist)) {
    return { authenticated: false, email: null };
  }

  return { authenticated: true, email: user.email };
}

export interface MobileAppImportResult {
  store: ShowroomStore;
  vehicleCount: number;
  tiktokCount: number;
  hasConfig: boolean;
}

export async function importMobileAppDataToCloudflare(
  fallbackStore: ShowroomStore,
  onProgress?: (status: string) => void
): Promise<MobileAppImportResult> {
  if (!auth.currentUser) {
    throw new Error('Please sign in with an authorized admin account first.');
  }
  if (!isCloudflareBackendEnabled()) {
    throw new Error('Cloudflare backend is not enabled.');
  }

  onProgress?.('Reading cars, photos, TikTok videos & details from Firebase (mobile app)...');
  let snapshot;
  try {
    snapshot = await fetchShowroomSnapshotFromFirestore(fallbackStore);
  } catch (err) {
    const msg = formatFirestoreUserMessage(err);
    const lower = msg.toLowerCase();
    if (
      lower.includes('quota') ||
      lower.includes('resource-exhausted') ||
      lower.includes('resource_exhausted') ||
      lower.includes('429')
    ) {
      throw new Error(
        'Firebase daily free read quota is still cooling down. Please tap "Import from Mobile App" again after Firebase resets (midnight US Pacific / 11:00 AM Ethiopia time) to copy all mobile app cars, photos, and TikTok videos automatically.'
      );
    }
    throw new Error(msg);
  }

  if (!snapshot.hasConfig && snapshot.vehicleCount === 0 && snapshot.tiktokCount === 0) {
    throw new Error('No cars, TikTok videos, or showroom settings were found in Firebase yet.');
  }

  const uploaded = await migrateShowroomStoreToCloudflare(snapshot.store, onProgress);
  cacheShowroomStoreLocally(snapshot.store);

  return {
    store: snapshot.store,
    vehicleCount: uploaded.vehicleCount,
    tiktokCount: uploaded.tiktokCount,
    hasConfig: snapshot.hasConfig,
  };
}

export async function ensureFirestoreSeeded(
  seedStore: ShowroomStore,
  snapshotMeta?: {
    hasConfig: boolean;
    remoteVehicles?: ShowroomStore['vehicles'];
  }
): Promise<MobileAppImportResult | null> {
  if (!auth.currentUser) return null;
  if (isCloudflareBackendEnabled()) {
    const cloudflareIsEmpty =
      Boolean(snapshotMeta) &&
      !snapshotMeta?.hasConfig &&
      (snapshotMeta?.remoteVehicles?.length ?? 0) === 0;
    if (cloudflareIsEmpty) {
      try {
        return await importMobileAppDataToCloudflare(seedStore);
      } catch {
        // Firebase daily quota may still be cooling down; seed the imported
        // alifcarimport.com catalog into Cloudflare D1 so it is immediately live & editable.
        if (seedStore.vehicles.length > 0) {
          const uploaded = await migrateShowroomStoreToCloudflare(seedStore);
          cacheShowroomStoreLocally(seedStore);
          return {
            store: seedStore,
            vehicleCount: uploaded.vehicleCount,
            tiktokCount: uploaded.tiktokCount,
            hasConfig: true,
          };
        }
        return null;
      }
    }
    return null;
  }
  const hasRemote =
    snapshotMeta !== undefined ? snapshotMeta.hasConfig : await checkFirestoreHasShowroom();
  if (!hasRemote) {
    await syncShowroomStoreToFirestore(seedStore, null, true);
  }
  return null;
}

export async function logoutAdmin(): Promise<void> {
  await endWebAdminSession(app, auth.currentUser);
  await signOut(auth).catch(() => undefined);
}

function isStaticGitHubPagesHost(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.hostname.toLowerCase().endsWith('.github.io')
  );
}

export async function loadShowroomStore(): Promise<ShowroomStore> {
  return readCachedShowroomStore() ?? INITIAL_SHOWROOM_STORE;
}

export async function saveShowroomStore(
  store: ShowroomStore,
  prevStore?: ShowroomStore | null
): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Please sign in with an authorized admin account to publish changes.');
  }

  try {
    if (isCloudflareBackendEnabled()) {
      await syncShowroomStoreToCloudflare(store, prevStore, false);
    } else {
      await syncShowroomStoreToFirestore(store, prevStore, false);
    }
    // Only update the browser's local cache AFTER the cloud write succeeds
    cacheShowroomStoreLocally(store);
  } catch (err) {
    throw new Error(formatFirestoreUserMessage(err));
  }
}

export async function deleteVehicleFromStore(
  vehicleId: string,
  nextStore: ShowroomStore
): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Please sign in with an authorized admin account to delete vehicles.');
  }

  try {
    if (isCloudflareBackendEnabled()) {
      await deleteVehicleFromCloudflare(vehicleId);
    } else {
      await deleteVehicleFromFirestore(vehicleId);
    }
    cacheShowroomStoreLocally(nextStore);
  } catch (err) {
    throw new Error(formatFirestoreUserMessage(err));
  }
}

export async function deleteTikTokPostFromStore(
  postId: string,
  nextStore: ShowroomStore
): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Please sign in with an authorized admin account to remove TikTok videos.');
  }

  try {
    if (isCloudflareBackendEnabled()) {
      await deleteTikTokPostFromCloudflare(postId);
    } else {
      await deleteTikTokPostFromFirestore(postId);
    }
    cacheShowroomStoreLocally(nextStore);
  } catch (err) {
    throw new Error(formatFirestoreUserMessage(err));
  }
}

export async function resetShowroomStore(): Promise<ShowroomStore> {
  if (!auth.currentUser) {
    throw new Error('Please sign in with an authorized admin account to reset defaults.');
  }

  try {
    if (isCloudflareBackendEnabled()) {
      await resetCloudflareToDefaults();
    } else {
      await resetFirestoreToDefaults();
    }
  } catch (err) {
    throw new Error(formatFirestoreUserMessage(err));
  }

  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorage.removeItem(CONFIG_LOCAL_STORAGE_KEY);
  } catch {
    // Ignore
  }

  return INITIAL_SHOWROOM_STORE;
}

export async function submitCustomerInquiry(input: {
  name: string;
  phone: string;
  email: string;
  vehicleTitle: string;
  message: string;
}): Promise<CustomerInquiry> {
  try {
    if (isCloudflareBackendEnabled()) {
      return await submitInquiryToCloudflare(input);
    }
    return await submitInquiryToFirestore(input);
  } catch (err) {
    throw new Error(formatFirestoreUserMessage(err));
  }
}

export async function fetchCustomerInquiries(): Promise<CustomerInquiry[]> {
  try {
    if (isCloudflareBackendEnabled()) {
      return await fetchInquiriesFromCloudflare();
    }
    return await fetchInquiriesFromFirestore();
  } catch {
    return [];
  }
}

export interface TikTokMetadataResult {
  resolvedUrl: string;
  videoId: string | null;
  description: string;
  suggestedTitle: string;
  coverImageUrl: string;
  coverOptions: { label: string; url: string }[];
  authorHandle: string;
}

async function tryConvertRemoteCoverToDataUrl(imageUrl: string): Promise<string> {
  if (!imageUrl || imageUrl.startsWith('data:')) return imageUrl;
  try {
    const res = await fetch(imageUrl, { mode: 'cors' });
    if (!res.ok) return imageUrl;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size === 0 || blob.size > 380 * 1024) {
      return imageUrl;
    }
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(imageUrl);
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : imageUrl);
      reader.readAsDataURL(blob);
    });
  } catch {
    return imageUrl;
  }
}

async function finalizeCoverDataUrl(imageUrl: string): Promise<string> {
  if (!imageUrl) return '';
  const fetched = imageUrl.startsWith('http')
    ? await tryConvertRemoteCoverToDataUrl(imageUrl)
    : imageUrl;
  return compressImageUrlToDataUrl(fetched, 640, 190_000);
}

export async function fetchTikTokVideoMetadata(url: string): Promise<TikTokMetadataResult> {
  const normalizedUrl = normalizeTikTokUrl(url);
  let partialFromServer: Partial<TikTokMetadataResult> | null = null;

  // 1. Try local Express metadata endpoint first when running on AI Studio / Node server
  if (!isStaticGitHubPagesHost()) {
    try {
      const response = await fetch('/api/tiktok-metadata', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = (await response.json().catch(() => ({}))) as Partial<TikTokMetadataResult> & {
          error?: string;
        };
        if (response.ok) {
          const rawOptions = Array.isArray(json.coverOptions) ? json.coverOptions : [];
          const compactedOptions = await Promise.all(
            rawOptions.map(async (opt) => ({
              label: opt.label,
              url: await finalizeCoverDataUrl(opt.url),
            }))
          );
          const primaryCover =
            compactedOptions[0]?.url ||
            (json.coverImageUrl ? await finalizeCoverDataUrl(json.coverImageUrl) : '');

          const result: TikTokMetadataResult = {
            resolvedUrl: json.resolvedUrl || normalizedUrl,
            videoId: json.videoId || null,
            description: json.description || '',
            suggestedTitle: json.suggestedTitle || '',
            coverImageUrl: primaryCover,
            coverOptions: compactedOptions,
            authorHandle: json.authorHandle || '',
          };

          if (result.coverImageUrl) {
            return result;
          }
          // Server succeeded without a cover image — keep its text metadata and continue to fallbacks
          partialFromServer = result;
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 404 && response.status !== 405) {
          throw new Error(json.error || 'Unable to fetch video details from TikTok.');
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('valid TikTok URL')) {
        throw err;
      }
      // Static hosting does not run Express /api/tiktok-metadata — fall through
    }
  }

  // 2. Client-side CORS fallback for static deployments (GitHub Pages) or empty server cover
  try {
    const apiRes = await fetch(
      `https://www.tikwm.com/api/?url=${encodeURIComponent(normalizedUrl)}`
    );
    if (apiRes.ok) {
      const payload = (await apiRes.json()) as {
        code?: number;
        data?: {
          id?: string;
          title?: string;
          cover?: string;
          origin_cover?: string;
          images?: string[];
          author?: { unique_id?: string };
        };
      };
      const item = payload?.data;
      if (payload?.code === 0 && item) {
        const videoId = item.id || partialFromServer?.videoId || null;
        const authorHandle =
          (item.author?.unique_id ? `@${item.author.unique_id}` : '') ||
          partialFromServer?.authorHandle ||
          '';
        const resolvedUrl =
          videoId && item.author?.unique_id
            ? `https://www.tiktok.com/@${item.author.unique_id}/video/${videoId}`
            : partialFromServer?.resolvedUrl || normalizedUrl;
        const description = (item.title || '').trim() || partialFromServer?.description || '';
        const suggestedTitle =
          deriveTitleFromVideoDescription(description) || partialFromServer?.suggestedTitle || '';
        const rawCandidates: { label: string; url: string }[] = [];
        if (typeof item.cover === 'string' && item.cover.startsWith('http')) {
          rawCandidates.push({ label: 'Video Cover', url: item.cover });
        }
        if (
          typeof item.origin_cover === 'string' &&
          item.origin_cover.startsWith('http') &&
          item.origin_cover !== item.cover
        ) {
          rawCandidates.push({ label: 'Clean Video Frame', url: item.origin_cover });
        }
        if (
          Array.isArray(item.images) &&
          typeof item.images[0] === 'string' &&
          item.images[0].startsWith('http')
        ) {
          rawCandidates.push({ label: 'Photo Cover', url: item.images[0] });
        }
        const coverOptions = await Promise.all(
          rawCandidates.map(async (c) => ({
            label: c.label,
            url: await finalizeCoverDataUrl(c.url),
          }))
        );
        return {
          resolvedUrl,
          videoId,
          description,
          suggestedTitle,
          coverImageUrl: coverOptions[0]?.url || '',
          coverOptions,
          authorHandle,
        };
      }
    }
  } catch {
    // Fall through to TikTok oEmbed
  }

  // 3. Official TikTok oEmbed fallback
  const oeRes = await fetch(
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(normalizedUrl)}`
  ).catch(() => null);
  if (oeRes && oeRes.ok) {
    const oe = (await oeRes.json().catch(() => ({}))) as {
      title?: string;
      thumbnail_url?: string;
      author_name?: string;
      embed_product_id?: string;
    };
    const description = (oe.title || '').trim() || partialFromServer?.description || '';
    const suggestedTitle =
      deriveTitleFromVideoDescription(description) || partialFromServer?.suggestedTitle || '';
    const rawThumb =
      typeof oe.thumbnail_url === 'string' && oe.thumbnail_url.startsWith('http')
        ? await finalizeCoverDataUrl(oe.thumbnail_url)
        : '';
    return {
      resolvedUrl: partialFromServer?.resolvedUrl || normalizedUrl,
      videoId: oe.embed_product_id || partialFromServer?.videoId || null,
      description,
      suggestedTitle,
      coverImageUrl: rawThumb,
      coverOptions: rawThumb ? [{ label: 'Video Cover', url: rawThumb }] : [],
      authorHandle:
        (oe.author_name ? `@${oe.author_name.replace(/^@/, '')}` : '') ||
        partialFromServer?.authorHandle ||
        '',
    };
  }

  if (partialFromServer) {
    return {
      resolvedUrl: partialFromServer.resolvedUrl || normalizedUrl,
      videoId: partialFromServer.videoId || null,
      description: partialFromServer.description || '',
      suggestedTitle: partialFromServer.suggestedTitle || '',
      coverImageUrl: partialFromServer.coverImageUrl || '',
      coverOptions: partialFromServer.coverOptions || [],
      authorHandle: partialFromServer.authorHandle || '',
    };
  }

  throw new Error('Unable to fetch video cover & title from TikTok. Try uploading a cover or using From Video File.');
}
