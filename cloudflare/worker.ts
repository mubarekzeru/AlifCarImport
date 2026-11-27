/**
 * Alif Car Import — Cloudflare Worker API (D1 Database + R2 Media + Firebase Auth)
 *
 * - Public visitors read vehicles, TikTok reels, branding, and contact from D1 + R2 (0 Firestore reads).
 * - Admin writes (website /admin and Android Admin app) authenticate via Firebase Authentication
 *   ID tokens (`Authorization: Bearer <firebaseIdToken>`), verified cryptographically against
 *   Google's official RS256 JWKS keys.
 * - Any base64 `data:image/...` uploads are automatically stored as binary files in Cloudflare R2
 *   and served with immutable CDN cache headers.
 */

interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface R2HTTPMetadata {
  contentType?: string;
  cacheControl?: string;
}

interface R2ObjectBody {
  body: ReadableStream;
  httpEtag?: string;
  size: number;
  httpMetadata?: R2HTTPMetadata;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream | string,
    options?: { httpMetadata?: R2HTTPMetadata }
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  FIREBASE_PROJECT_ID: string;
  BOOTSTRAP_ADMIN_EMAIL: string;
  ALLOWED_ORIGINS?: string;
  PUBLIC_MEDIA_BASE_URL?: string;
}

interface VerifiedFirebaseAdmin {
  uid: string;
  email: string;
  authTimeMs: number;
}

interface GoogleJwk extends JsonWebKey {
  kid: string;
  alg?: string;
  use?: string;
}

const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per media file
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

let cachedJwks: { keys: GoogleJwk[]; expiresAt: number } | null = null;

function clampStr(value: unknown, maxLen: number, fallback = ''): string {
  const str = typeof value === 'string' ? value : fallback;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function sanitizeId(raw: unknown, prefix: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned || `${prefix}_${Date.now()}`;
}

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const configured = (env.ALLOWED_ORIGINS || '*').trim();
  const origin = request.headers.get('Origin') || '';
  let allowOrigin = '*';
  if (configured !== '*') {
    const allowedList = configured
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    allowOrigin = allowedList.includes(origin) ? origin : allowedList[0] || '*';
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(
  data: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...(extraHeaders || {}),
    },
  });
}

function base64UrlToUint8Array(segment: string): Uint8Array<ArrayBuffer> {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const cleaned = b64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function fetchGoogleJwks(): Promise<GoogleJwk[]> {
  const now = Date.now();
  if (cachedJwks && cachedJwks.expiresAt > now) {
    return cachedJwks.keys;
  }

  const res = await fetch(FIREBASE_JWKS_URL);
  if (!res.ok) {
    throw new Error('Unable to load Firebase public signing keys.');
  }

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.min(Math.max(Number(maxAgeMatch[1]), 60), 21600) : 3600;

  const body = (await res.json()) as { keys?: GoogleJwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  cachedJwks = { keys, expiresAt: now + maxAgeSec * 1000 };
  return keys;
}

async function getConfigRow(env: Env): Promise<{
  branding_json: string;
  hero_json: string;
  tiktok_header_json: string;
  contact_json: string;
  admin_emails_json: string;
  force_sign_out_before_ms: number;
  updated_at_ms: number;
} | null> {
  return env.DB.prepare(
    `SELECT branding_json, hero_json, tiktok_header_json, contact_json, admin_emails_json, force_sign_out_before_ms, updated_at_ms
     FROM showroom_config WHERE id = 'showroom'`
  ).first();
}

async function verifyFirebaseAdmin(request: Request, env: Env): Promise<VerifiedFirebaseAdmin> {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Error('Missing Firebase Authorization Bearer token.');
  }
  const token = match[1].trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(headerB64))) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(payloadB64))) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
  };

  const projectId = (env.FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is not configured on Worker.');
  }
  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported Firebase token algorithm.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) {
    throw new Error('Firebase token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Firebase token issuer mismatch.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Firebase token has expired. Please sign in again.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Firebase token issued-at timestamp is invalid.');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Firebase token missing subject.');
  }
  if (!payload.email || payload.email_verified !== true) {
    throw new Error('A verified admin email address is required.');
  }

  const keys = await fetchGoogleJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Force refresh once in case Google rotated keys
    cachedJwks = null;
    const freshKeys = await fetchGoogleJwks();
    const retryJwk = freshKeys.find((k) => k.kid === header.kid);
    if (!retryJwk) {
      throw new Error('Unable to match Firebase signing key.');
    }
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      retryJwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      base64UrlToUint8Array(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) {
      throw new Error('Invalid Firebase token signature.');
    }
  } else {
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      base64UrlToUint8Array(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) {
      throw new Error('Invalid Firebase token signature.');
    }
  }

  const emailLower = payload.email.trim().toLowerCase();
  const bootstrapLower = (env.BOOTSTRAP_ADMIN_EMAIL || 'alifcarimports@gmail.com')
    .trim()
    .toLowerCase();
  const configRow = await getConfigRow(env);
  const storedAllowlist = parseJsonSafe<string[]>(configRow?.admin_emails_json, [bootstrapLower])
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean);
  const allowedSet = new Set([bootstrapLower, ...storedAllowlist]);

  if (!allowedSet.has(emailLower)) {
    throw new Error('This email is not authorized for admin access.');
  }

  const authTimeMs = typeof payload.auth_time === 'number' ? payload.auth_time * 1000 : 0;
  const forceSignOutBeforeMs = Number(configRow?.force_sign_out_before_ms ?? 0);
  if (forceSignOutBeforeMs > 0 && authTimeMs > 0 && authTimeMs < forceSignOutBeforeMs) {
    throw new Error('FORCE_SIGN_OUT: Your session was invalidated after a password or security change.');
  }

  return {
    uid: payload.sub,
    email: emailLower,
    authTimeMs,
  };
}

