import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_SHOWROOM_STORE } from '../data/seedData';
import type { TikTokPost, Vehicle } from '../types/showroom';
import {
  didTikTokPostChange,
  filterSyncableTikTokPosts,
  mergeShowroomSnapshotState,
} from './firestoreSyncLogic';

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

  // Once tiktokPosts snapshot DOES load, remote posts become authoritative (sorted by sortOrder)
  const mergedAfterPosts = mergeShowroomSnapshotState({
    fallbackStore: fallback,
    hasConfig: true,
    configData: null,
    vehiclesLoaded: true,
    remoteVehicles: [SAMPLE_VEHICLE],
    postsLoaded: true,
    remotePosts: [
      { ...SAMPLE_POST, id: 'tt_2', title: 'Second', sortOrder: 1 },
      { ...SAMPLE_POST, id: 'tt_1', title: 'First', sortOrder: 0 },
    ],
  });

  assert.ok(mergedAfterPosts);
  assert.deepEqual(
    mergedAfterPosts.tiktok.posts.map((p) => p.id),
    ['tt_1', 'tt_2']
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
