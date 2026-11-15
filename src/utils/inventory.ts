import type {
  LocationContact,
  TikTokSectionConfig,
  Vehicle,
  VehicleFilters,
} from '../types/showroom';

export function filterVehicles(vehicles: Vehicle[], filters: VehicleFilters): Vehicle[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const normalizedMake = filters.make.trim().toLowerCase();
  const normalizedModel = filters.model.trim().toLowerCase();
  const normalizedYear = filters.year.trim();

  return vehicles.filter((vehicle) => {
    if (filters.status && filters.status !== 'all' && vehicle.status !== filters.status) {
      return false;
    }

    if (normalizedMake && !vehicle.make.toLowerCase().includes(normalizedMake)) {
      return false;
    }

    if (normalizedModel && !vehicle.model.toLowerCase().includes(normalizedModel)) {
      return false;
    }

    if (normalizedYear && !String(vehicle.year).includes(normalizedYear)) {
      return false;
    }

    if (normalizedQuery) {
      const haystack = [
        vehicle.title,
        vehicle.make,
        vehicle.model,
        String(vehicle.year),
        vehicle.description,
        vehicle.fuelType,
        vehicle.origin,
        vehicle.color,
      ]
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(normalizedQuery)) {
        return false;
      }
    }

    return true;
  });
}

export function getFilterOptions(
  vehicles: Vehicle[],
  selectedMake: string
): {
  makes: string[];
  models: string[];
  years: number[];
} {
  const makesSet = new Set<string>();
  const modelsSet = new Set<string>();
  const yearsSet = new Set<number>();
  const normalizedMake = selectedMake.trim().toLowerCase();

  for (const vehicle of vehicles) {
    if (vehicle.make.trim()) {
      makesSet.add(vehicle.make.trim());
    }
    if (!normalizedMake || vehicle.make.toLowerCase().includes(normalizedMake)) {
      if (vehicle.model.trim()) {
        modelsSet.add(vehicle.model.trim());
      }
    }
    if (Number.isFinite(vehicle.year)) {
      yearsSet.add(vehicle.year);
    }
  }

  return {
    makes: Array.from(makesSet).sort((a, b) => a.localeCompare(b)),
    models: Array.from(modelsSet).sort((a, b) => a.localeCompare(b)),
    years: Array.from(yearsSet).sort((a, b) => b - a),
  };
}

export function formatPrice(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Price on Request';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function normalizeTikTokUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  const embeddedMatch = trimmed.match(/https?:\/\/[^\s<>"]*tiktok\.com[^\s<>"]*/i);
  if (embeddedMatch) {
    return embeddedMatch[0].replace(/[),.;!?]+$/, '');
  }

  const bareHostMatch = trimmed.match(
    /(?:^|\s)((?:www\.|vt\.|vm\.|m\.|lite\.)?tiktok\.com\/[^\s<>"]*)/i
  );
  if (bareHostMatch) {
    return `https://${bareHostMatch[1].replace(/[),.;!?]+$/, '')}`;
  }

  return trimmed;
}

export function extractTikTokVideoId(rawUrl: string): string | null {
  const normalized = normalizeTikTokUrl(rawUrl);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (!parsed.hostname.toLowerCase().includes('tiktok.com')) {
      return null;
    }
    const match = parsed.pathname.match(/\/video\/(\d+)/);
    if (match) return match[1];
    const queryId =
      parsed.searchParams.get('item_id') || parsed.searchParams.get('share_item_id');
    return queryId && /^\d+$/.test(queryId) ? queryId : null;
  } catch {
    return null;
  }
}

