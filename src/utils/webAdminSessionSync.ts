import type { FirebaseApp } from 'firebase/app';
import { signOut, type Auth, type User } from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  checkCloudflareSecurityForceSignOut,
  checkCloudflareSessionStatus,
  isCloudflareBackendEnabled,
  revokeCloudflareAdminSession,
  upsertCloudflareAdminSession,
} from './cloudflareStore';
import {
  extractAppTwoFactorConfig,
  type ExtractedTwoFactorConfig,
} from './totp';

export const WEB_ADMIN_FIRESTORE_DB_ID =
  'ai-studio-alifcarportal-c5b73261-7322-4966-b5e2-59c51963e99b';
const DEVICE_ID_KEY = 'alif_web_admin_device_id';
const VERIFIED_SESSION_KEY = 'alif_web_admin_verified_uid';

export interface WebAdminSessionOptions {
  onForcedSignOut?: () => void;
  skipInitialSecurityCheck?: boolean;
}

let unsubscribeSessionWatch: Unsubscribe | null = null;
let unsubscribeSecurityWatch: Unsubscribe | null = null;
let cloudflarePollTimer: number | null = null;
let activeWatchedSessionKey: string | null = null;
let watchGeneration = 0;

export function sanitizeSessionIdPart(value: unknown): string {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}

export function buildWebAdminSessionId(uid: string, deviceId: string): string {
  const cleanUid = sanitizeSessionIdPart(uid).slice(0, 10) || 'admin';
  const cleanDev = sanitizeSessionIdPart(deviceId).slice(0, 12) || 'browser';
  return `web_${cleanUid}_${cleanDev}`;
}

export function extractFirestoreTimestampMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (
    typeof value === 'object' &&
    'seconds' in value &&
    typeof (value as { seconds?: unknown }).seconds === 'number'
  ) {
    const seconds = (value as { seconds: number }).seconds;
    const nanoseconds =
      'nanoseconds' in value && typeof (value as { nanoseconds?: unknown }).nanoseconds === 'number'
        ? (value as { nanoseconds: number }).nanoseconds
        : 0;
    const millis = seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export function parseAuthTimeMillis(authTime: unknown): number | null {
  if (typeof authTime === 'number') {
    return Number.isFinite(authTime) ? authTime : null;
  }
  if (authTime instanceof Date) {
    const millis = authTime.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof authTime === 'string' && authTime.trim()) {
    const millis = new Date(authTime).getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

export function shouldForceSignOutForSecurityTimestamp(
  authTime: unknown,
  forceSignOutBefore: unknown
): boolean {
  const authTimeMs = parseAuthTimeMillis(authTime);
  const cutoffMs = extractFirestoreTimestampMillis(forceSignOutBefore);
  if (authTimeMs === null || cutoffMs === null) {
    return false;
  }
  return authTimeMs < cutoffMs;
}

export function detectBrowserDeviceName(userAgent?: string): string {
  const ua =
    userAgent ??
    (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '');

  const browser = /SamsungBrowser\//i.test(ua)
    ? 'Samsung Internet'
    : /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
    ? 'Chrome'
    : /Safari\//.test(ua) && !/Chrome\//.test(ua)
    ? 'Safari'
    : /Firefox\//.test(ua)
    ? 'Firefox'
    : 'Web Browser';

  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS'
    : /Windows/i.test(ua)
    ? 'Windows'
    : /Mac OS X/i.test(ua)
    ? 'macOS'
    : /Linux/i.test(ua)
    ? 'Linux'
    : 'Web';

  return `${browser} on ${os}`.slice(0, 160);
}

export function getFallbackLocation(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Web';
    return tz.replace(/_/g, ' ').slice(0, 160);
  } catch {
    return 'Website';
  }
}

export function getOrCreateWebDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'browser';
  }
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (
        window.crypto?.randomUUID?.() ||
        `${Date.now()}_${Math.random().toString(36).slice(2)}`
      ).replace(/-/g, '');
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now()}_${Math.random().toString(36).slice(2)}`.replace(/-/g, '');
  }
}

export function markWebAdminSessionVerified(uid: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(VERIFIED_SESSION_KEY, uid);
    }
  } catch {
    // Ignore sessionStorage restrictions
  }
}

export function isWebAdminSessionVerified(uid: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(VERIFIED_SESSION_KEY) === uid;
  } catch {
    return false;
  }
}

export function clearWebAdminSessionVerified(): void {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(VERIFIED_SESSION_KEY);
    }
  } catch {
    // Ignore
  }
}

function generateAlertId(now: number): string {
  const randomSeed =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${now}_${Math.random().toString(36).slice(2)}`;
  return `alert_web_${sanitizeSessionIdPart(randomSeed).slice(0, 16)}`;
}