function buildPublicMediaUrl(request: Request, env: Env, key: string): string {
  const customBase = (env.PUBLIC_MEDIA_BASE_URL || '').trim().replace(/\/+$/, '');
  if (customBase) {
    return `${customBase}/${key}`;
  }
  const workerOrigin = new URL(request.url).origin;
  return `${workerOrigin}/media/${key}`;
}

async function maybeOffloadDataUrlToR2(
  rawUrl: unknown,
  folder: 'vehicles' | 'tiktok' | 'branding',
  request: Request,
  env: Env
): Promise<string> {
  const str = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!str) return '';
  if (!str.startsWith('data:')) {
    return str.slice(0, 2000);
  }

  const match = str.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Only base64 image data URLs are supported for media uploads.');
  }
  const mimeType = match[1].toLowerCase();
  const ext = ALLOWED_IMAGE_TYPES[mimeType];
  if (!ext) {
    throw new Error(`Unsupported image MIME type: ${mimeType}`);
  }

  const bytes = decodeBase64ToUint8Array(match[2]);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error('Image exceeds maximum allowed size of 10 MB.');
  }

  const randomId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const key = `${folder}/${Date.now()}_${randomId}.${ext}`;
  await env.MEDIA_BUCKET.put(key, bytes, {
    httpMetadata: {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  return buildPublicMediaUrl(request, env, key);
}

function normalizeVehicleRow(row: Record<string, unknown>) {
  const originalPrice =
    typeof row.original_price === 'number' && Number.isFinite(row.original_price)
      ? row.original_price
      : undefined;
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    make: String(row.make ?? ''),
    model: String(row.model ?? ''),
    year: Number(row.year ?? 2024),
    price: Number(row.price ?? 0),
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    mileage: String(row.mileage ?? ''),
    transmission: String(row.transmission ?? ''),
    fuelType: String(row.fuel_type ?? ''),
    color: String(row.color ?? ''),
    origin: String(row.origin ?? ''),
    imageUrl: String(row.image_url ?? ''),
    galleryImages: parseJsonSafe<string[]>(row.gallery_images_json, []),
    description: String(row.description ?? ''),
    tiktokUrl: String(row.tiktok_url ?? ''),
    status: row.status === 'reserved' || row.status === 'sold' ? row.status : 'available',
    featured: Boolean(row.featured),
    createdAt: String(row.created_at ?? ''),
  };
}

function normalizeTikTokRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    caption: String(row.caption ?? ''),
    tiktokUrl: String(row.tiktok_url ?? ''),
    coverImageUrl: String(row.cover_image_url ?? ''),
    sortOrder: Number(row.sort_order ?? 0),
    updatedAtMillis: Number(row.updated_at_ms ?? 0),
  };
}

