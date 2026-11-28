import { extractTikTokVideoId, normalizeTikTokUrl } from './inventory';

export interface TikTokLaunchLinkProps {
  href: string;
  target?: '_blank';
  rel?: string;
}

const ALLOWED_TIKTOK_HOST_RE = /(^|\.)tiktok\.com$/i;
const NUMERIC_VIDEO_ID_RE = /^\d{6,30}$/;

function parseSafeTikTokHttpsUrl(rawUrl: string): URL | null {
  const normalized = normalizeTikTokUrl(rawUrl);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (!ALLOWED_TIKTOK_HOST_RE.test(parsed.hostname)) {
      return null;
    }
    parsed.protocol = 'https:';
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Builds platform-aware link props that launch the native TikTok mobile app
 * directly on Android (via Android Intent URI with safe browser fallback,
 * avoiding Samsung Internet / Chrome opening an in-browser tab) and iOS
 * (via direct Universal Link without target="_blank"), while opening TikTok
 * in a new tab on desktop browsers.
 */
export function buildTikTokAppLaunchProps(
  rawUrl: string,
  videoIdOverride?: string | null,
  userAgentOverride?: string
): TikTokLaunchLinkProps | null {
  const parsed = parseSafeTikTokHttpsUrl(rawUrl);
  if (!parsed) return null;

  const httpsUrl = parsed.toString();
  const ua =
    userAgentOverride ??
    (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '');

  const resolvedVideoId =
    (videoIdOverride && NUMERIC_VIDEO_ID_RE.test(videoIdOverride.trim())
      ? videoIdOverride.trim()
      : null) || extractTikTokVideoId(httpsUrl);

  const isAndroid = /\bAndroid\b/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  if (isAndroid) {
    const encodedFallback = encodeURIComponent(httpsUrl);
    if (resolvedVideoId && NUMERIC_VIDEO_ID_RE.test(resolvedVideoId)) {
      return {
        href: `intent://aweme/detail/${resolvedVideoId}#Intent;scheme=snssdk1233;package=com.zhiliaoapp.musically;S.browser_fallback_url=${encodedFallback};end`,
      };
    }
    const hostAndPath = `${parsed.host}${parsed.pathname}${parsed.search}`;
    return {
      href: `intent://${hostAndPath}#Intent;scheme=https;package=com.zhiliaoapp.musically;S.browser_fallback_url=${encodedFallback};end`,
    };
  }

  if (isIOS) {
    return {
      href: httpsUrl,
    };
  }

  return {
    href: httpsUrl,
    target: '_blank',
    rel: 'noopener noreferrer',
  };
}
