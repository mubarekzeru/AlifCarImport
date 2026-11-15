import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveTitleFromVideoDescription,
  normalizeTikTokUrl,
} from './src/utils/inventory.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const TIKTOK_COVERS_DIR = path.join(DATA_DIR, 'tiktok-covers');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const INQUIRIES_PATH = path.join(DATA_DIR, 'inquiries.json');

const DEFAULT_ADMIN_EMAILS = ['mubyzeru@gmail.com', 'admin@alifcarimport.com'];
const SESSION_COOKIE_NAME = 'alif_admin_session';
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.createHash('sha256').update(DATA_DIR).digest('hex');

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function getAuthorizedAdminEmails(): Promise<Set<string>> {
  const allowed = new Set<string>(DEFAULT_ADMIN_EMAILS.map((e) => e.toLowerCase()));
  if (process.env.ADMIN_EMAILS) {
    for (const part of process.env.ADMIN_EMAILS.split(',')) {
      const cleaned = part.trim().toLowerCase();
      if (cleaned) allowed.add(cleaned);
    }
  }
  try {
    const store = await readJsonFile<{ adminEmails?: unknown }>(STORE_PATH);
    if (store && Array.isArray(store.adminEmails)) {
      for (const email of store.adminEmails) {
        if (typeof email === 'string' && email.trim()) {
          allowed.add(email.trim().toLowerCase());
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return allowed;
}

function signSessionToken(email: string): string {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
  const payload = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      email?: string;
      exp?: number;
    };
    if (!decoded.email || !decoded.exp || decoded.exp < Date.now()) {
      return null;
    }
    return decoded.email;
  } catch {
    return null;
  }
}

async function getAuthenticatedAdminEmail(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies[SESSION_COOKIE_NAME];
  }
  const email = verifySessionToken(token);
  if (!email) return null;
  const allowed = await getAuthorizedAdminEmails();
  return allowed.has(email.toLowerCase()) ? email : null;
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  return req.secure || forwardedProto === 'https';
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const secure = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const secure = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
    'Max-Age=0',
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function isAllowedTikTokHost(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'tiktok.com' || host.endsWith('.tiktok.com');
  } catch {
    return false;
  }
}

async function downloadCoverToCache(
  imageUrl: string,
  cacheKey: string
): Promise<string | null> {
  if (!imageUrl || !imageUrl.startsWith('http')) return null;
  try {
    const imgRes = await fetch(imageUrl, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Referer: 'https://www.tiktok.com/',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!imgRes.ok) return null;
    const contentType = (imgRes.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const arrayBuffer = await imgRes.arrayBuffer();
    if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > 5 * 1024 * 1024) {
      return null;
    }
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
      ? 'webp'
      : 'jpg';
    await fs.mkdir(TIKTOK_COVERS_DIR, { recursive: true });
    const safeKey = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeKey}.${ext}`;
    await fs.writeFile(path.join(TIKTOK_COVERS_DIR, filename), Buffer.from(arrayBuffer));
    return `/api/tiktok-covers/${filename}`;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMetaTag(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
    'i'
  );
  const match = html.match(pattern);
  const raw = match?.[1] || match?.[2] || '';
  return raw ? decodeHtmlEntities(raw.trim()) : '';
}

async function resolveTikTokVideoMetadata(rawUrl: string): Promise<{
  resolvedUrl: string;
  videoId: string | null;
  description: string;
  suggestedTitle: string;
  coverImageUrl: string;
  coverOptions: { label: string; url: string }[];
  authorHandle: string;
}> {
  const trimmed = normalizeTikTokUrl(rawUrl);
  if (!isAllowedTikTokHost(trimmed)) {
    throw new Error('Enter a valid TikTok URL (e.g. https://vt.tiktok.com/... or https://www.tiktok.com/...).');
  }

  const pageRes = await fetch(trimmed, {
    redirect: 'follow',
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(12000),
  });

  const finalUrl = pageRes.url || trimmed;
  if (!isAllowedTikTokHost(finalUrl)) {
    throw new Error('Redirected URL is not a valid TikTok page.');
  }

  const cleanResolvedUrl = finalUrl.split('?')[0];
  const videoIdMatch = cleanResolvedUrl.match(/\/video\/(\d+)/);
  const videoId = videoIdMatch ? videoIdMatch[1] : null;
  const html = await pageRes.text();

  let description = '';
  let authorHandle = '';
  const rawCovers: { label: string; key: string; url: string }[] = [];

  const univMatch = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (univMatch) {
    try {
      const parsed = JSON.parse(univMatch[1]) as {
        __DEFAULT_SCOPE__?: Record<string, unknown>;
      };
      const videoDetail = parsed.__DEFAULT_SCOPE__?.['webapp.video-detail'] as
        | {
            itemInfo?: {
              itemStruct?: {
                id?: string;
                desc?: string;
                author?: { uniqueId?: string; nickname?: string };
                video?: {
                  cover?: string;
                  originCover?: string;
                  dynamicCover?: string;
                };
              };
            };
          }
        | undefined;
      const item = videoDetail?.itemInfo?.itemStruct;
      if (item) {
        if (typeof item.desc === 'string') {
          description = item.desc.trim();
        }
        if (item.author?.uniqueId) {
          authorHandle = `@${item.author.uniqueId}`;
        }
        const idSeed = item.id || videoId || crypto.createHash('md5').update(cleanResolvedUrl).digest('hex').slice(0, 12);
        if (item.video?.cover) {
          rawCovers.push({
            label: 'Video Cover',
            key: `${idSeed}-cover`,
            url: item.video.cover,
          });
        }
        if (item.video?.originCover && item.video.originCover !== item.video?.cover) {
          rawCovers.push({
            label: 'Clean Video Frame',
            key: `${idSeed}-frame`,
            url: item.video.originCover,
          });
        }
      }
    } catch {
      // Fall through to oEmbed / OpenGraph fallback
    }
  }

  // Fallback to TikTok oEmbed + OpenGraph meta tags if needed
  if (!description || rawCovers.length === 0) {
    try {
      const oeRes = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanResolvedUrl)}`,
        {
          headers: { 'User-Agent': BROWSER_USER_AGENT },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (oeRes.ok) {
        const oeJson = (await oeRes.json()) as {
          title?: string;
          thumbnail_url?: string;
          author_name?: string;
        };
        if (!description && typeof oeJson.title === 'string') {
          description = oeJson.title.trim();
        }
        if (!authorHandle && typeof oeJson.author_name === 'string') {
          authorHandle = oeJson.author_name.startsWith('@')
            ? oeJson.author_name
            : `@${oeJson.author_name}`;
        }
        if (typeof oeJson.thumbnail_url === 'string' && oeJson.thumbnail_url.startsWith('http')) {
          const idSeed =
            videoId || crypto.createHash('md5').update(cleanResolvedUrl).digest('hex').slice(0, 12);
          rawCovers.push({
            label: 'Video Thumbnail',
            key: `${idSeed}-oembed`,
            url: oeJson.thumbnail_url,
          });
        }
      }
    } catch {
      // Ignore oEmbed failure
    }
  }

  if (!description) {
    description =
      extractMetaTag(html, 'og:description') ||
      extractMetaTag(html, 'description') ||
      extractMetaTag(html, 'og:title');
  }
  if (rawCovers.length === 0) {
    const ogImg = extractMetaTag(html, 'og:image') || extractMetaTag(html, 'twitter:image');
    if (ogImg) {
      const idSeed =
        videoId || crypto.createHash('md5').update(cleanResolvedUrl).digest('hex').slice(0, 12);
      rawCovers.push({ label: 'Video Cover', key: `${idSeed}-og`, url: ogImg });
    }
  }

  const coverOptions: { label: string; url: string }[] = [];
  for (const candidate of rawCovers) {
    const cachedPath = await downloadCoverToCache(candidate.url, candidate.key);
    coverOptions.push({
      label: candidate.label,
      url: cachedPath || candidate.url,
    });
  }

  const suggestedTitle = deriveTitleFromVideoDescription(description);

  return {
    resolvedUrl: cleanResolvedUrl,
    videoId,
    description,
    suggestedTitle,
    coverImageUrl: coverOptions[0]?.url || '',
    coverOptions,
    authorHandle,
  };
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/tiktok-covers/:filename', async (req, res) => {
    const safeName = path.basename(req.params.filename || '');
    if (!/^[a-zA-Z0-9._-]+$/.test(safeName)) {
      res.status(400).end();
      return;
    }
    const targetPath = path.join(TIKTOK_COVERS_DIR, safeName);
    try {
      const data = await fs.readFile(targetPath);
      const ext = path.extname(safeName).toLowerCase();
      res.setHeader(
        'Content-Type',
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      );
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.send(data);
    } catch {
      res.status(404).end();
    }
  });

  app.post('/api/tiktok-metadata', async (req, res) => {
    const rawUrl = req.body?.url;
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      res.status(400).json({ error: 'Please provide a TikTok video link.' });
      return;
    }
    try {
      const metadata = await resolveTikTokVideoMetadata(rawUrl);
      res.json(metadata);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to fetch video description and cover image from TikTok.',
      });
    }
  });

  app.get('/api/auth/session', async (req, res) => {
    const email = await getAuthenticatedAdminEmail(req);
    res.json({ authenticated: Boolean(email), email });
  });

  app.post('/api/auth/login', async (req, res) => {
    const rawEmail = req.body?.email;
    if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
      res.status(400).json({ error: 'Please enter an admin email address.' });
      return;
    }
    const normalized = rawEmail.trim().toLowerCase();
    const allowed = await getAuthorizedAdminEmails();
    if (!allowed.has(normalized)) {
      res.status(403).json({
        error: 'This email is not authorized for admin access.',
      });
      return;
    }
    const token = signSessionToken(normalized);
    setSessionCookie(req, res, token);
    res.json({ authenticated: true, email: normalized, token });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/store', async (_req, res) => {
    try {
      const store = await readJsonFile<Record<string, unknown>>(STORE_PATH);
      res.json({ initialized: Boolean(store), data: store });
    } catch (error) {
      console.error('Failed to read store:', error);
      res.status(500).json({ error: 'Unable to read showroom data.' });
    }
  });

  app.put('/api/store', async (req, res) => {
    try {
      const adminEmail = await getAuthenticatedAdminEmail(req);
      if (!adminEmail) {
        res.status(401).json({ error: 'Admin email login required to save changes.' });
        return;
      }
      const payload = req.body;
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.vehicles)) {
        res.status(400).json({ error: 'Invalid showroom payload.' });
        return;
      }
      await writeJsonFile(STORE_PATH, payload);
      res.json({ ok: true, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Failed to save store:', error);
      res.status(500).json({ error: 'Unable to persist showroom data.' });
    }
  });

  app.delete('/api/store', async (req, res) => {
    try {
      const adminEmail = await getAuthenticatedAdminEmail(req);
      if (!adminEmail) {
        res.status(401).json({ error: 'Admin email login required to reset showroom data.' });
        return;
      }
      await fs.unlink(STORE_PATH).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
      });
      res.json({ ok: true });
    } catch (error) {
      console.error('Failed to reset store:', error);
      res.status(500).json({ error: 'Unable to reset showroom data.' });
    }
  });

  app.get('/api/inquiries', async (req, res) => {
    try {
      const adminEmail = await getAuthenticatedAdminEmail(req);
      if (!adminEmail) {
        res.status(401).json({ error: 'Admin login required.' });
        return;
      }
      const list = (await readJsonFile<unknown[]>(INQUIRIES_PATH)) ?? [];
      res.json({ data: list });
    } catch (error) {
      console.error('Failed to read inquiries:', error);
      res.status(500).json({ error: 'Unable to load inquiries.' });
    }
  });

  app.post('/api/inquiries', async (req, res) => {
    try {
      const { name, phone, email, vehicleTitle, message } = req.body ?? {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Name is required.' });
        return;
      }
      if (!phone || typeof phone !== 'string' || !phone.trim()) {
        res.status(400).json({ error: 'Phone number is required.' });
        return;
      }
      const existing = (await readJsonFile<Record<string, unknown>[]>(INQUIRIES_PATH)) ?? [];
      const entry = {
        id: `inq_${Date.now()}`,
        name: name.trim(),
        phone: phone.trim(),
        email: typeof email === 'string' ? email.trim() : '',
        vehicleTitle: typeof vehicleTitle === 'string' ? vehicleTitle.trim() : '',
        message: typeof message === 'string' ? message.trim() : '',
        createdAt: new Date().toISOString(),
      };
      const updated = [entry, ...existing].slice(0, 100);
      await writeJsonFile(INQUIRIES_PATH, updated);
      res.status(201).json({ ok: true, data: entry });
    } catch (error) {
      console.error('Failed to save inquiry:', error);
      res.status(500).json({ error: 'Unable to submit inquiry.' });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Alif Car Import server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
