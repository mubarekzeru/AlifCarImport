import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { INITIAL_SHOWROOM_STORE } from '../data/seedData';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  BrandingSettings,
  CustomerInquiry,
  HeroPost,
  LocationContact,
  ShowroomStore,
  TikTokPost,
  TikTokSectionConfig,
  Vehicle,
} from '../types/showroom';
import {
  DEFAULT_ADMIN_EMAILS,
  resolvePublicAssetUrl,
  toCanonicalPublicAssetPath,
} from './inventory';
import {
  filterSyncableTikTokPosts,
  mergeShowroomSnapshotState,
  type RemoteShowroomConfigData,
  type RemoteTikTokPostEntry,
} from './firestoreSyncLogic';

const MAX_VEHICLE_DOC_BYTES = 920_000;

function sanitizeDocId(rawId: string, fallbackPrefix: string): string {
  const cleaned = rawId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `${fallbackPrefix}_${Date.now()}`;
}

function clampStr(value: unknown, maxLen: number, fallback = ''): string {
  const str = typeof value === 'string' ? value : fallback;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function buildBrandingPayload(branding: BrandingSettings) {
  return {
    companyName: clampStr(branding.companyName, 120, 'Alif Car Import') || 'Alif Car Import',
    logoUrl: clampStr(toCanonicalPublicAssetPath(branding.logoUrl), 550_000, ''),
    tagline: clampStr(branding.tagline, 240, ''),
  };
}

function buildHeroPayload(hero: HeroPost) {
  return {
    kicker: clampStr(hero.kicker, 120, ''),
    title: clampStr(hero.title, 200, 'Alif Car Import') || 'Alif Car Import',
    description: clampStr(hero.description, 1200, ''),
    imageUrl: clampStr(toCanonicalPublicAssetPath(hero.imageUrl), 550_000, ''),
    ...(typeof hero.videoUrl === 'string' && hero.videoUrl.trim()
      ? { videoUrl: clampStr(toCanonicalPublicAssetPath(hero.videoUrl), 550_000, '') }
      : {}),
    ctaLabel: clampStr(hero.ctaLabel, 80, 'Browse Inventory') || 'Browse Inventory',
  };
}

function buildTikTokHeaderPayload(tiktok: TikTokSectionConfig) {
  return {
    title: clampStr(tiktok.title, 160, 'Walkaround Reels on TikTok') || 'Walkaround Reels on TikTok',
    description: clampStr(tiktok.description, 1200, ''),
    profileUrl: clampStr(tiktok.profileUrl, 500, ''),
    handle: clampStr(tiktok.handle, 80, ''),
  };
}

function buildContactPayload(contact: LocationContact) {
  return {
    addressLine: clampStr(contact.addressLine, 240, ''),
    cityCountry: clampStr(contact.cityCountry, 160, ''),
    hours: clampStr(contact.hours, 160, ''),
    phone: clampStr(contact.phone, 60, ''),
    whatsapp: clampStr(contact.whatsapp, 200, ''),
    telegram: clampStr(contact.telegram, 200, ''),
    instagram: clampStr(contact.instagram, 200, ''),
    facebook: clampStr(contact.facebook, 200, ''),
    x: clampStr(contact.x, 200, ''),
    email: clampStr(contact.email, 254, ''),
    mapsUrl: clampStr(contact.mapsUrl, 500, ''),
    landmarkNote: clampStr(contact.landmarkNote, 240, ''),
  };
}

function buildVehicleDocPayload(vehicle: Vehicle) {
  const id = sanitizeDocId(vehicle.id, 'veh');
  const galleryImages = Array.isArray(vehicle.galleryImages)
    ? vehicle.galleryImages
        .filter((u): u is string => typeof u === 'string' && u.trim().length > 0 && u.length <= 550_000)
        .map((u) => toCanonicalPublicAssetPath(u))
        .slice(0, 20)
    : [];

  const yearNum = Number.isFinite(vehicle.year) ? Math.min(Math.max(Math.round(vehicle.year), 1950), 2100) : 2024;
  const priceNum = Number.isFinite(vehicle.price) ? Math.min(Math.max(vehicle.price, 0), 100_000_000) : 0;

  const payload: Record<string, unknown> = {
    id,
    title: clampStr(vehicle.title, 200, 'Vehicle') || 'Vehicle',
    make: clampStr(vehicle.make, 80, 'Import') || 'Import',
    model: clampStr(vehicle.model, 120, 'Model') || 'Model',
    year: yearNum,
    price: priceNum,
    mileage: clampStr(vehicle.mileage, 60, '0 km'),
    transmission: clampStr(vehicle.transmission, 80, 'Automatic'),
    fuelType: clampStr(vehicle.fuelType, 80, 'Petrol'),
    color: clampStr(vehicle.color, 80, 'White'),
    origin: clampStr(vehicle.origin, 100, 'Japan Import'),
    imageUrl: clampStr(toCanonicalPublicAssetPath(vehicle.imageUrl), 550_000, ''),
    galleryImages,
    description: clampStr(vehicle.description, 4000, 'Imported vehicle.') || 'Imported vehicle.',
    tiktokUrl: clampStr(vehicle.tiktokUrl, 500, ''),
    status:
      vehicle.status === 'reserved' || vehicle.status === 'sold' ? vehicle.status : 'available',
    featured: Boolean(vehicle.featured),
    createdAt: clampStr(vehicle.createdAt, 64, new Date().toISOString().slice(0, 10)) || '2024-01-01',
    updatedAt: serverTimestamp(),
  };

  if (
    typeof vehicle.originalPrice === 'number' &&
    Number.isFinite(vehicle.originalPrice) &&
    vehicle.originalPrice >= 0
  ) {
    payload.originalPrice = Math.min(vehicle.originalPrice, 100_000_000);
  }

  const approxBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (approxBytes > MAX_VEHICLE_DOC_BYTES) {
    throw new Error(
      `Photos for "${payload.title}" exceed Firebase's 1 MB per-vehicle limit. Please remove 1–2 extra photos or use smaller images.`
    );
  }

  return { id, payload };
}

function buildTikTokPostDocPayload(post: TikTokPost, index: number) {
  const id = sanitizeDocId(post.id, 'tt');
  return {
    id,
    payload: {
      id,
      title: clampStr(post.title, 200, ''),
      caption: clampStr(post.caption, 2000, ''),
      tiktokUrl: clampStr(post.tiktokUrl, 500, ''),
      coverImageUrl: clampStr(post.coverImageUrl, 550_000, ''),
      sortOrder: Math.min(Math.max(index, 0), 1000),
      updatedAt: serverTimestamp(),
    },
  };
}

function buildAdminAccessPayload(adminEmails?: string[]) {
  const cleaned = Array.from(
    new Set(
      (adminEmails && adminEmails.length > 0 ? adminEmails : DEFAULT_ADMIN_EMAILS)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@') && e.length <= 254)
    )
  ).slice(0, 20);

  return {
    adminEmails: cleaned.length > 0 ? cleaned : DEFAULT_ADMIN_EMAILS,
    updatedAt: serverTimestamp(),
  };
}

function vehicleFingerprint(vehicle: Vehicle): string {
  return JSON.stringify({
    id: vehicle.id,
    title: vehicle.title,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    price: vehicle.price,
    originalPrice: vehicle.originalPrice ?? null,
    mileage: vehicle.mileage,
    transmission: vehicle.transmission,
    fuelType: vehicle.fuelType,
    color: vehicle.color,
    origin: vehicle.origin,
    imageUrl: vehicle.imageUrl,
    galleryImages: vehicle.galleryImages ?? [],
    description: vehicle.description,
    tiktokUrl: vehicle.tiktokUrl,
    status: vehicle.status,
    featured: vehicle.featured,
    createdAt: vehicle.createdAt,
  });
}

function postFingerprint(post: TikTokPost, index: number): string {
  return JSON.stringify({
    id: post.id,
    title: post.title,
    caption: post.caption,
    tiktokUrl: post.tiktokUrl,
    coverImageUrl: post.coverImageUrl,
    sortOrder: index,
  });
}

export async function fetchAdminAllowlistFromFirestore(): Promise<string[] | null> {
  try {
    const snap = await getDoc(doc(db, 'config', 'adminAccess'));
    if (!snap.exists()) return null;
    const data = snap.data() as { adminEmails?: unknown };
    if (Array.isArray(data.adminEmails)) {
      return data.adminEmails.filter((e): e is string => typeof e === 'string' && Boolean(e.trim()));
    }
    return null;
  } catch {
    return null;
  }
}

export async function checkFirestoreHasShowroom(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'config', 'showroom'));
    return snap.exists();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'config/showroom');
  }
}