export function isTikTokVideoUrl(rawUrl: string): boolean {
  const normalized = normalizeTikTokUrl(rawUrl);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('tiktok.com')) {
      return false;
    }
    if (host.startsWith('vt.') || host.startsWith('vm.') || host.startsWith('lite.')) {
      return parsed.pathname.replace(/\//g, '').length > 0;
    }
    if (/\/t\/[a-zA-Z0-9]+/.test(parsed.pathname)) {
      return true;
    }
    if (/\/v\/\d+/.test(parsed.pathname)) {
      return true;
    }
    if (/\/(?:video|photo)\/\d+/.test(parsed.pathname)) {
      return true;
    }
    const queryId =
      parsed.searchParams.get('item_id') || parsed.searchParams.get('share_item_id');
    return Boolean(queryId && /^\d+$/.test(queryId));
  } catch {
    return false;
  }
}

export function filterActiveTikTokPosts<T extends { tiktokUrl: string }>(posts: T[]): T[] {
  return posts.filter((post) => isTikTokVideoUrl(post.tiktokUrl));
}

export type TikTokAdminCardMode = 'collapsed' | 'edit' | 'change-link';

export function resolveTikTokAdminCardMode(
  tiktokUrl: string,
  explicitMode?: 'edit' | 'change-link'
): TikTokAdminCardMode {
  if (explicitMode) return explicitMode;
  return isTikTokVideoUrl(tiktokUrl) ? 'collapsed' : 'edit';
}

const GENERIC_TIKTOK_HASHTAGS = new Set([
  'alifcarimport',
  'alif_car_import',
  'ethiopiantiktok',
  'ethiopian_tik_tok',
  'ethiopia',
  'creatorsearchinsights',
  'fyp',
  'foryou',
  'foryoupage',
  'viral',
  'trending',
  'tiktok',
  'car',
  'cars',
  'auto',
]);

