import type {
  BrandingSettings,
  HeroPost,
  LocationContact,
  ShowroomStore,
  TikTokPost,
  TikTokSectionConfig,
  Vehicle,
} from '../types/showroom';
import { mergeRemoteVehiclesWithCatalog, resolvePublicAssetUrl } from './inventory';

export interface RemoteShowroomConfigData {
  branding?: BrandingSettings;
  hero?: HeroPost;
  tiktok?: Omit<TikTokSectionConfig, 'posts'>;
  contact?: LocationContact;
}

export interface RemoteTikTokPostEntry extends TikTokPost {
  sortOrder: number;
}

export interface ShowroomSnapshotInput {
  fallbackStore: ShowroomStore;
  catalogVehicles: Vehicle[];
  hasConfig: boolean;
  configData: RemoteShowroomConfigData | null;
  vehiclesLoaded: boolean;
  remoteVehicles: Vehicle[];
  postsLoaded: boolean;
  remotePosts: RemoteTikTokPostEntry[];
  remoteAdminEmails?: string[];
}

/**
 * Merges incoming Firestore collection snapshots into a ShowroomStore without
 * wiping vehicles or TikTok posts that have not finished loading yet.
 */
export function mergeShowroomSnapshotState(
  input: ShowroomSnapshotInput
): ShowroomStore | null {
  const {
    fallbackStore: base,
    catalogVehicles,
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

  const resolvedVehicles = vehiclesLoaded
    ? mergeRemoteVehiclesWithCatalog(remoteVehicles, catalogVehicles)
    : base.vehicles;

  const resolvedPosts = postsLoaded
    ? [...remotePosts]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ sortOrder: _sortOrder, ...post }) => post)
    : base.tiktok.posts;

  return {
    branding: resolvedBranding,
    hero: resolvedHero,
    vehicles: resolvedVehicles,
    tiktok: {
      title: configData?.tiktok?.title ?? base.tiktok.title,
      description: configData?.tiktok?.description ?? base.tiktok.description,
      profileUrl: configData?.tiktok?.profileUrl ?? base.tiktok.profileUrl,
      handle: configData?.tiktok?.handle ?? base.tiktok.handle,
      posts: resolvedPosts,
    },
    contact: configData?.contact ? { ...base.contact, ...configData.contact } : base.contact,
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
