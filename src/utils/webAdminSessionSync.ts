import type { FirebaseApp } from 'firebase/app';
import { signOut, type Auth, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  checkCloudflareSecurityForceSignOut,
  checkCloudflareSessionStatus,
  isCloudflareBackendEnabled,
  revokeCloudflareAdminSession,
  upsertCloudflareAdminSession,
  type CloudflareAdminSession,
  type CloudflareLoginAlert,
  type CloudflareSecurityStatus,
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
      for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = window.sessionStorage.key(i);
        if (key && key.startsWith('alif_web_alert_sent_')) {
          window.sessionStorage.removeItem(key);
        }
      }
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

export function extractEmailListFromDoc(data: Record<string, unknown> | undefined): string[] {
  if (!data || typeof data !== 'object') return [];
  const out: string[] = [];
  const addEmail = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const lower = raw.trim().toLowerCase();
    if (lower.includes('@') && !out.includes(lower)) {
      out.push(lower);
    }
  };

  const keys = [
    'adminEmails',
    'allowedEmails',
    'authorizedEmails',
    'grantedEmails',
    'approvedEmails',
    'emails',
    'admins',
    'members',
    'users',
    'accessList',
  ];

  for (const key of keys) {
    const val = data[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') {
          addEmail(item);
        } else if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const status = String(obj.status ?? obj.decision ?? '').toLowerCase();
          const revoked =
            obj.revoked === true ||
            obj.disabled === true ||
            status === 'revoked' ||
            status === 'denied' ||
            status === 'rejected';
          if (!revoked) {
            addEmail(obj.email ?? obj.adminEmail ?? obj.userEmail);
          }
        }
      }
    } else if (val && typeof val === 'object') {
      for (const [mapKey, mapVal] of Object.entries(val as Record<string, unknown>)) {
        if (mapKey.includes('@')) {
          if (mapVal === true || mapVal === 'approved' || mapVal === 'active' || mapVal === 'admin') {
            addEmail(mapKey);
          } else if (mapVal && typeof mapVal === 'object') {
            const mObj = mapVal as Record<string, unknown>;
            const st = String(mObj.status ?? mObj.decision ?? '').toLowerCase();
            if (mObj.revoked !== true && st !== 'revoked' && st !== 'denied') {
              addEmail(mapKey);
            }
          }
        } else if (mapVal && typeof mapVal === 'object') {
          const mObj = mapVal as Record<string, unknown>;
          const st = String(mObj.status ?? mObj.decision ?? '').toLowerCase();
          if (mObj.revoked !== true && st !== 'revoked' && st !== 'denied') {
            addEmail(mObj.email);
          }
        }
      }
    }
  }

  return out;
}

/**
 * Checks whether the signed-in user or email has been granted admin access on the
 * companion mobile app across common Firestore documents, collections, and approved alerts.
 */