async function upsertVehicle(
  vehicleId: string,
  body: Record<string, unknown>,
  request: Request,
  env: Env
): Promise<void> {
  const id = sanitizeId(vehicleId || body.id, 'veh');
  const imageUrl = await maybeOffloadDataUrlToR2(body.imageUrl, 'vehicles', request, env);
  const rawGallery = Array.isArray(body.galleryImages) ? body.galleryImages.slice(0, 20) : [];
  const galleryImages: string[] = [];
  for (const item of rawGallery) {
    const resolved = await maybeOffloadDataUrlToR2(item, 'vehicles', request, env);
    if (resolved) galleryImages.push(resolved);
  }

  const yearNum = Number.isFinite(Number(body.year))
    ? Math.min(Math.max(Math.round(Number(body.year)), 1950), 2100)
    : 2024;
  const priceNum = Number.isFinite(Number(body.price))
    ? Math.min(Math.max(Number(body.price), 0), 100_000_000)
    : 0;
  const originalPrice =
    typeof body.originalPrice === 'number' && Number.isFinite(body.originalPrice) && body.originalPrice >= 0
      ? Math.min(body.originalPrice, 100_000_000)
      : null;

  const status = body.status === 'reserved' || body.status === 'sold' ? body.status : 'available';
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO vehicles (
      id, title, make, model, year, price, original_price, mileage, transmission,
      fuel_type, color, origin, image_url, gallery_images_json, description,
      tiktok_url, status, featured, created_at, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      make = excluded.make,
      model = excluded.model,
      year = excluded.year,
      price = excluded.price,
      original_price = excluded.original_price,
      mileage = excluded.mileage,
      transmission = excluded.transmission,
      fuel_type = excluded.fuel_type,
      color = excluded.color,
      origin = excluded.origin,
      image_url = excluded.image_url,
      gallery_images_json = excluded.gallery_images_json,
      description = excluded.description,
      tiktok_url = excluded.tiktok_url,
      status = excluded.status,
      featured = excluded.featured,
      updated_at_ms = excluded.updated_at_ms`
  )
    .bind(
      id,
      clampStr(body.title, 200, 'Vehicle') || 'Vehicle',
      clampStr(body.make, 80, 'Import') || 'Import',
      clampStr(body.model, 120, 'Model') || 'Model',
      yearNum,
      priceNum,
      originalPrice,
      clampStr(body.mileage, 60, '0 km'),
      clampStr(body.transmission, 80, 'Automatic'),
      clampStr(body.fuelType, 80, 'Petrol'),
      clampStr(body.color, 80, ''),
      clampStr(body.origin, 100, 'Direct Import'),
      imageUrl,
      JSON.stringify(galleryImages),
      clampStr(body.description, 4000, 'Imported vehicle.') || 'Imported vehicle.',
      clampStr(body.tiktokUrl, 500, ''),
      status,
      body.featured ? 1 : 0,
      clampStr(body.createdAt, 64, new Date(now).toISOString()),
      now
    )
    .run();
}

async function upsertTikTokPost(
  postId: string,
  body: Record<string, unknown>,
  request: Request,
  env: Env
): Promise<void> {
  const id = sanitizeId(postId || body.id, 'tt');
  const coverImageUrl = await maybeOffloadDataUrlToR2(body.coverImageUrl, 'tiktok', request, env);
  const sortOrder = Number.isFinite(Number(body.sortOrder))
    ? Math.min(Math.max(Math.round(Number(body.sortOrder)), 0), 1000)
    : 0;
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO tiktok_posts (id, title, caption, tiktok_url, cover_image_url, sort_order, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       caption = excluded.caption,
       tiktok_url = excluded.tiktok_url,
       cover_image_url = excluded.cover_image_url,
       sort_order = excluded.sort_order,
       updated_at_ms = excluded.updated_at_ms`
  )
    .bind(
      id,
      clampStr(body.title, 200, ''),
      clampStr(body.caption, 2000, ''),
      clampStr(body.tiktokUrl, 500, ''),
      coverImageUrl,
      sortOrder,
      now
    )
    .run();
}

