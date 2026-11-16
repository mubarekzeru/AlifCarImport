import { INITIAL_SHOWROOM_STORE } from '../data/seedData';
import type { CustomerInquiry, ShowroomStore } from '../types/showroom';
import { isAuthorizedAdminEmail } from './inventory';

const LOCAL_STORAGE_KEY = 'alif_car_import_store_v1';
const ADMIN_SESSION_STORAGE_KEY = 'alif_car_import_admin_session_v1';

interface StoredAdminSession {
  email: string;
  token: string;
  mode: 'server' | 'local';
}

function readStoredAdminSession(): StoredAdminSession | null {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAdminSession>;
    if (!parsed.email || typeof parsed.email !== 'string') return null;
    return {
      email: parsed.email,
      token: typeof parsed.token === 'string' ? parsed.token : '',
      mode: parsed.mode === 'local' ? 'local' : 'server',
    };
  } catch {
    return null;
  }
}

function writeStoredAdminSession(session: StoredAdminSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    } else {
      localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const session = readStoredAdminSession();
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  return headers;
}

export async function checkAdminSession(extraAdminEmails?: string[]): Promise<{
  authenticated: boolean;
  email: string | null;
}> {
  const stored = readStoredAdminSession();
  try {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      headers: getAuthHeaders(),
    });
    if (response.ok) {
      const json = (await response.json()) as { authenticated?: boolean; email?: string | null };
      if (json.authenticated && json.email) {
        return { authenticated: true, email: json.email };
      }
    }
    if (stored?.mode === 'local' && isAuthorizedAdminEmail(stored.email, extraAdminEmails)) {
      return { authenticated: true, email: stored.email };
    }
    return { authenticated: false, email: null };
  } catch {
    if (stored && isAuthorizedAdminEmail(stored.email, extraAdminEmails)) {
      return { authenticated: true, email: stored.email };
    }
  }
  return { authenticated: false, email: null };
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    // Brief retry in case the preview server is waking from idle on mobile networks
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    try {
      return await fetch(url, init);
    } catch {
      throw err;
    }
  }
}

export async function loginAdminByEmail(
  email: string,
  extraAdminEmails?: string[]
): Promise<{
  authenticated: boolean;
  email: string;
}> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Please enter an admin email address.');
  }

  let response: Response;
  try {
    response = await fetchWithRetry('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalized }),
    });
  } catch {
    // Network unreachable (e.g. mobile proxy hiccup or static hosting without Express):
    // still verify strictly against the authorized admin email allowlist.
    if (isAuthorizedAdminEmail(normalized, extraAdminEmails)) {
      writeStoredAdminSession({ email: normalized, token: '', mode: 'local' });
      return { authenticated: true, email: normalized };
    }
    throw new Error('This email is not authorized for admin access.');
  }

  const rawText = await response.text().catch(() => '');
  let json: {
    authenticated?: boolean;
    email?: string;
    token?: string;
    error?: string;
  } = {};
  try {
    json = rawText ? (JSON.parse(rawText) as typeof json) : {};
  } catch {
    // Non-JSON response (e.g. HTML gateway page on static/proxied preview)
    if (isAuthorizedAdminEmail(normalized, extraAdminEmails)) {
      writeStoredAdminSession({ email: normalized, token: '', mode: 'local' });
      return { authenticated: true, email: normalized };
    }
    throw new Error('This email is not authorized for admin access.');
  }

  if (!response.ok || !json.authenticated || !json.email) {
    if (response.status === 400 || response.status === 403 || response.status === 401) {
      throw new Error(json.error || 'This email is not authorized for admin access.');
    }
    if (isAuthorizedAdminEmail(normalized, extraAdminEmails)) {
      writeStoredAdminSession({ email: normalized, token: '', mode: 'local' });
      return { authenticated: true, email: normalized };
    }
    throw new Error(json.error || 'Unable to verify admin email.');
  }

  writeStoredAdminSession({
    email: json.email,
    token: typeof json.token === 'string' ? json.token : '',
    mode: 'server',
  });
  return { authenticated: true, email: json.email };
}

export async function logoutAdmin(): Promise<void> {
  writeStoredAdminSession(null);
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  }).catch(() => undefined);
}

export async function loadShowroomStore(): Promise<ShowroomStore> {
  try {
    const response = await fetch('/api/store', { credentials: 'same-origin' });
    if (response.ok) {
      const json = (await response.json()) as { initialized?: boolean; data?: ShowroomStore | null };
      if (json.initialized && json.data && Array.isArray(json.data.vehicles)) {
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(json.data));
        } catch {
          // Ignore quota errors on local cache
        }
        return json.data;
      }
    }
  } catch {
    // Fall back to local cache or seed data
  }

  try {
    const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as ShowroomStore;
      if (parsed && Array.isArray(parsed.vehicles)) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }

  return INITIAL_SHOWROOM_STORE;
}

export async function saveShowroomStore(store: ShowroomStore): Promise<void> {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore localStorage quota issues
  }

  const storedSession = readStoredAdminSession();
  try {
    const response = await fetch('/api/store', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(store),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Admin email login required to save changes.');
      }
      if (storedSession?.mode === 'local') return;
      const err = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || 'Failed to save changes to server.');
    }
  } catch (err) {
    if (storedSession?.mode === 'local' && !(err instanceof Error && err.message.includes('login'))) {
      return;
    }
    throw err;
  }
}

export async function resetShowroomStore(): Promise<ShowroomStore> {
  const storedSession = readStoredAdminSession();
  try {
    const response = await fetch('/api/store', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || storedSession?.mode !== 'local') {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to reset showroom data.');
      }
    }
  } catch (err) {
    if (storedSession?.mode !== 'local') {
      throw err;
    }
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
  const response = await fetch('/api/inquiries', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || 'Could not send inquiry.');
  }
  const json = (await response.json()) as { data: CustomerInquiry };
  return json.data;
}

export async function fetchCustomerInquiries(): Promise<CustomerInquiry[]> {
  try {
    const response = await fetch('/api/inquiries', {
      credentials: 'same-origin',
      headers: getAuthHeaders(),
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { data?: CustomerInquiry[] };
    return Array.isArray(json.data) ? json.data : [];
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
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