function humanizeHashtagToken(tag: string): string {
  const withoutHash = tag.replace(/^#+/, '').replace(/[_-]+/g, ' ');
  const splitCamel = withoutHash.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return splitCamel.replace(/\s+/g, ' ').trim();
}

export function deriveTitleFromVideoDescription(
  description: string,
  maxLength = 68
): string {
  const normalized = description
    .replace(/\u200d/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  // Text appearing before any #hashtag or @mention is almost always the creator's main title/caption
  const firstTagOrMentionIdx = normalized.search(/[#@]/);
  const leadingProse = (
    firstTagOrMentionIdx === -1 ? normalized : normalized.slice(0, firstTagOrMentionIdx)
  )
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:|.,!?]+|[\s\-–—:|.,!?]+$/g, '')
    .trim();

  // Also check prose between hashtags while discarding multi-word @mention spans
  const withoutMentionsAndTags = normalized
    .replace(/@[^#@]+?(?=\s*[@#]|$)/g, ' ')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:|.,!?]+|[\s\-–—:|.,!?]+$/g, '')
    .trim();

  const proseCandidate = leadingProse.length >= 6 ? leadingProse : withoutMentionsAndTags;
  const proseWords = proseCandidate
    .split(/\s+/)
    .filter((w) => /[a-zA-Z0-9\u1200-\u137F]/.test(w));

  let candidate = '';

  if (proseWords.length >= 2 && proseCandidate.length >= 8) {
    const firstSentence = proseCandidate.split(/[.!?](?:\s|$)/)[0]?.trim() || proseCandidate;
    candidate = firstSentence;
  } else {
    const tags = normalized.match(/#[^\s#]+/g) ?? [];
    const meaningfulTags: string[] = [];
    for (const rawTag of tags) {
      const cleanedEmoji = rawTag.replace(
        /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F]/gu,
        ''
      );
      const key = cleanedEmoji.replace(/^#+/, '').toLowerCase();
      if (!key || GENERIC_TIKTOK_HASHTAGS.has(key)) continue;
      const readable = humanizeHashtagToken(cleanedEmoji);
      if (readable) meaningfulTags.push(readable);
      if (meaningfulTags.length >= 4) break;
    }

    if (meaningfulTags.length > 0) {
      candidate = meaningfulTags.join(' · ');
    } else if (proseCandidate) {
      candidate = proseCandidate;
    } else {
      candidate = normalized
        .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F]/gu, ' ')
        .replace(/[#@]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  if (candidate.length <= maxLength) {
    return candidate;
  }

  const sliced = candidate.slice(0, maxLength);
  const lastSpace = sliced.lastIndexOf(' ');
  const trimmed = lastSpace > 20 ? sliced.slice(0, lastSpace) : sliced;
  return `${trimmed.replace(/[\s\-–—:,.;]+$/g, '')}...`;
}

export function isValidHttpUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('data:image/')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface VehicleValidationErrors {
  title?: string;
  make?: string;
  model?: string;
  year?: string;
  price?: string;
  description?: string;
  tiktokUrl?: string;
}

export function validateVehicleInput(input: {
  title: string;
  make: string;
  model: string;
  year: number | string;
  price: number | string;
  description: string;
  tiktokUrl?: string;
}): VehicleValidationErrors {
  const errors: VehicleValidationErrors = {};

  if (!input.title || !input.title.trim()) {
    errors.title = 'Post title is required.';
  }
  if (!input.make || !input.make.trim()) {
    errors.make = 'Make is required.';
  }
  if (!input.model || !input.model.trim()) {
    errors.model = 'Model is required.';
  }

  const yearNum = Number(input.year);
  if (!Number.isInteger(yearNum) || yearNum < 1980 || yearNum > 2030) {
    errors.year = 'Enter a valid year between 1980 and 2030.';
  }

  const priceNum = Number(input.price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    errors.price = 'Enter a valid non-negative price.';
  }

  if (!input.description || !input.description.trim()) {
    errors.description = 'Vehicle details write-up is required.';
  }

  if (input.tiktokUrl && input.tiktokUrl.trim()) {
    try {
      const parsed = new URL(input.tiktokUrl.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.tiktokUrl = 'Enter a valid http(s) TikTok link.';
      }
    } catch {
      errors.tiktokUrl = 'Enter a valid TikTok URL (e.g. https://www.tiktok.com/...).';
    }
  }

  return errors;
}

export const DEFAULT_ADMIN_EMAILS = ['mubyzeru@gmail.com', 'admin@alifcarimport.com'];

export function isAuthorizedAdminEmail(
  rawEmail: string,
  extraAdminEmails?: string[]
): boolean {
  const normalized = rawEmail.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return false;

  const allowed = new Set<string>(DEFAULT_ADMIN_EMAILS.map((e) => e.toLowerCase()));
  if (Array.isArray(extraAdminEmails)) {
    for (const email of extraAdminEmails) {
      if (typeof email === 'string' && email.trim()) {
        allowed.add(email.trim().toLowerCase());
      }
    }
  }
  return allowed.has(normalized);
}

export function buildWhatsAppHref(rawNumber: string, message: string): string {
  const trimmed = rawNumber.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^(?:www\.)?(?:wa\.me|api\.whatsapp\.com)\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return '#contact';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export type SocialPlatform =
  | 'telegram'
  | 'instagram'
  | 'facebook'
  | 'x'
  | 'whatsapp'
  | 'tiktok';

export interface ConfiguredSocialLink {
  platform: SocialPlatform;
  label: string;
  handleText: string;
  href: string;
}

const PLATFORM_DOMAIN_PREFIXES: Record<Exclude<SocialPlatform, 'whatsapp'>, RegExp> = {
  telegram: /^(?:www\.)?(?:t\.me|telegram\.me)\//i,
  instagram: /^(?:www\.)?instagram\.com\//i,
  facebook: /^(?:www\.|m\.)?(?:facebook\.com|fb\.com)\//i,
  x: /^(?:www\.)?(?:x\.com|twitter\.com)\//i,
  tiktok: /^(?:www\.|vt\.|vm\.)?tiktok\.com\//i,
};

export function buildSocialMediaUrl(
  platform: SocialPlatform,
  rawInput?: string,
  whatsappMessage = ''
): string | null {
  const trimmed = (rawInput ?? '').trim();
  if (!trimmed) return null;

  if (platform === 'whatsapp') {
    const href = buildWhatsAppHref(trimmed, whatsappMessage);
    return href === '#contact' ? null : href;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (PLATFORM_DOMAIN_PREFIXES[platform].test(trimmed)) {
    return `https://${trimmed}`;
  }

  const handle = trimmed.replace(/^[@/]+/, '').replace(/\/+$/, '');
  if (!handle) return null;

  switch (platform) {
    case 'telegram':
      return `https://t.me/${handle}`;
    case 'instagram':
      return `https://www.instagram.com/${handle}`;
    case 'facebook':
      return `https://www.facebook.com/${handle}`;
    case 'x':
      return `https://x.com/${handle}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
  }
}

export function getConfiguredSocialLinks(
  contact: Pick<
    LocationContact,
    'whatsapp' | 'phone' | 'telegram' | 'instagram' | 'facebook' | 'x'
  >,
  tiktok?: Pick<TikTokSectionConfig, 'handle' | 'profileUrl'> | null,
  companyName = 'Alif Car Import'
): ConfiguredSocialLink[] {
  const links: ConfiguredSocialLink[] = [];
  const defaultMsg = `Hello ${companyName}, I would like to ask about an imported vehicle.`;

  const whatsappRaw = (contact.whatsapp || '').trim();
  const whatsappHref = buildSocialMediaUrl('whatsapp', whatsappRaw, defaultMsg);
  if (whatsappHref) {
    links.push({
      platform: 'whatsapp',
      label: 'WhatsApp',
      handleText: whatsappRaw,
      href: whatsappHref,
    });
  }

  const telegramRaw = (contact.telegram || '').trim();
  const telegramHref = buildSocialMediaUrl('telegram', telegramRaw);
  if (telegramHref) {
    links.push({
      platform: 'telegram',
      label: 'Telegram',
      handleText: telegramRaw,
      href: telegramHref,
    });
  }

  const instagramRaw = (contact.instagram || '').trim();
  const instagramHref = buildSocialMediaUrl('instagram', instagramRaw);
  if (instagramHref) {
    links.push({
      platform: 'instagram',
      label: 'Instagram',
      handleText: instagramRaw,
      href: instagramHref,
    });
  }

  const facebookRaw = (contact.facebook || '').trim();
  const facebookHref = buildSocialMediaUrl('facebook', facebookRaw);
  if (facebookHref) {
    links.push({
      platform: 'facebook',
      label: 'Facebook',
      handleText: facebookRaw,
      href: facebookHref,
    });
  }

  const xRaw = (contact.x || '').trim();
  const xHref = buildSocialMediaUrl('x', xRaw);
  if (xHref) {
    links.push({
      platform: 'x',
      label: 'X',
      handleText: xRaw,
      href: xHref,
    });
  }

  if (tiktok) {
    const tiktokHref =
      buildSocialMediaUrl('tiktok', tiktok.profileUrl) ||
      buildSocialMediaUrl('tiktok', tiktok.handle);
    if (tiktokHref) {
      links.push({
        platform: 'tiktok',
        label: 'TikTok',
        handleText: tiktok.handle || tiktok.profileUrl,
        href: tiktokHref,
      });
    }
  }

  return links;
}

export function formatVehicleTileModel(vehicle: {
  title: string;
  make: string;
  model: string;
  year: number;
}): string {
  const escapedMake = vehicle.make
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const yearStr = String(vehicle.year);

  let cleaned = vehicle.title.trim();
  if (yearStr) {
    cleaned = cleaned.replace(new RegExp(`^${yearStr}\\s+`, 'i'), '');
  }
  if (escapedMake) {
    cleaned = cleaned.replace(new RegExp(`^${escapedMake}\\s+`, 'i'), '');
  }
  if (yearStr) {
    cleaned = cleaned.replace(new RegExp(`^${yearStr}\\s+`, 'i'), '');
  }

  cleaned = cleaned.trim();
  return cleaned || vehicle.model || vehicle.title;
}

