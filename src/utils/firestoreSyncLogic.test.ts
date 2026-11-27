import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_SHOWROOM_STORE } from '../data/seedData';
import type { TikTokPost, Vehicle } from '../types/showroom';
import {
  computeTikTokSortOrder,
  didTikTokPostChange,
  filterSyncableTikTokPosts,
  getTikTokGridLayoutMetrics,
  mergeShowroomSnapshotState,
  resolveRemoteContact,
  sortRemoteTikTokPostsNewestFirst,
} from './firestoreSyncLogic';
import { getConfiguredSocialLinks, normalizeExternalUrl } from './inventory';

const SAMPLE_VEHICLE: Vehicle = {
  id: 'song-plus',
  title: 'Song Plus',
  make: 'BYD',
  model: 'SUV',
  year: 2025,
  price: 0,
  mileage: '605 mi',
  transmission: 'Automatic',
  fuelType: 'EV',
  color: 'Grey',
  origin: 'Direct Import',
  imageUrl: 'data:image/jpeg;base64,abc',
  galleryImages: [],
  description: 'BYD Song Plus EV',
  tiktokUrl: '',
  status: 'available',
  featured: true,
  createdAt: '2026-08-02T21:07:57.300Z',
};

const SAMPLE_POST: TikTokPost = {
  id: 'tt_1',
  title: 'BYD Song Plus Walkaround',
  caption: 'Showroom arrival',
  tiktokUrl: 'https://www.tiktok.com/@alif_car_import/video/1234567890',
  coverImageUrl: 'https://example.com/cover.jpg',
};

test('mergeShowroomSnapshotState preserves fallback TikTok posts until postsLoaded is true', () => {
  const fallback = {
    ...INITIAL_SHOWROOM_STORE,
    tiktok: {
      ...INITIAL_SHOWROOM_STORE.tiktok,
      posts: [SAMPLE_POST],
    },
  };

  // config/showroom arrived first while tiktokPosts snapshot has NOT arrived yet
  const mergedBeforePosts = mergeShowroomSnapshotState({
    fallbackStore: fallback,
    hasConfig: true,
    configData: {
      branding: INITIAL_SHOWROOM_STORE.branding,
      hero: INITIAL_SHOWROOM_STORE.hero,
      tiktok: {
        title: INITIAL_SHOWROOM_STORE.tiktok.title,
        description: INITIAL_SHOWROOM_STORE.tiktok.description,
        profileUrl: INITIAL_SHOWROOM_STORE.tiktok.profileUrl,
        handle: INITIAL_SHOWROOM_STORE.tiktok.handle,
      },
      contact: INITIAL_SHOWROOM_STORE.contact,
    },
    vehiclesLoaded: false,
    remoteVehicles: [],
    postsLoaded: false,
    remotePosts: [],
  });

  assert.ok(mergedBeforePosts);
  assert.equal(mergedBeforePosts.tiktok.posts.length, 1);
  assert.equal(mergedBeforePosts.tiktok.posts[0].id, 'tt_1');

  // Once tiktokPosts snapshot DOES load, remote posts become authoritative (newest / highest sortOrder first)
  const mergedAfterPosts = mergeShowroomSnapshotState({
    fallbackStore: fallback,
    hasConfig: true,
    configData: null,
    vehiclesLoaded: true,
    remoteVehicles: [SAMPLE_VEHICLE],
    postsLoaded: true,
    remotePosts: [
      { ...SAMPLE_POST, id: 'tt_1', title: 'Oldest', sortOrder: 0, updatedAtMillis: 1000 },
      { ...SAMPLE_POST, id: 'tt_2', title: 'Newest', sortOrder: 1, updatedAtMillis: 2000 },
    ],
  });

  assert.ok(mergedAfterPosts);
  assert.deepEqual(
    mergedAfterPosts.tiktok.posts.map((p) => p.id),
    ['tt_2', 'tt_1']
  );
  assert.deepEqual(
    mergedAfterPosts.vehicles.map((v) => v.id),
    ['song-plus']
  );
});

