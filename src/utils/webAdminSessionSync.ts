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

export const WEB_ADMIN_FIRESTORE_DB_ID =
  'ai-studio-alifcarportal-c5b73261-7322-4966-b5e2-59c51963e99b';
const DEVICE_ID_KEY = 'alif_web_admin_device_id';

let unsubscribeSessionWatch: Unsubscribe | null = null;
let activeWatchedSessionKey: string | null = null;

export function sanitizeSessionIdPart(value: unknown): string {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}

export function buildWebAdminSessionId(uid: string, deviceId: string): string {
  const cleanUid = sanitizeSessionIdPart(uid).slice(0, 10) || 'admin';
  const cleanDev = sanitizeSessionIdPart(deviceId).slice(0, 12) || 'browser';
  return `web_${cleanUid}_${cleanDev}`;
}

export function detectBrowserDeviceName(userAgent?: string): string {
  const ua =
    userAgent ??
    (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '');

  const browser = /Edg\//.test(ua)
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

function getOrCreateWebDeviceId(): string {
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

function generateAlertId(now: number): string {
  const randomSeed =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${now}_${Math.random().toString(36).slice(2)}`;
  return `alert_web_${sanitizeSessionIdPart(randomSeed).slice(0, 16)}`;
}

export function stopWebSessionWatcher(): void {
  if (unsubscribeSessionWatch) {
    unsubscribeSessionWatch();
    unsubscribeSessionWatch = null;
  }
  activeWatchedSessionKey = null;
}

/**
 * Silently reports an authorized website admin login to the shared Firestore database
 * so the Android Admin app can display active website sessions, show login alerts,
 * and remotely revoke website sessions. Adds no visible UI on the website.
 */
export async function startWebAdminSession(
  auth: Auth,
  firebaseApp: FirebaseApp,
  user: User | null | undefined
): Promise<void> {
  if (!user || !user.emailVerified) return;

  const deviceId = getOrCreateWebDeviceId().slice(0, 128);
  const sessionId = buildWebAdminSessionId(user.uid, deviceId);
  const watchKey = `${user.uid}:${sessionId}`;

  try {
    const db = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
    const deviceName = detectBrowserDeviceName();
    const email = (user.email || '').trim().slice(0, 254);
    const location = getFallbackLocation();
    const userAgent = (
      typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
    ).slice(0, 300);
    const now = Date.now();

    const sessionRef = doc(db, 'adminSessions', sessionId);
    const existingSnap = await getDoc(sessionRef);

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

    // Live remote sign-out: if revoked from the Android app, sign out this browser immediately
    if (activeWatchedSessionKey === watchKey && unsubscribeSessionWatch) {
      return;
    }
    stopWebSessionWatcher();
    activeWatchedSessionKey = watchKey;
    unsubscribeSessionWatch = onSnapshot(
      sessionRef,
      (snap) => {
        if (snap.exists() && snap.data()?.status === 'revoked') {
          stopWebSessionWatcher();
          void signOut(auth);
        }
      },
      (err) => {
        console.warn('Web admin session watcher error:', err);
      }
    );
  } catch (err) {
    console.warn('Unable to sync website admin session:', err);
  }
}

/**
 * Marks the current browser admin session as revoked in Firestore right before signOut(auth).
 */
export async function endWebAdminSession(
  firebaseApp: FirebaseApp,
  user: User | null | undefined
): Promise<void> {
  stopWebSessionWatcher();
  if (!user) return;
  try {
    const db = getFirestore(firebaseApp, WEB_ADMIN_FIRESTORE_DB_ID);
    const deviceId = getOrCreateWebDeviceId().slice(0, 128);
    const sessionId = buildWebAdminSessionId(user.uid, deviceId);
    await updateDoc(doc(db, 'adminSessions', sessionId), {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Unable to mark website admin session revoked:', err);
  }
}
