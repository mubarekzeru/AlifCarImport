import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  type FieldValue,
  type Firestore,
} from 'firebase/firestore';
import { isCloudflareBackendEnabled, trackVisitToCloudflare } from './cloudflareStore';

export const VISITOR_ID_STORAGE_KEY = 'alif_visitor_id';
export const VISIT_SESSION_KEY_PREFIX = 'alif_visited_';

const inMemoryVisitedPaths = new Set<string>();
let inMemoryVisitorId: string | null = null;

export interface PageVisitPayload {
  id: string;
  page: string;
  visitorId: string;
  dateKey: string;
  referrer: string;
  userAgent: string;
  timestampMillis: number;
  createdAt: FieldValue;
}

export function normalizeVisitPath(rawPath: string | null | undefined): string {
  const path = rawPath && rawPath.trim().length > 0 ? rawPath : '/';
  return path.slice(0, 200);
}

export function shouldTrackVisitPath(path: string): boolean {
  return !path.toLowerCase().includes('admin');
}

export function buildVisitSessionKey(path: string): string {
  return `${VISIT_SESSION_KEY_PREFIX}${path}`;
}

export function generateVisitorId(
  nowMillis: number = Date.now(),
  randomValue: number = Math.random()
): string {
  const randomSuffix = randomValue.toString(36).slice(2, 10) || '00000000';
  return `v_${nowMillis.toString(36)}_${randomSuffix}`;
}

export function buildPageVisitPayload(params: {
  id: string;
  page: string;
  visitorId: string;
  referrer?: string;
  userAgent?: string;
  nowMillis?: number;
  createdAt?: FieldValue;
}): PageVisitPayload {
  const nowMillis = params.nowMillis ?? Date.now();
  return {
    id: params.id,
    page: normalizeVisitPath(params.page),
    visitorId: params.visitorId.slice(0, 128),
    dateKey: new Date(nowMillis).toISOString().slice(0, 10),
    referrer: (params.referrer || '').slice(0, 300),
    userAgent: (params.userAgent || '').slice(0, 300),
    timestampMillis: nowMillis,
    createdAt: params.createdAt ?? serverTimestamp(),
  };
}

function hasVisitedInSession(sessionKey: string): boolean {
  if (inMemoryVisitedPaths.has(sessionKey)) {
    return true;
  }
  try {
    return Boolean(window.sessionStorage.getItem(sessionKey));
  } catch {
    return false;
  }
}

function markVisitedInSession(sessionKey: string): void {
  inMemoryVisitedPaths.add(sessionKey);
  try {
    window.sessionStorage.setItem(sessionKey, '1');
  } catch {
    // Fallback to in-memory set if sessionStorage is unavailable
  }
}

function getOrCreateVisitorId(): string {
  try {
    let visitorId = window.localStorage.getItem(VISITOR_ID_STORAGE_KEY);
    if (!visitorId) {
      visitorId = inMemoryVisitorId ?? generateVisitorId();
      window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, visitorId);
    }
    inMemoryVisitorId = visitorId;
    return visitorId;
  } catch {
    if (!inMemoryVisitorId) {
      inMemoryVisitorId = generateVisitorId();
    }
    return inMemoryVisitorId;
  }
}

/**
 * Records a public showroom page visit once per browser session per pathname
 * in the shared Firestore `pageVisits` collection. Admin routes are excluded.
 */
export async function trackWebsiteVisit(db: Firestore): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const path = normalizeVisitPath(window.location.pathname);
    if (!shouldTrackVisitPath(path)) return;

    const sessionKey = buildVisitSessionKey(path);
    if (hasVisitedInSession(sessionKey)) return;
    markVisitedInSession(sessionKey);

    const visitorId = getOrCreateVisitorId();
    const referrer = typeof document !== 'undefined' ? document.referrer : '';
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

    if (isCloudflareBackendEnabled()) {
      const nowMillis = Date.now();
      const visitId = `vis_${nowMillis.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const payload = buildPageVisitPayload({
        id: visitId,
        page: path,
        visitorId,
        referrer,
        userAgent,
        nowMillis,
      });
      await trackVisitToCloudflare({
        id: payload.id,
        page: payload.page,
        visitorId: payload.visitorId,
        dateKey: payload.dateKey,
        referrer: payload.referrer,
        userAgent: payload.userAgent,
        timestampMillis: payload.timestampMillis,
      });
      return;
    }

    const visitRef = doc(collection(db, 'pageVisits'));
    const payload = buildPageVisitPayload({
      id: visitRef.id,
      page: path,
      visitorId,
      referrer,
      userAgent,
    });

    await setDoc(visitRef, payload);
  } catch (err) {
    console.warn('Visitor tracking skipped:', err);
  }
}