test('mergeShowroomSnapshotState respects deleted vehicles and never re-injects stale fallback cars once vehiclesLoaded is true', () => {
  const staleFallback = {
    ...INITIAL_SHOWROOM_STORE,
    vehicles: [
      SAMPLE_VEHICLE,
      { ...SAMPLE_VEHICLE, id: '2024-bmw-m4-competition', title: '2024 BMW M4 Competition', make: 'BMW' },
      { ...SAMPLE_VEHICLE, id: '2024-porsche-911-carrera-s', title: '2024 Porsche 911 Carrera S', make: 'Porsche' },
    ],
  };

  // Admin deleted BMW and Porsche in Firestore -> only Song Plus remains
  const afterPartialDelete = mergeShowroomSnapshotState({
    fallbackStore: staleFallback,
    hasConfig: true,
    configData: null,
    vehiclesLoaded: true,
    remoteVehicles: [SAMPLE_VEHICLE],
    postsLoaded: true,
    remotePosts: [{ ...SAMPLE_POST, sortOrder: 0 }],
  });

  assert.ok(afterPartialDelete);
  assert.deepEqual(
    afterPartialDelete.vehicles.map((v) => v.id),
    ['song-plus']
  );

  // Admin deleted ALL vehicles in Firestore -> empty array is respected, zero resurrection
  const afterDeleteAll = mergeShowroomSnapshotState({
    fallbackStore: staleFallback,
    hasConfig: true,
    configData: null,
    vehiclesLoaded: true,
    remoteVehicles: [],
    postsLoaded: true,
    remotePosts: [{ ...SAMPLE_POST, sortOrder: 0 }],
  });

  assert.ok(afterDeleteAll);
  assert.deepEqual(afterDeleteAll.vehicles, []);
  assert.equal(afterDeleteAll.tiktok.posts.length, 1);
});

test('mergeShowroomSnapshotState treats mobile config/showroom contact & social updates as strictly authoritative (clears omitted socials)', () => {
  const staleFallback = {
    ...INITIAL_SHOWROOM_STORE,
    contact: {
      addressLine: 'Old Street',
      cityCountry: 'Old City',
      hours: 'Old Hours',
      phone: '+251976011111',
      whatsapp: '+251976011111',
      telegram: 'Alif_Car_Import',
      instagram: '@alif_car_import',
      facebook: 'OldFacebook',
      x: '@oldx',
      email: 'info@alifcar.com',
      mapsUrl: 'https://maps.google.com/?q=Old',
      landmarkNote: 'Old Landmark',
    },
  };

  // Mobile app updates contact & location and omits optional social keys (telegram, instagram, facebook, x)
  const merged = mergeShowroomSnapshotState({
    fallbackStore: staleFallback,
    hasConfig: true,
    configData: {
      contact: {
        addressLine: 'Bole Road Showroom #2',
        cityCountry: 'Addis Ababa, Ethiopia',
        hours: 'Mon – Sun: 9:00 AM – 7:00 PM',
        phone: '+251 91 100 4580',
        whatsapp: '+251 91 100 4580',
        email: 'sales@alifcarimport.com',
        mapsUrl: 'https://maps.google.com/?q=Bole+Medhanialem+Addis+Ababa',
        landmarkNote: 'Opposite Harmony Hotel',
      },
      tiktok: {
        title: 'Showroom Reels',
        description: 'Live mobile updates',
        profileUrl: 'https://www.tiktok.com/@alif_car_import',
        handle: '@alif_car_import',
      },
    },
    vehiclesLoaded: true,
    remoteVehicles: [],
    postsLoaded: true,
    remotePosts: [],
  });

  assert.ok(merged);
  assert.equal(merged.contact.addressLine, 'Bole Road Showroom #2');
  assert.equal(merged.contact.hours, 'Mon – Sun: 9:00 AM – 7:00 PM');
  assert.equal(merged.contact.phone, '+251 91 100 4580');
  assert.equal(merged.contact.email, 'sales@alifcarimport.com');
  assert.equal(merged.contact.landmarkNote, 'Opposite Harmony Hotel');
  // Omitted optional socials MUST clear instead of reviving stale fallback values
  assert.equal(merged.contact.telegram, '');
  assert.equal(merged.contact.instagram, '');
  assert.equal(merged.contact.facebook, '');
  assert.equal(merged.contact.x, '');

  const socialPlatforms = getConfiguredSocialLinks(merged.contact, merged.tiktok).map(
    (item) => item.platform
  );
  assert.deepEqual(socialPlatforms, ['whatsapp', 'tiktok']);
});

