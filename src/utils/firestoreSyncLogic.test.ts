import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_SHOWROOM_STORE } from '../data/seedData';
import type { TikTokPost } from '../types/showroom';
import {
  didTikTokPostChange,
  filterSyncableTikTokPosts,
  mergeShowroomSnapshotState,
} from './firestoreSyncLogic';

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
    catalogVehicles: INITIAL_SHOWROOM_STORE.vehicles,
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
    catalogVehicles: INITIAL_SHOWROOM_STORE.vehicles,
    hasConfig: true,
    configData: null,
    vehiclesLoaded: true,
    remoteVehicles: INITIAL_SHOWROOM_STORE.vehicles,
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