export function stopWebSessionWatcher(): void {
  watchGeneration += 1;
  if (unsubscribeSessionWatch) {
    unsubscribeSessionWatch();
    unsubscribeSessionWatch = null;
  }
  if (unsubscribeSecurityWatch) {
    unsubscribeSecurityWatch();
    unsubscribeSecurityWatch = null;
  }
  if (cloudflarePollTimer !== null && typeof window !== 'undefined') {
    window.clearInterval(cloudflarePollTimer);
    cloudflarePollTimer = null;
  }
  activeWatchedSessionKey = null;
}

async function evaluateSecurityForceSignOut(
  auth: Auth,
  user: User,
  securityData: Record<string, unknown> | undefined,
  options?: WebAdminSessionOptions
): Promise<boolean> {
  const forceSignOutBefore = securityData?.forceSignOutBefore;
  if (extractFirestoreTimestampMillis(forceSignOutBefore) === null) {
    return false;
  }

  try {
    const activeUser = auth.currentUser ?? user;
    const tokenResult = await activeUser.getIdTokenResult();
    const authTimeMs = new Date(tokenResult.authTime).getTime();
    if (shouldForceSignOutForSecurityTimestamp(authTimeMs, forceSignOutBefore)) {
      stopWebSessionWatcher();
      options?.onForcedSignOut?.();
      await signOut(auth).catch(() => undefined);
      return true;
    }
  } catch (err) {
    console.warn('Unable to evaluate config/security forceSignOutBefore:', err);
  }
  return false;
}

/**
 * Checks config/security.forceSignOutBefore against the signed-in user's ID token auth_time.
 * Returns true if the user was signed out because their token predates a password change
 * or global sign-out.
 */
export async function checkForceSignOutBySecurityConfig(
  auth: Auth,
  firebaseApp: FirebaseApp,
  user: User | null | undefined,
  options?: WebAdminSessionOptions
): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  if (isCloudflareBackendEnabled()) {
    const cfForced = await checkCloudflareSecurityForceSignOut(
      auth,
      user,
      options?.onForcedSignOut
    );
    if (cfForced) return true;
  }
  try {
    const db = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
    const securitySnap = await getDoc(doc(db, 'config', 'security'));
    if (!securitySnap.exists()) {
      return false;
    }
    return await evaluateSecurityForceSignOut(auth, user, securitySnap.data(), options);
  } catch (err) {
    console.warn('Unable to read config/security document:', err);
    return false;
  }
}

/**
 * Reads 2FA / Authenticator settings saved by the companion Android app in Firestore
 * (checks config/security, config/twoFactor, and admins/{uid} on the shared DB).
 */
export async function readFirestoreAppTwoFactorConfig(
  firebaseApp: FirebaseApp,
  user: User | null | undefined
): Promise<ExtractedTwoFactorConfig> {
  if (!user || !user.emailVerified) {
    return { enabled: false, secret: '', backupCodes: [] };
  }

  const dbCandidates = [
    () => getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID),
    () => getFirestore(firebaseApp),
  ];

  const docPaths: [string, string][] = [
    ['config', 'security'],
    ['admins', user.uid],
    ['users', user.uid],
    ['config', 'twoFactor'],
  ];

  let enabled = false;
  let secret = '';
  const backupCodes: string[] = [];

  for (const getDb of dbCandidates) {
    let targetDb;
    try {
      targetDb = getDb();
    } catch {
      continue;
    }

    for (const [col, id] of docPaths) {
      try {
        const snap = await getDoc(doc(targetDb, col, id));
        if (!snap.exists()) continue;
        const extracted = extractAppTwoFactorConfig(snap.data() as Record<string, unknown>);
        if (extracted.enabled) enabled = true;
        if (!secret && extracted.secret) secret = extracted.secret;
        for (const c of extracted.backupCodes) {
          if (!backupCodes.includes(c)) backupCodes.push(c);
        }
        if (enabled && secret) {
          return { enabled, secret, backupCodes };
        }
      } catch {
        // Ignore missing permissions or absent docs on candidate paths
      }
    }
    if (enabled || secret) break;
  }

  return { enabled, secret, backupCodes };
}

/**
 * Silently reports an authorized website admin login to the shared Firestore database
 * so the Android Admin app can display active website sessions, show login alerts,
 * and remotely revoke website sessions or force sign-out on password changes.
 * Adds no visible UI on the website.
 */