test('mergeShowroomSnapshotState applies newly added social media accounts and cleared optional fields from mobile', () => {
  const merged = mergeShowroomSnapshotState({
    fallbackStore: INITIAL_SHOWROOM_STORE,
    hasConfig: true,
    configData: {
      contact: {
        addressLine: 'Kazanchis New Lot',
        cityCountry: 'Addis Ababa, Ethiopia',
        hours: 'Daily 9 AM – 6 PM',
        phone: '+251 92 222 3333',
        whatsapp: '+251 92 222 3333',
        telegram: '@alif_official',
        instagram: 'https://instagram.com/alif_official',
        facebook: 'alifcarimport',
        x: '@alifcars',
        email: '',
        mapsUrl: '',
        landmarkNote: '',
      },
      tiktok: {
        title: 'Walkarounds',
        description: '',
        profileUrl: '',
        handle: '',
      },
    },
    vehiclesLoaded: true,
    remoteVehicles: [],
    postsLoaded: true,
    remotePosts: [],
  });

  assert.ok(merged);
  assert.equal(merged.contact.telegram, '@alif_official');
  assert.equal(merged.contact.instagram, 'https://instagram.com/alif_official');
  assert.equal(merged.contact.facebook, 'alifcarimport');
  assert.equal(merged.contact.x, '@alifcars');
  assert.equal(merged.contact.email, '');
  assert.equal(merged.contact.mapsUrl, '');
  assert.equal(merged.tiktok.profileUrl, '');
  assert.equal(merged.tiktok.handle, '');

  const links = getConfiguredSocialLinks(merged.contact, merged.tiktok);
  assert.deepEqual(
    links.map((l) => l.platform),
    ['whatsapp', 'telegram', 'instagram', 'facebook', 'x']
  );
});

test('resolveRemoteContact handles mobile alias keys and normalizeExternalUrl normalizes bare map links safely', () => {
  const resolved = resolveRemoteContact(
    {
      address: 'New Branch',
      city: 'Addis Ababa',
      openingHours: '9–5',
      phoneNumber: '+251911000000',
      whatsappNumber: '+251911000000',
      googleMapsUrl: 'maps.app.goo.gl/abc123',
      landmark: 'Next to Bank',
      emailAddress: 'hello@alif.com',
      socialMedia: {
        telegram: 'alif_tg',
        twitter: '@alif_x',
      },
    },
    INITIAL_SHOWROOM_STORE.contact
  );

  assert.equal(resolved.addressLine, 'New Branch');
  assert.equal(resolved.cityCountry, 'Addis Ababa');
  assert.equal(resolved.hours, '9–5');
  assert.equal(resolved.phone, '+251911000000');
  assert.equal(resolved.mapsUrl, 'maps.app.goo.gl/abc123');
  assert.equal(resolved.telegram, 'alif_tg');
  assert.equal(resolved.x, '@alif_x');

  assert.equal(normalizeExternalUrl('maps.app.goo.gl/abc123'), 'https://maps.app.goo.gl/abc123');
  assert.equal(
    normalizeExternalUrl('https://maps.google.com/?q=Addis'),
    'https://maps.google.com/?q=Addis'
  );
  assert.equal(normalizeExternalUrl('javascript:alert(1)'), '');
});