export async function checkFirestoreAdminAuthorization(
  firebaseApp: FirebaseApp,
  user: User | null | undefined,
  email: string,
  timeoutMs = 2500
): Promise<{ authorized: boolean; adminEmails: string[] }> {
  const empty = { authorized: false, adminEmails: [] as string[] };
  const normalizedEmail = email.trim().toLowerCase();
  if (!user || !user.emailVerified || !normalizedEmail) {
    return empty;
  }

  let targetDb;
  try {
    targetDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
  } catch {
    return empty;
  }

  const checkPromise = (async (): Promise<{ authorized: boolean; adminEmails: string[] }> => {
    const docPaths: [string, string][] = [
      ['config', 'adminAccess'],
      ['config', 'security'],
      ['config', 'admins'],
      ['config', 'access'],
      ['admins', user.uid],
      ['admins', normalizedEmail],
      ['adminAccess', user.uid],
      ['adminAccess', normalizedEmail],
      ['authorizedAdmins', normalizedEmail],
      ['allowedAdmins', normalizedEmail],
      ['adminUsers', user.uid],
      ['adminUsers', normalizedEmail],
      ['users', user.uid],
    ];

    const [docResults, queryResults] = await Promise.all([
      Promise.allSettled(docPaths.map(([col, id]) => getDoc(doc(targetDb, col, id)))),
      Promise.allSettled([
        getDocs(query(collection(targetDb, 'admins'), where('email', '==', normalizedEmail), limit(5))),
        getDocs(query(collection(targetDb, 'allowedAdmins'), where('email', '==', normalizedEmail), limit(5))),
        getDocs(query(collection(targetDb, 'loginAlerts'), where('email', '==', normalizedEmail), limit(10))),
      ]),
    ]);

    const adminEmails: string[] = [];
    let authorized = false;

    docResults.forEach((res, idx) => {
      if (res.status !== 'fulfilled' || !res.value.exists()) return;
      const data = res.value.data() as Record<string, unknown>;
      const [col] = docPaths[idx];

      for (const em of extractEmailListFromDoc(data)) {
        if (!adminEmails.includes(em)) adminEmails.push(em);
      }
      if (adminEmails.includes(normalizedEmail)) {
        authorized = true;
      }

      if (
        col === 'admins' ||
        col === 'adminAccess' ||
        col === 'authorizedAdmins' ||
        col === 'allowedAdmins' ||
        col === 'adminUsers'
      ) {
        const status = String(data.status ?? data.decision ?? '').toLowerCase();
        const revoked =
          data.revoked === true ||
          data.disabled === true ||
          status === 'revoked' ||
          status === 'denied' ||
          status === 'rejected';
        if (!revoked) {
          authorized = true;
        }
      }

      if (col === 'users') {
        const role = String(data.role ?? '').toLowerCase();
        if (
          role === 'admin' ||
          role === 'owner' ||
          data.isAdmin === true ||
          data.adminAccess === true ||
          data.accessGranted === true
        ) {
          authorized = true;
        }
      }
    });

    // Check collection queries (admins by email, allowedAdmins by email, approved loginAlerts)
    queryResults.forEach((qRes, idx) => {
      if (qRes.status !== 'fulfilled') return;
      for (const snap of qRes.value.docs) {
        const data = snap.data() as Record<string, unknown>;
        const status = String(data.status ?? data.decision ?? '').toLowerCase();
        if (idx === 0 || idx === 1) {
          const revoked =
            data.revoked === true ||
            data.disabled === true ||
            status === 'revoked' ||
            status === 'denied' ||
            status === 'rejected';
          if (!revoked) {
            authorized = true;
          }
        } else if (idx === 2) {
          const isAccessReq =
            String(data.alertType ?? data.type ?? '').includes('unauth') ||
            String(data.type ?? '') === 'access_request' ||
            data.requestAccess === true ||
            snap.id.startsWith('unauth_');
          if (isAccessReq && (status === 'approved' || status === 'granted')) {
            authorized = true;
          }
        }
      }
    });

    return { authorized, adminEmails };
  })();

  const timeoutPromise = new Promise<{ authorized: boolean; adminEmails: string[] }>((resolve) => {
    setTimeout(() => resolve(empty), timeoutMs);
  });

  return Promise.race([checkPromise, timeoutPromise]);
}

/**
 * Reads 2FA / Authenticator settings saved by the companion Android app in Firestore
 * across common security document paths in parallel with a fast 2.5s timeout.
 */
