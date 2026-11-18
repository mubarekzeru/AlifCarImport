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

export const DEFAULT_ADMIN_EMAILS = ['alifcarimports@gmail.com'];

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

export function getVehicleGalleryImages(
  vehicle: Pick<Vehicle, 'imageUrl' | 'galleryImages'>
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const pushUnique = (raw?: string) => {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  };

  pushUnique(vehicle.imageUrl);
  if (Array.isArray(vehicle.galleryImages)) {
    for (const url of vehicle.galleryImages) {
      pushUnique(url);
    }
  }

  return result;
}

export function getRelatedShowroomVehicles(
  vehicles: Vehicle[],
  currentVehicle: Pick<Vehicle, 'id' | 'make'>
): Vehicle[] {
  const currentMake = currentVehicle.make.trim().toLowerCase();
  const others = vehicles.filter((v) => v.id !== currentVehicle.id);

  const statusRank = (status: Vehicle['status']) =>
    status === 'available' ? 0 : status === 'reserved' ? 1 : 2;

  return [...others].sort((a, b) => {
    const aAvail = statusRank(a.status);
    const bAvail = statusRank(b.status);
    if (aAvail !== bAvail) return aAvail - bAvail;

    const aSameMake = a.make.trim().toLowerCase() === currentMake ? 0 : 1;
    const bSameMake = b.make.trim().toLowerCase() === currentMake ? 0 : 1;
    if (aSameMake !== bSameMake) return aSameMake - bSameMake;

    return 0;
  });
}

export function getSimilarVehicles(
  vehicles: Vehicle[],
  currentVehicle: Pick<Vehicle, 'id' | 'make' | 'origin'>
): Vehicle[] {
  const targetMake = currentVehicle.make.trim().toLowerCase();
  const targetOrigin = currentVehicle.origin.trim().toLowerCase();

  const matches = vehicles.filter((v) => {
    if (v.id === currentVehicle.id) return false;
    const sameMake = Boolean(targetMake) && v.make.trim().toLowerCase() === targetMake;
    const sameOrigin = Boolean(targetOrigin) && v.origin.trim().toLowerCase() === targetOrigin;
    return sameMake || sameOrigin;
  });

  const statusRank = (status: Vehicle['status']) =>
    status === 'available' ? 0 : status === 'reserved' ? 1 : 2;

  return [...matches].sort((a, b) => {
    const aSameMake = a.make.trim().toLowerCase() === targetMake ? 0 : 1;
    const bSameMake = b.make.trim().toLowerCase() === targetMake ? 0 : 1;
    if (aSameMake !== bSameMake) return aSameMake - bSameMake;
    return statusRank(a.status) - statusRank(b.status);
  });
}

export interface VehiclePricingBreakdown {
  originalPrice: number;
  finalPrice: number;
  discountAmount: number;
  discountPercent: number;
  hasDiscount: boolean;
}

export function getVehiclePricingBreakdown(
  vehicle: Pick<Vehicle, 'price' | 'originalPrice'>
): VehiclePricingBreakdown {
  const finalPrice = Number.isFinite(vehicle.price) && vehicle.price > 0 ? vehicle.price : 0;
  const rawOriginal =
    typeof vehicle.originalPrice === 'number' && Number.isFinite(vehicle.originalPrice)
      ? vehicle.originalPrice
      : 0;

  if (finalPrice > 0 && rawOriginal > finalPrice) {
    const discountAmount = rawOriginal - finalPrice;
    const discountPercent = Math.round((discountAmount / rawOriginal) * 100);
    return {
      originalPrice: rawOriginal,
      finalPrice,
      discountAmount,
      discountPercent,
      hasDiscount: true,
    };
  }

  return {
    originalPrice: finalPrice,
    finalPrice,
    discountAmount: 0,
    discountPercent: 0,
    hasDiscount: false,
  };
}

export interface ColorSwatchOption {
  label: string;
  query: string;
  swatchClass: string;
  isReset?: boolean;
}

interface ColorPaletteEntry {
  label: string;
  keywords: string[];
  swatchClass: string;
}