test('filterSyncableTikTokPosts omits blank draft cards to avoid unnecessary writes and sortOrder churn', () => {
  const blankDraft: TikTokPost = {
    id: 'tt_draft',
    title: 'New Imported Arrival Walkaround',
    caption: 'Draft',
    tiktokUrl: '   ',
    coverImageUrl: '',
  };

  const syncable = filterSyncableTikTokPosts([blankDraft, SAMPLE_POST]);
  assert.equal(syncable.length, 1);
  assert.equal(syncable[0].id, 'tt_1');
});

test('didTikTokPostChange detects real metadata updates and skips no-op writes', () => {
  assert.equal(didTikTokPostChange(SAMPLE_POST, { ...SAMPLE_POST }), false);
  assert.equal(
    didTikTokPostChange(SAMPLE_POST, { ...SAMPLE_POST, coverImageUrl: 'https://example.com/new.jpg' }),
    true
  );
  assert.equal(
    didTikTokPostChange(SAMPLE_POST, { ...SAMPLE_POST, title: 'Updated Title' }),
    true
  );
});

test('sortRemoteTikTokPostsNewestFirst orders highest sortOrder first and tie-breaks by updatedAtMillis', () => {
  const ordered = sortRemoteTikTokPostsNewestFirst([
    { ...SAMPLE_POST, id: 'oldest', sortOrder: 0, updatedAtMillis: 1000 },
    { ...SAMPLE_POST, id: 'tied_older', sortOrder: 5, updatedAtMillis: 2000 },
    { ...SAMPLE_POST, id: 'newest', sortOrder: 7, updatedAtMillis: 4000 },
    { ...SAMPLE_POST, id: 'tied_newer', sortOrder: 5, updatedAtMillis: 3000 },
  ]);

  assert.deepEqual(
    ordered.map((p) => p.id),
    ['newest', 'tied_newer', 'tied_older', 'oldest']
  );
});

test('computeTikTokSortOrder assigns highest sortOrder to index 0 so web and mobile admin stay aligned', () => {
  assert.equal(computeTikTokSortOrder(0, 8), 7);
  assert.equal(computeTikTokSortOrder(7, 8), 0);
  // Prepending 1 new post gives it sortOrder 8 while preserving 7..0 on existing posts
  assert.equal(computeTikTokSortOrder(0, 9), 8);
  assert.equal(computeTikTokSortOrder(1, 9), 7);
  assert.equal(computeTikTokSortOrder(8, 9), 0);
});

test('getTikTokGridLayoutMetrics stacks 2 rows first and expands both rows equally horizontally', () => {
  assert.deepEqual(getTikTokGridLayoutMetrics(0), { rows: 1, columns: 0, topRowCount: 0, bottomRowCount: 0 });
  assert.deepEqual(getTikTokGridLayoutMetrics(1), { rows: 1, columns: 1, topRowCount: 1, bottomRowCount: 0 });
  assert.deepEqual(getTikTokGridLayoutMetrics(2), { rows: 2, columns: 1, topRowCount: 1, bottomRowCount: 1 });
  assert.deepEqual(getTikTokGridLayoutMetrics(6), { rows: 2, columns: 3, topRowCount: 3, bottomRowCount: 3 });
  assert.deepEqual(getTikTokGridLayoutMetrics(8), { rows: 2, columns: 4, topRowCount: 4, bottomRowCount: 4 });
  assert.deepEqual(getTikTokGridLayoutMetrics(9), { rows: 2, columns: 5, topRowCount: 5, bottomRowCount: 4 });
  assert.deepEqual(getTikTokGridLayoutMetrics(10), { rows: 2, columns: 5, topRowCount: 5, bottomRowCount: 5 });
});