export async function readFirestoreAppTwoFactorConfig(
  firebaseApp: FirebaseApp,
  user: User | null | undefined,
  timeoutMs = 2500
): Promise<ExtractedTwoFactorConfig> {
  const empty: ExtractedTwoFactorConfig = { enabled: false, secret: '', backupCodes: [] };
  if (!user || !user.emailVerified) {
    return empty;
  }

  let targetDb;
  try {
    targetDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
  } catch {
    return empty;
  }

  const readPromise = (async (): Promise<ExtractedTwoFactorConfig> => {
    const docPaths: [string, string][] = [
      ['config', 'security'],
      ['config', 'adminAccess'],
      ['config', 'twoFactor'],
      ['config', 'totp'],
      ['config', 'auth'],
      ['security', 'config'],
      ['security', 'totp'],
      ['settings', 'security'],
      ['adminSecurity', 'config'],
      ['adminSecurity', user.uid],
      ['admins', user.uid],
      ['users', user.uid],
    ];
    const results = await Promise.allSettled(
      docPaths.map(([col, id]) => getDoc(doc(targetDb, col, id)))
    );

    let enabled = false;
    let secret = '';
    const backupCodes: string[] = [];

    for (const res of results) {
      if (res.status !== 'fulfilled' || !res.value.exists()) continue;
      const extracted = extractAppTwoFactorConfig(
        res.value.data() as Record<string, unknown>,
        user.uid
      );
      if (extracted.enabled) enabled = true;
      if (!secret && extracted.secret) secret = extracted.secret;
      for (const c of extracted.backupCodes) {
        if (!backupCodes.includes(c)) backupCodes.push(c);
      }
    }

    return { enabled, secret, backupCodes };
  })();

  const timeoutPromise = new Promise<ExtractedTwoFactorConfig>((resolve) => {
    setTimeout(() => resolve(empty), timeoutMs);
  });

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Sends a pending admin access-grant alert to the shared Firestore database
 * so the companion mobile app notifies the owner to Grant or Deny access.
 */
export async function createFirestoreAccessGrantRequest(
  firebaseApp: FirebaseApp,
  user: User,
  payload: {
    deviceId: string;
    deviceName: string;
    platform: string;
    location: string;
  }
): Promise<{ ok: boolean; alertId: string }> {
  const now = Date.now();
  const alertId = `unauth_web_${sanitizeSessionIdPart(user.uid).slice(0, 10)}_${now.toString(36)}`;
  const email = (user.email || '').trim().toLowerCase().slice(0, 254);

  try {
    const sharedDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
    const sessionId = buildWebAdminSessionId(user.uid, payload.deviceId);
    // Exact canonical 11-key schema matching the companion mobile app's loginAlerts rules
    const canonicalLoginAlertDoc = {
      id: alertId,
      sessionId,
      uid: user.uid.slice(0, 128),
      email,
      deviceName: `${payload.deviceName} (Access Request)`.slice(0, 160),
      platform: payload.platform.slice(0, 40),
      location: payload.location.slice(0, 160),
      timestampMillis: now,
      decision: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const extendedRequestDoc = {
      ...canonicalLoginAlertDoc,
      deviceId: payload.deviceId.slice(0, 128),
      status: 'pending',
      alertType: 'unauthorized_email',
      type: 'access_request',
      requestAccess: true,
    };

    const writes = await Promise.allSettled([
      setDoc(doc(sharedDb, 'loginAlerts', alertId), canonicalLoginAlertDoc),
      setDoc(doc(sharedDb, 'adminAccessRequests', alertId), extendedRequestDoc),
      setDoc(doc(sharedDb, 'accessRequests', alertId), extendedRequestDoc),
    ]);

    const anySucceeded = writes.some((w) => w.status === 'fulfilled');
    return { ok: anySucceeded, alertId };
  } catch {
    return { ok: false, alertId };
  }
}

export async function pollFirestoreAccessGrantRequest(
  firebaseApp: FirebaseApp,
  user: User,
  email: string,
  alertId: string
): Promise<{ decision: string; authorized: boolean }> {
  try {
    const sharedDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
    const [authCheck, alertRes, reqRes] = await Promise.allSettled([
      checkFirestoreAdminAuthorization(firebaseApp, user, email, 2000),
      alertId ? getDoc(doc(sharedDb, 'loginAlerts', alertId)) : Promise.resolve(null),
      alertId ? getDoc(doc(sharedDb, 'adminAccessRequests', alertId)) : Promise.resolve(null),
    ]);

    if (authCheck.status === 'fulfilled' && authCheck.value.authorized) {
      return { decision: 'approved', authorized: true };
    }

    for (const res of [alertRes, reqRes]) {
      if (res.status === 'fulfilled' && res.value && res.value.exists()) {
        const d = res.value.data() as Record<string, unknown>;
        const dec = String(d.decision ?? d.status ?? 'pending').toLowerCase();
        if (dec === 'approved' || dec === 'granted') {
          return { decision: 'approved', authorized: true };
        }
        if (dec === 'denied' || dec === 'rejected') {
          return { decision: 'denied', authorized: false };
        }
      }
    }
    return { decision: 'pending', authorized: false };
  } catch {
    return { decision: 'pending', authorized: false };
  }
}

export async function createFirestorePendingVerificationAlert(
  firebaseApp: FirebaseApp,
  user: User,
  payload: {
    sessionId: string;
    deviceName: string;
    platform: string;
    location: string;
  }
): Promise<{ ok: boolean; alertId: string; code: string }> {
  const now = Date.now();
  const alertId = generateAlertId(now);
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const code = String(bytes[0] % 1_000_000).padStart(6, '0');
  const email = (user.email || '').trim().toLowerCase().slice(0, 254);

  const canonicalDoc = {
    id: alertId,
    sessionId: payload.sessionId,
    uid: user.uid.slice(0, 128),
    email,
    deviceName: `${payload.deviceName} (Code: ${code})`.slice(0, 160),
    platform: payload.platform.slice(0, 40),
    location: payload.location.slice(0, 160),
    timestampMillis: now,
    decision: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const sharedDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
    try {
      await setDoc(doc(sharedDb, 'loginAlerts', alertId), {
        ...canonicalDoc,
        verificationCode: code,
      });
    } catch {
      // Fallback to strict 11-key schema if Firestore rules enforce keys().hasOnly(...)
      await setDoc(doc(sharedDb, 'loginAlerts', alertId), canonicalDoc);
    }
    return { ok: true, alertId, code };
  } catch {
    return { ok: false, alertId, code };
  }
}

export async function pollFirestoreVerificationAlert(
  firebaseApp: FirebaseApp,
  alertId: string
): Promise<{ status: string }> {
  try {
    const sharedDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
    const snap = await getDoc(doc(sharedDb, 'loginAlerts', alertId));
    if (!snap.exists()) return { status: 'pending' };
    const data = snap.data() as Record<string, unknown>;
    const dec = String(data.decision ?? data.status ?? 'pending').toLowerCase();
    if (dec === 'approved' || dec === 'granted') return { status: 'approved' };
    if (dec === 'denied' || dec === 'rejected') return { status: 'denied' };
    return { status: 'pending' };
  } catch {
    return { status: 'pending' };
  }
}

/**
 * Firestore fallback for Admin -> Security & Devices when Cloudflare Worker v2
 * is not deployed yet, reading shared config/security, adminSessions, and loginAlerts.
 */
export async function readFirestoreSecurityDashboardData(
  firebaseApp: FirebaseApp,
  user: User | null | undefined
): Promise<{
  security: CloudflareSecurityStatus;
  sessions: CloudflareAdminSession[];
  activeCount: number;
  alerts: CloudflareLoginAlert[];
}> {
  const sharedDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
  const [secRes, sessRes, alertsRes] = await Promise.allSettled([
    getDoc(doc(sharedDb, 'config', 'security')),
    getDocs(query(collection(sharedDb, 'adminSessions'), limit(50))),
    getDocs(query(collection(sharedDb, 'loginAlerts'), limit(50))),
  ]);

  const secData =
    secRes.status === 'fulfilled' && secRes.value.exists()
      ? (secRes.value.data() as Record<string, unknown>)
      : {};
  const extracted2fa = extractAppTwoFactorConfig(secData, user?.uid);
  const forceSignOutBeforeMs =
    extractFirestoreTimestampMillis(secData.forceSignOutBefore) ?? 0;

  const sessions: CloudflareAdminSession[] =
    sessRes.status === 'fulfilled'
      ? sessRes.value.docs
          .map((d) => {
            const r = d.data() as Record<string, unknown>;
            const status = String(r.status ?? 'active');
            const loginAtMillis = Number(r.loginAtMillis ?? 0);
            const lastActiveMillis = Number(r.lastActiveMillis ?? loginAtMillis);
            const createdAtMs = extractFirestoreTimestampMillis(r.createdAt) ?? loginAtMillis;
            const updatedAtMs = extractFirestoreTimestampMillis(r.updatedAt) ?? lastActiveMillis;
            return {
              id: d.id,
              uid: String(r.uid ?? ''),
              deviceId: String(r.deviceId ?? ''),
              deviceName: String(r.deviceName ?? 'Admin Device'),
              platform: String(r.platform ?? 'Unknown'),
              email: String(r.email ?? ''),
              location: String(r.location ?? ''),
              loginAtMillis,
              lastActiveMillis,
              status: (status === 'revoked' || status === 'pending_verification'
                ? status
                : 'active') as CloudflareAdminSession['status'],
              userAgent: String(r.userAgent ?? ''),
              createdAtMs,
              updatedAtMs,
            };
          })
          .sort((a, b) => b.lastActiveMillis - a.lastActiveMillis)
      : [];

  const activeCount = sessions.filter((s) => s.status === 'active').length;

  const alerts: CloudflareLoginAlert[] =
    alertsRes.status === 'fulfilled'
      ? alertsRes.value.docs
          .map((d) => {
            const r = d.data() as Record<string, unknown>;
            const decision = String(r.decision ?? r.status ?? 'pending').toLowerCase();
            const isUnauth =
              String(r.alertType ?? r.type ?? '').includes('unauth') ||
              String(r.type ?? '') === 'access_request' ||
              d.id.startsWith('unauth_');
            const timestampMillis = Number(r.timestampMillis ?? 0);
            const createdAtMs = extractFirestoreTimestampMillis(r.createdAt) ?? timestampMillis;
            const updatedAtMs = extractFirestoreTimestampMillis(r.updatedAt) ?? timestampMillis;
            return {
              id: d.id,
              sessionId: String(r.sessionId ?? ''),
              uid: String(r.uid ?? ''),
              email: String(r.email ?? ''),
              deviceName: String(r.deviceName ?? 'Unknown Device'),
              platform: String(r.platform ?? 'Website'),
              location: String(r.location ?? ''),
              timestampMillis,
              decision: (decision === 'approved' || decision === 'denied' || decision === 'notified'
                ? decision
                : 'pending') as CloudflareLoginAlert['decision'],
              alertType: (isUnauth ? 'unauthorized_email' : 'new_device') as CloudflareLoginAlert['alertType'],
              verificationCode:
                typeof r.verificationCode === 'string' && r.verificationCode
                  ? r.verificationCode
                  : undefined,
              createdAtMs,
              updatedAtMs,
            };
          })
          .sort((a, b) => b.timestampMillis - a.timestampMillis)
      : [];

  return {
    security: {
      forceSignOutBeforeMs,
      twoFactorEnabled: extracted2fa.enabled,
      hasTotpSecret: Boolean(extracted2fa.secret),
      requireDeviceApproval: Boolean(secData.requireDeviceApproval),
      loginAlertsEnabled: secData.loginAlertsEnabled !== false,
      trustedDeviceCount: 0,
    },
    sessions,
    activeCount,
    alerts,
  };
}

export async function saveFirestoreSecuritySettings(
  firebaseApp: FirebaseApp,
  patch: {
    twoFactorEnabled?: boolean;
    totpSecret?: string;
    requireDeviceApproval?: boolean;
    loginAlertsEnabled?: boolean;
    forceSignOutAll?: boolean;
  }
): Promise<void> {
  const sharedDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (typeof patch.twoFactorEnabled === 'boolean') {
    updatePayload.twoFactorEnabled = patch.twoFactorEnabled;
    updatePayload.totpEnabled = patch.twoFactorEnabled;
    updatePayload.authenticatorEnabled = patch.twoFactorEnabled;
  }
  if (typeof patch.totpSecret === 'string') {
    updatePayload.totpSecret = patch.totpSecret;
  }
  if (typeof patch.requireDeviceApproval === 'boolean') {
    updatePayload.requireDeviceApproval = patch.requireDeviceApproval;
  }
  if (typeof patch.loginAlertsEnabled === 'boolean') {
    updatePayload.loginAlertsEnabled = patch.loginAlertsEnabled;
  }
  if (patch.forceSignOutAll) {
    updatePayload.forceSignOutBefore = serverTimestamp();
  }
  await setDoc(doc(sharedDb, 'config', 'security'), updatePayload, { merge: true });
}

export async function respondToFirestoreLoginAlert(
  firebaseApp: FirebaseApp,
  alertId: string,
  decision: 'approved' | 'denied',
  alertEmail?: string,
  alertUid?: string,
  isUnauthorizedRequest?: boolean
): Promise<{ ok: boolean; grantedEmail?: string | null }> {
  const sharedDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
  await setDoc(
    doc(sharedDb, 'loginAlerts', alertId),
    {
      decision,
      status: decision,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  let grantedEmail: string | null = null;
  if (decision === 'approved' && isUnauthorizedRequest && alertEmail) {
    const lowerEmail = alertEmail.trim().toLowerCase();
    grantedEmail = lowerEmail;
    try {
      const accessRef = doc(sharedDb, 'config', 'adminAccess');
      const snap = await getDoc(accessRef);
      const current = snap.exists()
        ? extractEmailListFromDoc(snap.data() as Record<string, unknown>)
        : [];
      const next = Array.from(new Set(['alifcarimports@gmail.com', ...current, lowerEmail]));
      await setDoc(
        accessRef,
        {
          adminEmails: next,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      if (alertUid) {
        await setDoc(
          doc(sharedDb, 'admins', alertUid),
          {
            email: lowerEmail,
            role: 'admin',
            createdAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => undefined);
      }
    } catch {
      // Non-fatal if rules restrict adminAccess write
    }
  }
  return { ok: true, grantedEmail };
}

export async function revokeFirestoreAdminSession(
  firebaseApp: FirebaseApp,
  sessionId: string
): Promise<void> {
  const sharedDb = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
  await setDoc(
    doc(sharedDb, 'adminSessions', sessionId),
    {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
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
        if (activeGen === watchGeneration) {
          // Run session write and mobile-app login alert write independently so neither blocks the other
          const sessionWritePromise = (async () => {
            const existingSnap = await getDoc(sessionRef);
            if (activeGen !== watchGeneration) return;
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
          })();

          const alertWritePromise = (async () => {
            const alertFlagKey = `alif_web_alert_sent_${user.uid}_${user.metadata?.lastSignInTime || ''}`;
            let alertAlreadySent = false;
            try {
              alertAlreadySent = Boolean(window.sessionStorage.getItem(alertFlagKey));
            } catch {
              alertAlreadySent = false;
            }
            if (alertAlreadySent || activeGen !== watchGeneration) return;
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
          })();

          await Promise.allSettled([sessionWritePromise, alertWritePromise]);

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