export async function fetchRemoteVehicleSummariesFromFirestore(): Promise<
  Array<{ id: string; title: string }>
> {
  try {
    const snap = await getDocs(collection(db, 'vehicles'));
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: typeof data.id === 'string' && data.id.trim() ? data.id : d.id,
        title: String(data.title ?? ''),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'vehicles');
  }
}

export async function syncCatalogVehiclesToFirestore(
  vehicles: Vehicle[],
  legacyDuplicateIds: string[] = []
): Promise<void> {
  for (const vehicle of vehicles) {
    const { id, payload } = buildVehicleDocPayload(vehicle);
    try {
      await setDoc(doc(db, 'vehicles', id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `vehicles/${id}`);
    }
  }

  for (const legacyId of legacyDuplicateIds) {
    const safeId = sanitizeDocId(legacyId, 'veh');
    try {
      await deleteDoc(doc(db, 'vehicles', safeId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `vehicles/${safeId}`);
    }
  }
}

export async function deleteVehicleFromFirestore(vehicleId: string): Promise<void> {
  const exactId = vehicleId.trim();
  if (!exactId) return;
  try {
    await deleteDoc(doc(db, 'vehicles', exactId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `vehicles/${exactId}`);
  }
}

export async function deleteTikTokPostFromFirestore(postId: string): Promise<void> {
  const exactId = postId.trim();
  if (!exactId) return;
  try {
    await deleteDoc(doc(db, 'tiktokPosts', exactId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `tiktokPosts/${exactId}`);
  }
}

export async function syncShowroomStoreToFirestore(
  nextStore: ShowroomStore,
  prevStore?: ShowroomStore | null,
  forceFullSync = false
): Promise<void> {
  const prevVehiclesMap = new Map((prevStore?.vehicles ?? []).map((v) => [v.id, v]));
  const nextVehicleIds = new Set(
    nextStore.vehicles.flatMap((v) => [v.id, sanitizeDocId(v.id, 'veh')])
  );

  const prevSyncablePosts = filterSyncableTikTokPosts(prevStore?.tiktok.posts ?? []);
  const nextSyncablePosts = filterSyncableTikTokPosts(nextStore.tiktok.posts);

  const prevPostsMap = new Map(
    prevSyncablePosts.map((p, idx) => [p.id, { post: p, index: idx }])
  );
  const nextPostIds = new Set(
    nextSyncablePosts.flatMap((p) => [p.id, sanitizeDocId(p.id, 'tt')])
  );

  const showroomConfigChanged =
    forceFullSync ||
    !prevStore ||
    JSON.stringify({
      branding: prevStore.branding,
      hero: prevStore.hero,
      tiktok: buildTikTokHeaderPayload(prevStore.tiktok),
      contact: buildContactPayload(prevStore.contact),
    }) !==
      JSON.stringify({
        branding: nextStore.branding,
        hero: nextStore.hero,
        tiktok: buildTikTokHeaderPayload(nextStore.tiktok),
        contact: buildContactPayload(nextStore.contact),
      });

  if (showroomConfigChanged) {
    try {
      await setDoc(doc(db, 'config', 'showroom'), {
        branding: buildBrandingPayload(nextStore.branding),
        hero: buildHeroPayload(nextStore.hero),
        tiktok: buildTikTokHeaderPayload(nextStore.tiktok),
        contact: buildContactPayload(nextStore.contact),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'config/showroom');
    }
  }

  const adminAccessChanged =
    forceFullSync ||
    !prevStore ||
    JSON.stringify(prevStore.adminEmails ?? []) !== JSON.stringify(nextStore.adminEmails ?? []);

  if (adminAccessChanged) {
    try {
      await setDoc(
        doc(db, 'config', 'adminAccess'),
        buildAdminAccessPayload(nextStore.adminEmails)
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'config/adminAccess');
    }
  }

  // Sync added/updated vehicles
  for (const vehicle of nextStore.vehicles) {
    const prev = prevVehiclesMap.get(vehicle.id);
    if (forceFullSync || !prev || vehicleFingerprint(prev) !== vehicleFingerprint(vehicle)) {
      const { id, payload } = buildVehicleDocPayload(vehicle);
      try {
        await setDoc(doc(db, 'vehicles', id), payload);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `vehicles/${id}`);
      }
    }
  }

  // Delete removed vehicles using exact Firestore document ID
  for (const prevVehicle of prevStore?.vehicles ?? []) {
    const exactId = prevVehicle.id.trim();
    const sanitizedId = sanitizeDocId(prevVehicle.id, 'veh');
    if (exactId && !nextVehicleIds.has(exactId) && !nextVehicleIds.has(sanitizedId)) {
      try {
        await deleteDoc(doc(db, 'vehicles', exactId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `vehicles/${exactId}`);
      }
    }
  }

  // Sync added/updated TikTok posts (skipping blank unsaved drafts)
  for (let i = 0; i < nextSyncablePosts.length; i++) {
    const post = nextSyncablePosts[i];
    const prevEntry = prevPostsMap.get(post.id);
    if (
      forceFullSync ||
      !prevEntry ||
      postFingerprint(prevEntry.post, prevEntry.index) !== postFingerprint(post, i)
    ) {
      const { id, payload } = buildTikTokPostDocPayload(post, i);
      try {
        await setDoc(doc(db, 'tiktokPosts', id), payload);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `tiktokPosts/${id}`);
      }
    }
  }

  // Delete removed TikTok posts using exact Firestore document ID
  for (const prevPost of prevSyncablePosts) {
    const exactId = prevPost.id.trim();
    const sanitizedId = sanitizeDocId(prevPost.id, 'tt');
    if (exactId && !nextPostIds.has(exactId) && !nextPostIds.has(sanitizedId)) {
      try {
        await deleteDoc(doc(db, 'tiktokPosts', exactId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `tiktokPosts/${exactId}`);
      }
    }
  }
}

export async function resetFirestoreToDefaults(): Promise<void> {
  try {
    const [existingVehiclesSnap, existingPostsSnap] = await Promise.all([
      getDocs(collection(db, 'vehicles')),
      getDocs(collection(db, 'tiktokPosts')),
    ]);

    const batch = writeBatch(db);
    for (const d of existingVehiclesSnap.docs) {
      batch.delete(d.ref);
    }
    for (const d of existingPostsSnap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'vehicles');
  }

  await syncShowroomStoreToFirestore(INITIAL_SHOWROOM_STORE, null, true);
}

export interface ShowroomSyncMeta {
  hasConfig: boolean;
  vehiclesLoaded: boolean;
  postsLoaded: boolean;
  allLoaded: boolean;
  remoteVehicles: Vehicle[];
}

function logListenerError(err: unknown, op: OperationType, path: string): void {
  console.warn(`Firestore listener error (${op} ${path}):`, err);
}

export function subscribeShowroomFromFirestore(
  fallbackStore: ShowroomStore,
  onUpdate: (nextStore: ShowroomStore, meta: ShowroomSyncMeta) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  let configLoaded = false;
  let hasConfig = false;
  let configData: RemoteShowroomConfigData | null = null;

  let vehiclesLoaded = false;
  let remoteVehicles: Vehicle[] = [];

  let postsLoaded = false;
  let remotePosts: RemoteTikTokPostEntry[] = [];

  const emitIfReady = () => {
    const merged = mergeShowroomSnapshotState({
      fallbackStore,
      hasConfig,
      configData,
      vehiclesLoaded,
      remoteVehicles,
      postsLoaded,
      remotePosts,
    });
    if (!merged) {
      if (configLoaded && vehiclesLoaded && postsLoaded) {
        onUpdate(fallbackStore, {
          hasConfig,
          vehiclesLoaded,
          postsLoaded,
          allLoaded: true,
          remoteVehicles,
        });
      }
      return;
    }

    onUpdate(merged, {
      hasConfig,
      vehiclesLoaded,
      postsLoaded,
      allLoaded: configLoaded && vehiclesLoaded && postsLoaded,
      remoteVehicles,
    });
  };

  const unsubConfig = onSnapshot(
    doc(db, 'config', 'showroom'),
    (snap) => {
      configLoaded = true;
      hasConfig = snap.exists();
      configData = snap.exists() ? (snap.data() as RemoteShowroomConfigData) : null;
      emitIfReady();
    },
    (err) => {
      logListenerError(err, OperationType.GET, 'config/showroom');
      onError?.(err);
    }
  );

  const unsubVehicles = onSnapshot(
    collection(db, 'vehicles'),
    (snap) => {
      vehiclesLoaded = true;
      remoteVehicles = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            title: String(data.title ?? ''),
            make: String(data.make ?? ''),
            model: String(data.model ?? ''),
            year: Number(data.year ?? 2024),
            price: Number(data.price ?? 0),
            ...(typeof data.originalPrice === 'number' ? { originalPrice: data.originalPrice } : {}),
            mileage: String(data.mileage ?? ''),
            transmission: String(data.transmission ?? ''),
            fuelType: String(data.fuelType ?? ''),
            color: String(data.color ?? ''),
            origin: String(data.origin ?? ''),
            imageUrl: resolvePublicAssetUrl(String(data.imageUrl ?? '')),
            galleryImages: Array.isArray(data.galleryImages)
              ? data.galleryImages
                  .filter((u): u is string => typeof u === 'string')
                  .map((u) => resolvePublicAssetUrl(u))
              : [],
            description: String(data.description ?? ''),
            tiktokUrl: String(data.tiktokUrl ?? ''),
            status:
              data.status === 'reserved' || data.status === 'sold' ? data.status : 'available',
            featured: Boolean(data.featured),
            createdAt: String(data.createdAt ?? ''),
          } satisfies Vehicle;
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      emitIfReady();
    },
    (err) => {
      logListenerError(err, OperationType.LIST, 'vehicles');
      onError?.(err);
    }
  );

  const unsubPosts = onSnapshot(
    collection(db, 'tiktokPosts'),
    (snap) => {
      postsLoaded = true;
      remotePosts = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          title: String(data.title ?? ''),
          caption: String(data.caption ?? ''),
          tiktokUrl: String(data.tiktokUrl ?? ''),
          coverImageUrl: String(data.coverImageUrl ?? ''),
          sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
        };
      });
      emitIfReady();
    },
    (err) => {
      logListenerError(err, OperationType.LIST, 'tiktokPosts');
      onError?.(err);
    }
  );

  return () => {
    unsubConfig();
    unsubVehicles();
    unsubPosts();
  };
}

export function subscribeAdminAccessFromFirestore(
  onUpdate: (adminEmails: string[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'config', 'adminAccess'),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as { adminEmails?: unknown };
        if (Array.isArray(data.adminEmails)) {
          const emails = data.adminEmails.filter(
            (e): e is string => typeof e === 'string' && Boolean(e.trim())
          );
          onUpdate(emails);
        }
      }
    },
    (err) => {
      logListenerError(err, OperationType.GET, 'config/adminAccess');
      onError?.(err);
    }
  );
}

