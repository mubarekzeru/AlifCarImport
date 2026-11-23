import type {
  BrandingSettings,
  HeroPost,
  LocationContact,
  ShowroomStore,
  TikTokPost,
  TikTokSectionConfig,
  Vehicle,
} from '../types/showroom';
import { resolvePublicAssetUrl } from './inventory';

export type RemoteContactInput = Partial<LocationContact> | Record<string, unknown>;
export type RemoteTikTokHeaderInput = Partial<Omit<TikTokSectionConfig, 'posts'>> | Record<string, unknown>;

export interface RemoteShowroomConfigData {
  branding?: BrandingSettings;
  hero?: HeroPost;
  tiktok?: RemoteTikTokHeaderInput;
  contact?: RemoteContactInput;
}

export interface RemoteTikTokPostEntry extends TikTokPost {
  sortOrder: number;
}

export interface ShowroomSnapshotInput {
  fallbackStore: ShowroomStore;
  hasConfig: boolean;
  configData: RemoteShowroomConfigData | null;
  vehiclesLoaded: boolean;
  remoteVehicles: Vehicle[];
  postsLoaded: boolean;
  remotePosts: RemoteTikTokPostEntry[];
  remoteAdminEmails?: string[];
}

function readStringField(
  source: object | undefined | null,
  keys: string[]
): string {
  if (!source || typeof source !== 'object') return '';
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const val = record[key];
    if (typeof val === 'string') {
      return val;
    }
  }
  return '';
}

/**
 * Resolves contact, location, and social media fields authoritatively from Firestore.
 * Once Firestore config/showroom.contact exists, omitted or cleared optional fields
 * (such as telegram, instagram, facebook, x) become '' instead of resurrecting stale defaults.
 */
export function resolveRemoteContact(
  rawContact: RemoteContactInput | undefined | null,
  fallbackContact: LocationContact
): LocationContact {
  if (!rawContact || typeof rawContact !== 'object') {
    return fallbackContact;
  }

  const record = rawContact as Record<string, unknown>;
  const nestedSocial =
    (record.socialMedia && typeof record.socialMedia === 'object'
      ? (record.socialMedia as Record<string, unknown>)
      : null) ||
    (record.social && typeof record.social === 'object'
      ? (record.social as Record<string, unknown>)
      : null) ||
    (record.socialLinks && typeof record.socialLinks === 'object'
      ? (record.socialLinks as Record<string, unknown>)
      : null);

  return {
    addressLine: readStringField(rawContact, ['addressLine', 'address', 'streetAddress']),
    cityCountry: readStringField(rawContact, ['cityCountry', 'city', 'location']),
    hours: readStringField(rawContact, ['hours', 'openingHours', 'workingHours']),
    phone: readStringField(rawContact, ['phone', 'phoneNumber']),
    whatsapp: readStringField(rawContact, ['whatsapp', 'whatsappNumber', 'whatsappUrl']),
    telegram:
      readStringField(rawContact, ['telegram', 'telegramUrl', 'telegramHandle']) ||
      readStringField(nestedSocial, ['telegram', 'telegramUrl', 'telegramHandle']),
    instagram:
      readStringField(rawContact, ['instagram', 'instagramUrl', 'instagramHandle']) ||
      readStringField(nestedSocial, ['instagram', 'instagramUrl', 'instagramHandle']),
    facebook:
      readStringField(rawContact, ['facebook', 'facebookUrl', 'facebookHandle']) ||
      readStringField(nestedSocial, ['facebook', 'facebookUrl', 'facebookHandle']),
    x:
      readStringField(rawContact, ['x', 'twitter', 'xUrl', 'twitterUrl']) ||
      readStringField(nestedSocial, ['x', 'twitter', 'xUrl', 'twitterUrl']),
    email: readStringField(rawContact, ['email', 'emailAddress']),
    mapsUrl: readStringField(rawContact, ['mapsUrl', 'googleMapsUrl', 'mapUrl']),
    landmarkNote: readStringField(rawContact, ['landmarkNote', 'landmark', 'directionsNote']),
  };
}

