import crypto from 'node:crypto';
import express from 'express';
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
    const mime = contentType.split(';')[0] || 'image/jpeg';
    if (arrayBuffer.byteLength <= 380 * 1024) {
      return `data:${mime};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
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
  const videoIdMatch = cleanResolvedUrl.match(/\/(?:video|photo)\/(\d+)/);
  let videoId = videoIdMatch ? videoIdMatch[1] : null;
  let resolvedFinalUrl = cleanResolvedUrl;
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
                imagePost?: {
                  cover?: { imageURL?: { urlList?: string[] } };
                  images?: Array<{ imageURL?: { urlList?: string[] } }>;
                };
              };
            };
          }
        | undefined;
      const item = videoDetail?.itemInfo?.itemStruct;
      if (item) {
        if (!videoId && item.id) {
          videoId = item.id;
        }
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
        const photoCover =
          item.imagePost?.cover?.imageURL?.urlList?.[0] ||
          item.imagePost?.images?.[0]?.imageURL?.urlList?.[0];
        if (photoCover && !rawCovers.some((c) => c.url === photoCover)) {
          rawCovers.push({
            label: 'Photo Cover',
            key: `${idSeed}-photo`,
            url: photoCover,
          });
        }
      }
    } catch {
      // Fall through to tikwm / oEmbed / OpenGraph fallback
    }
  }

  // Server-side tikwm fallback if TikTok HTML did not yield a cover (e.g. bot check or short link)
  if (!description || rawCovers.length === 0) {
    try {
      const twRes = await fetch(
        `https://www.tikwm.com/api/?url=${encodeURIComponent(trimmed)}`,
        {
          headers: { 'User-Agent': BROWSER_USER_AGENT },
          signal: AbortSignal.timeout(9000),
        }
      );
      if (twRes.ok) {
        const twJson = (await twRes.json()) as {
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
        const item = twJson?.data;
        if (twJson?.code === 0 && item) {
          if (!videoId && item.id) {
            videoId = item.id;
          }
          if (!authorHandle && item.author?.unique_id) {
            authorHandle = `@${item.author.unique_id}`;
          }
          if (videoId && item.author?.unique_id && !resolvedFinalUrl.includes('/video/')) {
            resolvedFinalUrl = `https://www.tiktok.com/@${item.author.unique_id}/video/${videoId}`;
          }
          if (!description && typeof item.title === 'string') {
            description = item.title.trim();
          }
          const idSeed =
            videoId || crypto.createHash('md5').update(cleanResolvedUrl).digest('hex').slice(0, 12);
          if (
            typeof item.cover === 'string' &&
            item.cover.startsWith('http') &&
            !rawCovers.some((c) => c.url === item.cover)
          ) {
            rawCovers.push({
              label: 'Video Cover',
              key: `${idSeed}-tw-cover`,
              url: item.cover,
            });
          }
          if (
            typeof item.origin_cover === 'string' &&
            item.origin_cover.startsWith('http') &&
            item.origin_cover !== item.cover &&
            !rawCovers.some((c) => c.url === item.origin_cover)
          ) {
            rawCovers.push({
              label: 'Clean Video Frame',
              key: `${idSeed}-tw-frame`,
              url: item.origin_cover,
            });
          }
          if (
            Array.isArray(item.images) &&
            typeof item.images[0] === 'string' &&
            item.images[0].startsWith('http') &&
            !rawCovers.some((c) => c.url === item.images![0])
          ) {
            rawCovers.push({
              label: 'Photo Cover',
              key: `${idSeed}-tw-photo`,
              url: item.images[0],
            });
          }
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
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(resolvedFinalUrl)}`,
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
            videoId || crypto.createHash('md5').update(resolvedFinalUrl).digest('hex').slice(0, 12);
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
        videoId || crypto.createHash('md5').update(resolvedFinalUrl).digest('hex').slice(0, 12);
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
    resolvedUrl: resolvedFinalUrl,
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

  app.get('/api/store', async (_req, res) => {
    try {
      const store = await readJsonFile<Record<string, unknown>>(STORE_PATH);
      res.json({ initialized: Boolean(store), data: store });
    } catch (error) {
      console.error('Failed to read store:', error);
      res.status(500).json({ error: 'Unable to read showroom data.' });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  const assetsRootDir = isProd
    ? path.join(__dirname, 'dist', 'assets')
    : path.join(__dirname, 'public', 'assets');

  // Serve repo-prefixed static assets (e.g. /AlifCarImport/assets/...) directly instead of SPA HTML
  app.get(/^\/[^/]+\/assets\/(.+)$/, async (req, res, next) => {
    const rawRelPath = req.params[0];
    if (!rawRelPath) {
      next();
      return;
    }
    let decodedRelPath: string;
    try {
      decodedRelPath = decodeURIComponent(rawRelPath);
    } catch {
      next();
      return;
    }
    const candidate = path.resolve(assetsRootDir, decodedRelPath);
    const relative = path.relative(assetsRootDir, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      next();
      return;
    }
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.sendFile(candidate);
        return;
      }
    } catch {
      // Fall through to normal static/Vite handler
    }
    next();
  });

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