export async function submitInquiryToFirestore(input: {
  name: string;
  phone: string;
  email: string;
  vehicleTitle: string;
  message: string;
}): Promise<CustomerInquiry> {
  const id = `inq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    id,
    name: clampStr(input.name.trim(), 120, ''),
    phone: clampStr(input.phone.trim(), 40, ''),
    email: clampStr(input.email.trim(), 254, ''),
    vehicleTitle: clampStr(input.vehicleTitle.trim(), 200, ''),
    message: clampStr(input.message.trim(), 2000, ''),
    createdAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'inquiries', id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `inquiries/${id}`);
  }
  return {
    id,
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    vehicleTitle: payload.vehicleTitle,
    message: payload.message,
    createdAt: new Date().toISOString(),
  };
}

export async function fetchInquiriesFromFirestore(): Promise<CustomerInquiry[]> {
  try {
    const snap = await getDocs(query(collection(db, 'inquiries'), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const rawCreated = data.createdAt as { toDate?: () => Date } | string | undefined;
      const createdAt =
        rawCreated && typeof rawCreated === 'object' && typeof rawCreated.toDate === 'function'
          ? rawCreated.toDate().toISOString()
          : typeof rawCreated === 'string'
          ? rawCreated
          : new Date().toISOString();
      return {
        id: typeof data.id === 'string' ? data.id : d.id,
        name: String(data.name ?? ''),
        phone: String(data.phone ?? ''),
        email: String(data.email ?? ''),
        vehicleTitle: String(data.vehicleTitle ?? ''),
        message: String(data.message ?? ''),
        createdAt,
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'inquiries');
  }
}