async function upsertShowroomConfig(
  body: Record<string, unknown>,
  request: Request,
  env: Env
): Promise<void> {
  const existing = await getConfigRow(env);
  const now = Date.now();

  const rawBranding = (body.branding && typeof body.branding === 'object'
    ? (body.branding as Record<string, unknown>)
    : parseJsonSafe<Record<string, unknown>>(existing?.branding_json, {}));
  const logoUrl = await maybeOffloadDataUrlToR2(rawBranding.logoUrl, 'branding', request, env);
  const branding = {
    companyName: clampStr(rawBranding.companyName, 120, 'Alif Car Import') || 'Alif Car Import',
    logoUrl,
    tagline: clampStr(rawBranding.tagline, 240, ''),
  };

  const rawHero = (body.hero && typeof body.hero === 'object'
    ? (body.hero as Record<string, unknown>)
    : parseJsonSafe<Record<string, unknown>>(existing?.hero_json, {}));
  const heroImageUrl = await maybeOffloadDataUrlToR2(rawHero.imageUrl, 'branding', request, env);
  const hero = {
    kicker: clampStr(rawHero.kicker, 120, ''),
    title: clampStr(rawHero.title, 200, 'Alif Car Import') || 'Alif Car Import',
    description: clampStr(rawHero.description, 1200, ''),
    imageUrl: heroImageUrl,
    ...(typeof rawHero.videoUrl === 'string' && rawHero.videoUrl.trim()
      ? { videoUrl: clampStr(rawHero.videoUrl, 1000, '') }
      : {}),
    ctaLabel: clampStr(rawHero.ctaLabel, 80, 'Browse Inventory') || 'Browse Inventory',
  };

  const rawTikTok = (body.tiktok && typeof body.tiktok === 'object'
    ? (body.tiktok as Record<string, unknown>)
    : parseJsonSafe<Record<string, unknown>>(existing?.tiktok_header_json, {}));
  const tiktokHeader = {
    title: clampStr(rawTikTok.title, 160, 'Walkaround Reels on TikTok') || 'Walkaround Reels on TikTok',
    description: clampStr(rawTikTok.description, 1200, ''),
    profileUrl: clampStr(rawTikTok.profileUrl, 500, ''),
    handle: clampStr(rawTikTok.handle, 80, ''),
  };

  const rawContact = (body.contact && typeof body.contact === 'object'
    ? (body.contact as Record<string, unknown>)
    : parseJsonSafe<Record<string, unknown>>(existing?.contact_json, {}));
  const contact = {
    addressLine: clampStr(rawContact.addressLine, 240, ''),
    cityCountry: clampStr(rawContact.cityCountry, 160, ''),
    hours: clampStr(rawContact.hours, 160, ''),
    phone: clampStr(rawContact.phone, 60, ''),
    whatsapp: clampStr(rawContact.whatsapp, 200, ''),
    telegram: clampStr(rawContact.telegram, 200, ''),
    instagram: clampStr(rawContact.instagram, 200, ''),
    facebook: clampStr(rawContact.facebook, 200, ''),
    x: clampStr(rawContact.x, 200, ''),
    email: clampStr(rawContact.email, 254, ''),
    mapsUrl: clampStr(rawContact.mapsUrl, 500, ''),
    landmarkNote: clampStr(rawContact.landmarkNote, 240, ''),
  };

  const bootstrap = (env.BOOTSTRAP_ADMIN_EMAIL || 'alifcarimports@gmail.com').trim().toLowerCase();
  const existingAdminEmails = parseJsonSafe<string[]>(existing?.admin_emails_json, [bootstrap]);
  const incomingAdminEmails = Array.isArray(body.adminEmails)
    ? Array.from(
        new Set(
          body.adminEmails
            .filter((e): e is string => typeof e === 'string' && e.includes('@'))
            .map((e) => e.trim().toLowerCase())
            .slice(0, 20)
        )
      )
    : existingAdminEmails;
  const adminEmails = incomingAdminEmails.length > 0 ? incomingAdminEmails : [bootstrap];

  await env.DB.prepare(
    `INSERT INTO showroom_config (
      id, branding_json, hero_json, tiktok_header_json, contact_json,
      admin_emails_json, force_sign_out_before_ms, updated_at_ms
    ) VALUES ('showroom', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      branding_json = excluded.branding_json,
      hero_json = excluded.hero_json,
      tiktok_header_json = excluded.tiktok_header_json,
      contact_json = excluded.contact_json,
      admin_emails_json = excluded.admin_emails_json,
      updated_at_ms = excluded.updated_at_ms`
  )
    .bind(
      JSON.stringify(branding),
      JSON.stringify(hero),
      JSON.stringify(tiktokHeader),
      JSON.stringify(contact),
      JSON.stringify(adminEmails),
      Number(existing?.force_sign_out_before_ms ?? 0),
      now
    )
    .run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = getCorsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    try {
      // 1. Public health check
      if (request.method === 'GET' && pathname === '/api/health') {
        return jsonResponse({ ok: true, backend: 'cloudflare-d1-r2' }, 200, cors);
      }

      // 2. Public R2 media streaming (/media/<folder>/<filename>)
      if (request.method === 'GET' && pathname.startsWith('/media/')) {
        const key = decodeURIComponent(pathname.slice('/media/'.length));
        if (!key || key.includes('..') || key.startsWith('/') || !/^[a-zA-Z0-9/_.-]+$/.test(key)) {
          return jsonResponse({ error: 'Invalid media key.' }, 400, cors);
        }
        const obj = await env.MEDIA_BUCKET.get(key);
        if (!obj) {
          return jsonResponse({ error: 'Media not found.' }, 404, cors);
        }
        const headers = new Headers(cors);
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Cache-Control', obj.httpMetadata?.cacheControl || 'public, max-age=31536000, immutable');
        headers.set('X-Content-Type-Options', 'nosniff');
        if (obj.httpEtag) {
          headers.set('ETag', obj.httpEtag);
        }
        return new Response(obj.body, { status: 200, headers });
      }

      // 3. Public showroom feed (1 fast D1 read bundle for all visitors)
      if (request.method === 'GET' && pathname === '/api/showroom') {
        const [configRow, vehiclesRes, postsRes] = await Promise.all([
          getConfigRow(env),
          env.DB.prepare(`SELECT * FROM vehicles ORDER BY created_at DESC`).all(),
          env.DB.prepare(`SELECT * FROM tiktok_posts ORDER BY sort_order DESC, updated_at_ms DESC`).all(),
        ]);

        const vehicles = (vehiclesRes.results ?? []).map(normalizeVehicleRow);
        const posts = (postsRes.results ?? []).map(normalizeTikTokRow);
        const hasConfig = Boolean(configRow);

        return jsonResponse(
          {
            hasConfig,
            branding: configRow ? parseJsonSafe(configRow.branding_json, null) : null,
            hero: configRow ? parseJsonSafe(configRow.hero_json, null) : null,
            tiktokHeader: configRow ? parseJsonSafe(configRow.tiktok_header_json, null) : null,
            contact: configRow ? parseJsonSafe(configRow.contact_json, null) : null,
            vehicles,
            tiktokPosts: posts,
            updatedAtMs: Number(configRow?.updated_at_ms ?? 0),
          },
          200,
          cors,
          { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=30' }
        );
      }

      // 4. Public customer inquiry submission
      if (request.method === 'POST' && pathname === '/api/inquiries') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const name = clampStr(body.name, 120, '').trim();
        const phone = clampStr(body.phone, 40, '').trim();
        const message = clampStr(body.message, 2000, '').trim();
        if (!name || !phone || !message) {
          return jsonResponse({ error: 'Name, phone, and message are required.' }, 400, cors);
        }

        const now = Date.now();
        const id = sanitizeId(body.id || `inq_${now}_${crypto.randomUUID().slice(0, 6)}`, 'inq');
        const createdAt = new Date(now).toISOString();
        const email = clampStr(body.email, 254, '').trim();
        const vehicleTitle = clampStr(body.vehicleTitle, 200, '').trim();

        await env.DB.prepare(
          `INSERT INTO inquiries (id, name, phone, email, vehicle_title, message, created_at, created_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(id, name, phone, email, vehicleTitle, message, createdAt, now)
          .run();

        return jsonResponse({ id, name, phone, email, vehicleTitle, message, createdAt }, 201, cors);
      }

      // 5. Public page visit tracking
      if (request.method === 'POST' && pathname === '/api/visits') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const page = clampStr(body.page, 200, '/').trim() || '/';
        if (page.toLowerCase().includes('admin')) {
          return jsonResponse({ skipped: true }, 200, cors);
        }
        const now = Date.now();
        const id = sanitizeId(body.id || `vis_${now}_${crypto.randomUUID().slice(0, 8)}`, 'vis');
        const visitorId = clampStr(body.visitorId, 128, `v_${now.toString(36)}`);
        const dateKey = clampStr(body.dateKey, 10, new Date(now).toISOString().slice(0, 10));
        const referrer = clampStr(body.referrer, 300, '');
        const userAgent = clampStr(body.userAgent, 300, '');
        const timestampMillis = Number.isFinite(Number(body.timestampMillis))
          ? Number(body.timestampMillis)
          : now;

        await env.DB.prepare(
          `INSERT OR IGNORE INTO page_visits (id, page, visitor_id, date_key, referrer, user_agent, timestamp_millis)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(id, page, visitorId, dateKey, referrer, userAgent, timestampMillis)
          .run();

        return jsonResponse({ ok: true, id }, 201, cors);
      }

      // =========================================================================
      // All /api/admin/* endpoints below REQUIRE a valid Firebase Admin ID Token
      // =========================================================================
      if (pathname.startsWith('/api/admin')) {
        let admin: VerifiedFirebaseAdmin;
        try {
          admin = await verifyFirebaseAdmin(request, env);
        } catch (authErr) {
          const message = authErr instanceof Error ? authErr.message : 'Unauthorized.';
          const status = message.startsWith('FORCE_SIGN_OUT') ? 401 : 403;
          return jsonResponse({ error: message }, status, cors);
        }

        // POST /api/admin/upload (multipart form-data or JSON base64 dataUrl)
        if (request.method === 'POST' && pathname === '/api/admin/upload') {
          const contentType = request.headers.get('content-type') || '';
          if (contentType.includes('multipart/form-data')) {
            const form = await request.formData();
            const file = form.get('file');
            const rawFolder = String(form.get('folder') || 'vehicles');
            const folder: 'vehicles' | 'tiktok' | 'branding' =
              rawFolder === 'tiktok' || rawFolder === 'branding' ? rawFolder : 'vehicles';
            if (!(file instanceof File)) {
              return jsonResponse({ error: 'Missing file field in multipart upload.' }, 400, cors);
            }
            const ext = ALLOWED_IMAGE_TYPES[file.type.toLowerCase()];
            if (!ext) {
              return jsonResponse({ error: `Unsupported image type: ${file.type}` }, 400, cors);
            }
            if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
              return jsonResponse({ error: 'Image must be between 1 byte and 10 MB.' }, 400, cors);
            }
            const key = `${folder}/${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.${ext}`;
            await env.MEDIA_BUCKET.put(key, await file.arrayBuffer(), {
              httpMetadata: {
                contentType: file.type.toLowerCase(),
                cacheControl: 'public, max-age=31536000, immutable',
              },
            });
            return jsonResponse({ key, url: buildPublicMediaUrl(request, env, key) }, 201, cors);
          }

          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const rawFolder = String(body.folder || 'vehicles');
          const folder: 'vehicles' | 'tiktok' | 'branding' =
            rawFolder === 'tiktok' || rawFolder === 'branding' ? rawFolder : 'vehicles';
          const uploadedUrl = await maybeOffloadDataUrlToR2(body.dataUrl, folder, request, env);
          if (!uploadedUrl) {
            return jsonResponse({ error: 'Missing dataUrl.' }, 400, cors);
          }
          return jsonResponse({ url: uploadedUrl }, 201, cors);
        }

        // GET /api/admin/access
        if (request.method === 'GET' && pathname === '/api/admin/access') {
          const row = await getConfigRow(env);
          const bootstrap = (env.BOOTSTRAP_ADMIN_EMAIL || 'alifcarimports@gmail.com')
            .trim()
            .toLowerCase();
          const adminEmails = parseJsonSafe<string[]>(row?.admin_emails_json, [bootstrap]);
          return jsonResponse({ adminEmails }, 200, cors);
        }

        // PUT /api/admin/access
        if (request.method === 'PUT' && pathname === '/api/admin/access') {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          await upsertShowroomConfig({ adminEmails: body.adminEmails }, request, env);
          return jsonResponse({ ok: true }, 200, cors);
        }

        // GET /api/admin/security
        if (request.method === 'GET' && pathname === '/api/admin/security') {
          const row = await getConfigRow(env);
          return jsonResponse(
            { forceSignOutBeforeMs: Number(row?.force_sign_out_before_ms ?? 0) },
            200,
            cors
          );
        }

        // POST /api/admin/security/force-sign-out
        if (request.method === 'POST' && pathname === '/api/admin/security/force-sign-out') {
          const now = Date.now();
          const row = await getConfigRow(env);
          if (!row) {
            await upsertShowroomConfig({}, request, env);
          }
          await env.DB.prepare(
            `UPDATE showroom_config SET force_sign_out_before_ms = ?, updated_at_ms = ? WHERE id = 'showroom'`
          )
            .bind(now, now)
            .run();
          return jsonResponse({ ok: true, forceSignOutBeforeMs: now }, 200, cors);
        }

        // PUT /api/admin/config
        if (request.method === 'PUT' && pathname === '/api/admin/config') {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          await upsertShowroomConfig(body, request, env);
          return jsonResponse({ ok: true }, 200, cors);
        }

        // PUT /api/admin/vehicles/:id
        if (request.method === 'PUT' && pathname.startsWith('/api/admin/vehicles/')) {
          const vehicleId = decodeURIComponent(pathname.slice('/api/admin/vehicles/'.length));
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          await upsertVehicle(vehicleId, body, request, env);
          return jsonResponse({ ok: true, id: sanitizeId(vehicleId, 'veh') }, 200, cors);
        }

        // DELETE /api/admin/vehicles/:id
        if (request.method === 'DELETE' && pathname.startsWith('/api/admin/vehicles/')) {
          const vehicleId = decodeURIComponent(pathname.slice('/api/admin/vehicles/'.length));
          await env.DB.prepare(`DELETE FROM vehicles WHERE id = ?`).bind(vehicleId).run();
          return jsonResponse({ ok: true, deletedId: vehicleId }, 200, cors);
        }

        // PUT /api/admin/tiktok/:id
        if (request.method === 'PUT' && pathname.startsWith('/api/admin/tiktok/')) {
          const postId = decodeURIComponent(pathname.slice('/api/admin/tiktok/'.length));
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          await upsertTikTokPost(postId, body, request, env);
          return jsonResponse({ ok: true, id: sanitizeId(postId, 'tt') }, 200, cors);
        }

        // DELETE /api/admin/tiktok/:id
        if (request.method === 'DELETE' && pathname.startsWith('/api/admin/tiktok/')) {
          const postId = decodeURIComponent(pathname.slice('/api/admin/tiktok/'.length));
          await env.DB.prepare(`DELETE FROM tiktok_posts WHERE id = ?`).bind(postId).run();
          return jsonResponse({ ok: true, deletedId: postId }, 200, cors);
        }

        // POST /api/admin/sync-store (full or partial showroom store sync / migration)
        if (request.method === 'POST' && pathname === '/api/admin/sync-store') {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          if (body.configUpdated || body.branding || body.hero || body.contact || body.tiktokHeader || body.adminEmails) {
            await upsertShowroomConfig(
              {
                branding: body.branding,
                hero: body.hero,
                tiktok: body.tiktokHeader ?? body.tiktok,
                contact: body.contact,
                adminEmails: body.adminEmails,
              },
              request,
              env
            );
          }

          if (Array.isArray(body.upsertVehicles)) {
            for (const v of body.upsertVehicles) {
              if (v && typeof v === 'object') {
                const record = v as Record<string, unknown>;
                await upsertVehicle(String(record.id ?? ''), record, request, env);
              }
            }
          }

          if (Array.isArray(body.deleteVehicleIds)) {
            for (const id of body.deleteVehicleIds) {
              if (typeof id === 'string' && id.trim()) {
                await env.DB.prepare(`DELETE FROM vehicles WHERE id = ?`).bind(id.trim()).run();
              }
            }
          }

          if (Array.isArray(body.upsertTikTokPosts)) {
            for (const p of body.upsertTikTokPosts) {
              if (p && typeof p === 'object') {
                const record = p as Record<string, unknown>;
                await upsertTikTokPost(String(record.id ?? ''), record, request, env);
              }
            }
          }

          if (Array.isArray(body.deleteTikTokPostIds)) {
            for (const id of body.deleteTikTokPostIds) {
              if (typeof id === 'string' && id.trim()) {
                await env.DB.prepare(`DELETE FROM tiktok_posts WHERE id = ?`).bind(id.trim()).run();
              }
            }
          }

          return jsonResponse({ ok: true, syncedBy: admin.email }, 200, cors);
        }

        // POST /api/admin/reset
        if (request.method === 'POST' && pathname === '/api/admin/reset') {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM vehicles`),
            env.DB.prepare(`DELETE FROM tiktok_posts`),
          ]);
          await upsertShowroomConfig(body, request, env);
          return jsonResponse({ ok: true }, 200, cors);
        }

        // GET /api/admin/inquiries
        if (request.method === 'GET' && pathname === '/api/admin/inquiries') {
          const res = await env.DB.prepare(
            `SELECT id, name, phone, email, vehicle_title, message, created_at
             FROM inquiries ORDER BY created_at_ms DESC LIMIT 200`
          ).all();
          const inquiries = (res.results ?? []).map((row) => ({
            id: String(row.id ?? ''),
            name: String(row.name ?? ''),
            phone: String(row.phone ?? ''),
            email: String(row.email ?? ''),
            vehicleTitle: String(row.vehicle_title ?? ''),
            message: String(row.message ?? ''),
            createdAt: String(row.created_at ?? ''),
          }));
          return jsonResponse({ inquiries }, 200, cors);
        }

        // GET /api/admin/visits/summary
        if (request.method === 'GET' && pathname === '/api/admin/visits/summary') {
          const todayKey = new Date().toISOString().slice(0, 10);
          const [totals, today, recent] = await Promise.all([
            env.DB.prepare(
              `SELECT COUNT(*) AS totalVisits, COUNT(DISTINCT visitor_id) AS uniqueVisitors FROM page_visits`
            ).first(),
            env.DB.prepare(
              `SELECT COUNT(*) AS todayVisits, COUNT(DISTINCT visitor_id) AS todayUnique FROM page_visits WHERE date_key = ?`
            )
              .bind(todayKey)
              .first(),
            env.DB.prepare(
              `SELECT id, page, visitor_id, date_key, referrer, timestamp_millis
               FROM page_visits ORDER BY timestamp_millis DESC LIMIT 50`
            ).all(),
          ]);
          return jsonResponse(
            {
              totalVisits: Number(totals?.totalVisits ?? 0),
              uniqueVisitors: Number(totals?.uniqueVisitors ?? 0),
              todayVisits: Number(today?.todayVisits ?? 0),
              todayUnique: Number(today?.todayUnique ?? 0),
              recent: recent.results ?? [],
            },
            200,
            cors
          );
        }

        // GET /api/admin/sessions
        if (request.method === 'GET' && pathname === '/api/admin/sessions') {
          const res = await env.DB.prepare(
            `SELECT * FROM admin_sessions ORDER BY updated_at_ms DESC LIMIT 50`
          ).all();
          return jsonResponse({ sessions: res.results ?? [] }, 200, cors);
        }

        // PUT /api/admin/sessions/:id
        if (request.method === 'PUT' && pathname.startsWith('/api/admin/sessions/')) {
          const sessionId = sanitizeId(
            decodeURIComponent(pathname.slice('/api/admin/sessions/'.length)),
            'web'
          );
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const now = Date.now();
          const status = body.status === 'revoked' ? 'revoked' : 'active';
          await env.DB.prepare(
            `INSERT INTO admin_sessions (
              id, uid, device_id, device_name, platform, email, location,
              login_at_millis, last_active_millis, status, user_agent, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              device_name = excluded.device_name,
              platform = excluded.platform,
              email = excluded.email,
              location = excluded.location,
              last_active_millis = excluded.last_active_millis,
              status = excluded.status,
              user_agent = excluded.user_agent,
              updated_at_ms = excluded.updated_at_ms`
          )
            .bind(
              sessionId,
              admin.uid,
              clampStr(body.deviceId, 128, 'browser'),
              clampStr(body.deviceName, 160, 'Web Browser'),
              clampStr(body.platform, 40, 'Website'),
              admin.email,
              clampStr(body.location, 160, ''),
              Number(body.loginAtMillis ?? now),
              now,
              status,
              clampStr(body.userAgent, 300, ''),
              now,
              now
            )
            .run();
          return jsonResponse({ ok: true, id: sessionId, status }, 200, cors);
        }

        // POST /api/admin/sessions/:id/revoke
        if (request.method === 'POST' && pathname.startsWith('/api/admin/sessions/') && pathname.endsWith('/revoke')) {
          const rawId = pathname.slice('/api/admin/sessions/'.length, -'/revoke'.length);
          const sessionId = sanitizeId(decodeURIComponent(rawId), 'web');
          const now = Date.now();
          await env.DB.prepare(
            `UPDATE admin_sessions SET status = 'revoked', updated_at_ms = ? WHERE id = ?`
          )
            .bind(now, sessionId)
            .run();
          return jsonResponse({ ok: true, id: sessionId, status: 'revoked' }, 200, cors);
        }

        return jsonResponse({ error: 'Unknown admin endpoint.' }, 404, cors);
      }

      return jsonResponse({ error: 'Not found.' }, 404, cors);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error.';
      return jsonResponse({ error: message }, 500, cors);
    }
  },
};