export async function startWebAdminSession(
  auth: Auth,
  firebaseApp: FirebaseApp,
  user: User | null | undefined,
  options?: WebAdminSessionOptions
): Promise<boolean> {
  if (!user || !user.emailVerified) return false;

  const deviceId = getOrCreateWebDeviceId().slice(0, 128);
  const sessionId = buildWebAdminSessionId(user.uid, deviceId);
  const watchKey = `${user.uid}:${sessionId}`;
  const startGen = watchGeneration;

  try {
    const deviceName = detectBrowserDeviceName();
    const email = (user.email || '').trim().slice(0, 254);
    const location = getFallbackLocation();
    const userAgent = (
      typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
    ).slice(0, 300);
    const now = Date.now();

    if (isCloudflareBackendEnabled()) {
      if (!options?.skipInitialSecurityCheck) {
        const forcedOut = await checkCloudflareSecurityForceSignOut(
          auth,
          user,
          options?.onForcedSignOut
        );
        if (forcedOut || startGen !== watchGeneration) {
          return false;
        }
      }

      await upsertCloudflareAdminSession(user, sessionId, {
        deviceId,
        deviceName,
        platform: 'Website',
        location,
        loginAtMillis: now,
        status: 'active',
        userAgent,
        forceActivate: true,
      }).catch((err) => {
        console.warn('Unable to sync Cloudflare admin session:', err);
      });

      if (startGen !== watchGeneration) return false;

      if (activeWatchedSessionKey === watchKey && cloudflarePollTimer !== null) {
        return true;
      }

      stopWebSessionWatcher();
      const activeGen = watchGeneration;
      activeWatchedSessionKey = watchKey;

      if (typeof window !== 'undefined') {
        cloudflarePollTimer = window.setInterval(() => {
          if (activeGen !== watchGeneration) return;
          void (async () => {
            try {
              const st = await checkCloudflareSessionStatus(user, sessionId);
              if (activeGen !== watchGeneration) return;
              const tokenResult = await user.getIdTokenResult();
              const authTimeMs = new Date(tokenResult.authTime).getTime();
              const cutOffHit =
                st.forceSignOutBeforeMs > 0 &&
                Number.isFinite(authTimeMs) &&
                authTimeMs < st.forceSignOutBeforeMs;
              if (st.revoked || cutOffHit) {
                clearWebAdminSessionVerified();
                stopWebSessionWatcher();
                options?.onForcedSignOut?.();
                await signOut(auth).catch(() => undefined);
              }
            } catch (err) {
              const status = (err as { status?: number })?.status;
              if (status === 401) {
                clearWebAdminSessionVerified();
                stopWebSessionWatcher();
                options?.onForcedSignOut?.();
                await signOut(auth).catch(() => undefined);
              }
            }
          })();
        }, 15_000);
      }

      // Also mirror session & login alert to the shared Firestore database so the
      // companion Android app's Current Devices count and Login Alerts see web logins.
      try {
        const sharedDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
        const sessionRef = doc(sharedDb, 'adminSessions', sessionId);
        const existingSnap = await getDoc(sessionRef);
        if (activeGen === watchGeneration) {
          if (!existingSnap.exists()) {
            await setDoc(sessionRef, {
              id: sessionId,
              uid: user.uid.slice(0, 128),
              deviceId,
              deviceName,
              platform: 'Website',
              email,
              location,
              loginAtMillis: now,
              lastActiveMillis: now,
              status: 'active',
              userAgent,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(sessionRef, {
              deviceName,
              platform: 'Website',
              email,
              location,
              loginAtMillis: now,
              lastActiveMillis: now,
              status: 'active',
              userAgent,
              updatedAt: serverTimestamp(),
            });
          }

          const alertFlagKey = `alif_web_alert_sent_${user.uid}_${user.metadata?.lastSignInTime || ''}`;
          let alertAlreadySent = false;
          try {
            alertAlreadySent = Boolean(window.sessionStorage.getItem(alertFlagKey));
          } catch {
            alertAlreadySent = false;
          }

          if (!alertAlreadySent) {
            const alertId = generateAlertId(now);
            await setDoc(doc(sharedDb, 'loginAlerts', alertId), {
              id: alertId,
              sessionId,
              uid: user.uid.slice(0, 128),
              email,
              deviceName,
              platform: 'Website',
              location,
              timestampMillis: now,
              decision: 'pending',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            try {
              window.sessionStorage.setItem(alertFlagKey, '1');
            } catch {
              // Ignore sessionStorage restrictions
            }
          }

          unsubscribeSessionWatch = onSnapshot(
            sessionRef,
            (snap) => {
              if (activeGen !== watchGeneration) return;
              if (snap.exists() && snap.data()?.status === 'revoked') {
                clearWebAdminSessionVerified();
                stopWebSessionWatcher();
                options?.onForcedSignOut?.();
                void signOut(auth);
              }
            },
            () => undefined
          );

          unsubscribeSecurityWatch = onSnapshot(
            doc(sharedDb, 'config', 'security'),
            (snap) => {
              if (activeGen !== watchGeneration || !snap.exists()) return;
              void evaluateSecurityForceSignOut(auth, user, snap.data(), options);
            },
            () => undefined
          );
        }
      } catch {
        // Non-fatal if Firestore quota or rules restrict mirroring
      }

      return true;
    }

    const db = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
    const securityRef = doc(db, 'config', 'security');

    // Enforce config/security.forceSignOutBefore before writing session or login alert docs
    if (!options?.skipInitialSecurityCheck) {
      const forcedOutBeforeSync = await checkForceSignOutBySecurityConfig(
        auth,
        firebaseApp,
        user,
        options
      );
      if (forcedOutBeforeSync || startGen !== watchGeneration) {
        return false;
      }
    }

    const sessionRef = doc(db, 'adminSessions', sessionId);
    const existingSnap = await getDoc(sessionRef);
    if (startGen !== watchGeneration) return false;

    if (!existingSnap.exists()) {
      await setDoc(sessionRef, {
        id: sessionId,
        uid: user.uid.slice(0, 128),
        deviceId,
        deviceName,
        platform: 'Website',
        email,
        location,
        loginAtMillis: now,
        lastActiveMillis: now,
        status: 'active',
        userAgent,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(sessionRef, {
        deviceName,
        platform: 'Website',
        email,
        location,
        loginAtMillis: now,
        lastActiveMillis: now,
        status: 'active',
        userAgent,
        updatedAt: serverTimestamp(),
      });
    }

    if (startGen !== watchGeneration) return false;

    const alertFlagKey = `alif_web_alert_sent_${user.uid}_${user.metadata?.lastSignInTime || ''}`;
    let alertAlreadySent = false;
    try {
      alertAlreadySent = Boolean(window.sessionStorage.getItem(alertFlagKey));
    } catch {
      alertAlreadySent = false;
    }

    if (!alertAlreadySent) {
      const alertId = generateAlertId(now);
      await setDoc(doc(db, 'loginAlerts', alertId), {
        id: alertId,
        sessionId,
        uid: user.uid.slice(0, 128),
        email,
        deviceName,
        platform: 'Website',
        location,
        timestampMillis: now,
        decision: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      try {
        window.sessionStorage.setItem(alertFlagKey, '1');
      } catch {
        // Ignore sessionStorage restrictions
      }
    }

    if (startGen !== watchGeneration) return false;

    if (
      activeWatchedSessionKey === watchKey &&
      unsubscribeSessionWatch &&
      unsubscribeSecurityWatch
    ) {
      return true;
    }

    // Attach live watchers for per-session revocation and global password/security sign-out
    stopWebSessionWatcher();
    const activeGen = watchGeneration;
    activeWatchedSessionKey = watchKey;

    unsubscribeSessionWatch = onSnapshot(
      sessionRef,
      (snap) => {
        if (activeGen !== watchGeneration) return;
        if (snap.exists() && snap.data()?.status === 'revoked') {
          stopWebSessionWatcher();
          options?.onForcedSignOut?.();
          void signOut(auth);
        }
      },
      (err) => {
        console.warn('Web admin session watcher error:', err);
      }
    );

    unsubscribeSecurityWatch = onSnapshot(
      securityRef,
      (snap) => {
        if (activeGen !== watchGeneration || !snap.exists()) return;
        void evaluateSecurityForceSignOut(auth, user, snap.data(), options);
      },
      (err) => {
        console.warn('Web admin security config watcher error:', err);
      }
    );

    return true;
  } catch (err) {
    console.warn('Unable to sync website admin session:', err);
    return true;
  }
}

/**
 * Marks the current browser admin session as revoked in Firestore right before signOut(auth).
 */
export async function endWebAdminSession(
  firebaseApp: FirebaseApp,
  user: User | null | undefined
): Promise<void> {
  clearWebAdminSessionVerified();
  stopWebSessionWatcher();
  if (!user) return;
  try {
    const deviceId = getOrCreateWebDeviceId().slice(0, 128);
    const sessionId = buildWebAdminSessionId(user.uid, deviceId);
    if (isCloudflareBackendEnabled()) {
      await revokeCloudflareAdminSession(user, sessionId).catch(() => undefined);
    }
    const db = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
    await updateDoc(doc(db, 'adminSessions', sessionId), {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Unable to mark website admin session revoked:', err);
  }
}
