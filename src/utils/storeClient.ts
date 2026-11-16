import {
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { INITIAL_SHOWROOM_STORE } from '../data/seedData';
import { auth, formatFirestoreUserMessage, googleProvider } from '../firebase';
import type { CustomerInquiry, ShowroomStore } from '../types/showroom';
import {
  checkFirestoreHasShowroom,
  fetchAdminAllowlistFromFirestore,
  fetchInquiriesFromFirestore,
  resetFirestoreToDefaults,
  submitInquiryToFirestore,
  syncShowroomStoreToFirestore,
} from './firestoreStore';
import { isAuthorizedAdminEmail } from './inventory';

const LOCAL_STORAGE_KEY = 'alif_car_import_store_v1';

export function cacheShowroomStoreLocally(store: ShowroomStore): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore local cache quota overflow; Firestore is the primary store
  }
}

export function readCachedShowroomStore(): ShowroomStore | null {
  try {
    const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as ShowroomStore;
    if (parsed && Array.isArray(parsed.vehicles)) {
      return parsed;
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

  const remoteAllowlist = await fetchAdminAllowlistFromFirestore();
  const combinedAllowlist = [...(extraAdminEmails ?? []), ...(remoteAllowlist ?? [])];

  if (!isAuthorizedAdminEmail(signedEmail, combinedAllowlist)) {
    await signOut(auth).catch(() => undefined);
    throw new Error(
      `Account "${signedEmail}" is not authorized. Please sign in with alifcarimports@gmail.com.`
    );
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

  const remoteAllowlist = await fetchAdminAllowlistFromFirestore();
  const combinedAllowlist = [
    ...(extraAdminEmails ?? []),
    ...(remoteAllowlist ?? []),
  ];

  if (!isAuthorizedAdminEmail(email, combinedAllowlist)) {
    await signOut(auth).catch(() => undefined);
    throw new Error(
      `Account "${email}" is not authorized. Please sign in with alifcarimports@gmail.com.`
    );
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

  const remoteAllowlist = await fetchAdminAllowlistFromFirestore();
  const combinedAllowlist = [
    ...(extraAdminEmails ?? []),
    ...(remoteAllowlist ?? []),
  ];

  if (!isAuthorizedAdminEmail(user.email, combinedAllowlist)) {
    return { authenticated: false, email: null };
  }

  return { authenticated: true, email: user.email };
}

export async function ensureFirestoreSeeded(seedStore: ShowroomStore): Promise<void> {
  if (!auth.currentUser) return;
  const hasRemote = await checkFirestoreHasShowroom();
  if (!hasRemote) {
    await syncShowroomStoreToFirestore(seedStore, null, true);
  }
}

export async function logoutAdmin(): Promise<void> {
  await signOut(auth).catch(() => undefined);
}

export async function loadShowroomStore(): Promise<ShowroomStore> {
  // Check Express dev server store first if present (helpful for initial seeding before Firebase has docs)
  try {
    const response = await fetch('/api/store', { credentials: 'same-origin' });
    if (response.ok) {
      const json = (await response.json()) as { initialized?: boolean; data?: ShowroomStore | null };
      if (json.initialized && json.data && Array.isArray(json.data.vehicles)) {
        cacheShowroomStoreLocally(json.data);
        return json.data;
      }
    }
  } catch {
    // Expected on static hosting (e.g. GitHub Pages) without Express backend
  }

  return readCachedShowroomStore() ?? INITIAL_SHOWROOM_STORE;
}

export async function saveShowroomStore(
  store: ShowroomStore,
  prevStore?: ShowroomStore | null
): Promise<void> {
  cacheShowroomStoreLocally(store);

  if (!auth.currentUser) {
    throw new Error('Please sign in with Google (alifcarimports@gmail.com) to publish changes.');
  }

  try {
    await syncShowroomStoreToFirestore(store, prevStore, !prevStore);
  } catch (err) {
    throw new Error(formatFirestoreUserMessage(err));
  }
}

export async function resetShowroomStore(): Promise<ShowroomStore> {
  if (!auth.currentUser) {
    throw new Error('Please sign in with Google (alifcarimports@gmail.com) to reset defaults.');
  }

  try {
    await resetFirestoreToDefaults();
  } catch (err) {
    throw new Error(formatFirestoreUserMessage(err));
  }

  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
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
    return await submitInquiryToFirestore(input);
  } catch (err) {
    throw new Error(formatFirestoreUserMessage(err));
  }
}

export async function fetchCustomerInquiries(): Promise<CustomerInquiry[]> {
  try {
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

export async function fetchTikTokVideoMetadata(url: string): Promise<TikTokMetadataResult> {
  const response = await fetch('/api/tiktok-metadata', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const json = (await response.json().catch(() => ({}))) as Partial<TikTokMetadataResult> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(json.error || 'Unable to fetch video details from TikTok.');
  }
  return {
    resolvedUrl: json.resolvedUrl || url,
    videoId: json.videoId || null,
    description: json.description || '',
    suggestedTitle: json.suggestedTitle || '',
    coverImageUrl: json.coverImageUrl || '',
    coverOptions: Array.isArray(json.coverOptions) ? json.coverOptions : [],
    authorHandle: json.authorHandle || '',
  };
}