/**
 * Merges incoming Firestore collection snapshots into a ShowroomStore without
 * wiping vehicles or TikTok posts that have not finished loading yet.
 * Once a collection or config/showroom finishes loading from Firestore, it is strictly
 * authoritative so edits, clears, and deletions made in Web or Mobile Admin are always reflected.
 */
export function mergeShowroomSnapshotState(
  input: ShowroomSnapshotInput
): ShowroomStore | null {
  const {
    fallbackStore: base,
    hasConfig,
    configData,
    vehiclesLoaded,
    remoteVehicles,
    postsLoaded,
    remotePosts,
    remoteAdminEmails,
  } = input;

  const hasAnyRemote =
    hasConfig ||
    (vehiclesLoaded && remoteVehicles.length > 0) ||
    (postsLoaded && remotePosts.length > 0);
  if (!hasAnyRemote) {
    return null;
  }

  const resolvedBranding = configData?.branding
    ? {
        ...base.branding,
        ...configData.branding,
        logoUrl: resolvePublicAssetUrl(configData.branding.logoUrl) || base.branding.logoUrl,
      }
    : base.branding;

  const resolvedHero = configData?.hero
    ? {
        ...base.hero,
        ...configData.hero,
        imageUrl: resolvePublicAssetUrl(configData.hero.imageUrl),
        videoUrl: resolvePublicAssetUrl(configData.hero.videoUrl) || base.hero.videoUrl,
      }
    : base.hero;

  const resolvedVehicles = vehiclesLoaded ? remoteVehicles : base.vehicles;

  const resolvedPosts = postsLoaded
    ? [...remotePosts]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ sortOrder: _sortOrder, ...post }) => post)
    : base.tiktok.posts;

  const remoteTikTok = configData?.tiktok;
  const resolvedTikTokHeader =
    remoteTikTok && typeof remoteTikTok === 'object'
      ? {
          title: typeof remoteTikTok.title === 'string' ? remoteTikTok.title : base.tiktok.title,
          description:
            typeof remoteTikTok.description === 'string'
              ? remoteTikTok.description
              : '',
          profileUrl:
            typeof remoteTikTok.profileUrl === 'string'
              ? remoteTikTok.profileUrl
              : '',
          handle:
            typeof remoteTikTok.handle === 'string'
              ? remoteTikTok.handle
              : '',
        }
      : {
          title: base.tiktok.title,
          description: base.tiktok.description,
          profileUrl: base.tiktok.profileUrl,
          handle: base.tiktok.handle,
        };

  return {
    branding: resolvedBranding,
    hero: resolvedHero,
    vehicles: resolvedVehicles,
    tiktok: {
      ...resolvedTikTokHeader,
      posts: resolvedPosts,
    },
    contact: resolveRemoteContact(configData?.contact, base.contact),
    adminEmails: remoteAdminEmails ?? base.adminEmails,
  };
}

/**
 * Filters out blank unsaved TikTok draft cards so clicking "+ Add TikTok Video"
 * never wastes Firestore writes or shifts sortOrder on existing published posts.
 */
export function filterSyncableTikTokPosts(posts: TikTokPost[]): TikTokPost[] {
  return posts.filter((post) => Boolean(post.tiktokUrl?.trim()));
}

/**
 * Returns true if metadata auto-fetch actually produced at least one change
 * to the TikTok post so we avoid redundant Firestore writes on tab open.
 */
export function didTikTokPostChange(prev: TikTokPost, next: TikTokPost): boolean {
  return (
    prev.tiktokUrl !== next.tiktokUrl ||
    prev.title !== next.title ||
    prev.caption !== next.caption ||
    prev.coverImageUrl !== next.coverImageUrl
  );
}