const COLOR_PALETTE_DEFINITIONS: ColorPaletteEntry[] = [
  {
    label: 'Pearl White',
    keywords: ['white', 'pearl', 'ivory', 'chalk'],
    swatchClass: 'bg-[#f4f4f5] border-zinc-400',
  },
  {
    label: 'Obsidian Black',
    keywords: ['black', 'obsidian', 'onyx', 'ebony'],
    swatchClass: 'bg-[#121215] border-zinc-600',
  },
  {
    label: 'Carmine Red',
    keywords: ['red', 'carmine', 'crimson', 'scarlet'],
    swatchClass: 'bg-[#D92027] border-red-400/50',
  },
  {
    label: 'Titanium Silver',
    keywords: ['silver', 'titanium', 'chrome'],
    swatchClass: 'bg-[#9ca3af] border-zinc-500',
  },
  {
    label: 'Slate Gray',
    keywords: ['gray', 'grey', 'slate', 'charcoal', 'graphite'],
    swatchClass: 'bg-[#52525b] border-zinc-500',
  },
  {
    label: 'Deep Emerald',
    keywords: ['emerald', 'green', 'olive'],
    swatchClass: 'bg-[#14532d] border-emerald-700/50',
  },
  {
    label: 'Cobalt Blue',
    keywords: ['blue', 'cobalt', 'navy', 'sapphire'],
    swatchClass: 'bg-[#1d4ed8] border-blue-500/50',
  },
  {
    label: 'Champagne Gold',
    keywords: ['gold', 'champagne', 'sand', 'beige'],
    swatchClass: 'bg-[#d4af37] border-amber-400/50',
  },
  {
    label: 'Metallic Bronze',
    keywords: ['bronze', 'brown', 'espresso'],
    swatchClass: 'bg-[#78350f] border-amber-800/60',
  },
  {
    label: 'Sunset Orange',
    keywords: ['orange', 'copper'],
    swatchClass: 'bg-[#ea580c] border-orange-500/50',
  },
  {
    label: 'Burgundy',
    keywords: ['burgundy', 'maroon', 'wine'],
    swatchClass: 'bg-[#7f1d1d] border-red-900/60',
  },
  {
    label: 'Solar Yellow',
    keywords: ['yellow'],
    swatchClass: 'bg-[#eab308] border-yellow-400/50',
  },
];

export function getAvailableColorSwatches(
  vehicles: Pick<Vehicle, 'color' | 'status'>[]
): ColorSwatchOption[] {
  const availableColors = vehicles
    .filter((v) => v.status === 'available' && typeof v.color === 'string' && v.color.trim())
    .map((v) => v.color.trim().toLowerCase());

  if (availableColors.length === 0) {
    return [];
  }

  const matchedSwatches: ColorSwatchOption[] = [];

  for (const entry of COLOR_PALETTE_DEFINITIONS) {
    const matchedKeyword = entry.keywords.find((kw) =>
      availableColors.some((colorText) => new RegExp(`\\b${kw}\\b`, 'i').test(colorText))
    );
    if (matchedKeyword) {
      matchedSwatches.push({
        label: entry.label,
        query: matchedKeyword.charAt(0).toUpperCase() + matchedKeyword.slice(1),
        swatchClass: entry.swatchClass,
      });
    }
  }

  if (matchedSwatches.length === 0) {
    return [];
  }

  return [
    {
      label: 'All Colors',
      query: '',
      swatchClass: 'bg-zinc-900 border-zinc-700',
      isReset: true,
    },
    ...matchedSwatches,
  ];
}

export function splitDisplayBrandLines(companyName: string): string[] {
  const normalized = companyName.trim().replace(/\s+/g, ' ');
  const words = (normalized || 'Alif Car Import').split(' ');
  if (words.length <= 1) {
    return [words[0]];
  }
  const splitIndex = Math.ceil(words.length / 2);
  return [words.slice(0, splitIndex).join(' '), words.slice(splitIndex).join(' ')];
}

export function resolvePublicAssetUrl(rawUrl?: string, baseUrlOverride?: string): string {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) return '';
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed;
  }

  const baseUrl =
    baseUrlOverride ??
    (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : '/');
  const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  const assetsIdx = trimmed.indexOf('/assets/');
  if (assetsIdx !== -1 && !trimmed.startsWith('/src/')) {
    const relativeAssetPath = trimmed.slice(assetsIdx + 1);
    return `${cleanBase}${relativeAssetPath}`;
  }

  return trimmed;
}
