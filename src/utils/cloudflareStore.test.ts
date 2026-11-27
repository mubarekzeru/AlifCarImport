import assert from 'node:assert/strict';
import test from 'node:test';
import { INITIAL_SHOWROOM_STORE } from '../data/seedData';
import {
  buildCloudflareEndpoint,
  mapRemoteShowroomResponse,
  normalizeCloudflareApiUrl,
} from './cloudflareStore';

test('normalizeCloudflareApiUrl accepts valid http(s) URLs and rejects placeholders or unsafe schemes', () => {
  assert.equal(
    normalizeCloudflareApiUrl('https://alif-car-import-api.example.workers.dev/'),
    'https://alif-car-import-api.example.workers.dev'
  );
  assert.equal(normalizeCloudflareApiUrl('http://localhost:8787/'), 'http://localhost:8787');
  assert.equal(normalizeCloudflareApiUrl(''), '');
  assert.equal(normalizeCloudflareApiUrl('MY_CLOUDFLARE_API_URL'), '');
  assert.equal(normalizeCloudflareApiUrl('https://alif-car-import-api.<your-subdomain>.workers.dev'), '');
  assert.equal(normalizeCloudflareApiUrl('javascript:alert(1)'), '');
});

test('buildCloudflareEndpoint joins normalized base URL and endpoint path cleanly', () => {
  assert.equal(
    buildCloudflareEndpoint('/api/showroom', 'https://api.alifcarimport.com/'),
    'https://api.alifcarimport.com/api/showroom'
  );
  assert.equal(
    buildCloudflareEndpoint('api/admin/vehicles/song-plus', 'https://api.alifcarimport.com'),
    'https://api.alifcarimport.com/api/admin/vehicles/song-plus'
  );
});

test('mapRemoteShowroomResponse orders TikTok posts newest-first and respects authoritative Cloudflare contact & vehicles', () => {
  const { store, meta } = mapRemoteShowroomResponse(
    {
      hasConfig: true,
      branding: {
        companyName: 'Alif Car Import',
        logoUrl: 'https://api.alifcarimport.com/media/branding/logo.png',
        tagline: 'Direct Imports',
      },
      hero: INITIAL_SHOWROOM_STORE.hero,
      tiktokHeader: {
        title: 'Latest Walkarounds',
        description: 'Fresh showroom reels',
        profileUrl: 'https://www.tiktok.com/@alif_car_import',
        handle: '@alif_car_import',
      },
      contact: {
        addressLine: 'Meskel Flower Showroom',
        cityCountry: 'Addis Ababa, Ethiopia',
        hours: 'Mon - Sat 9 AM - 6 PM',
        phone: '+251 91 100 4580',
        whatsapp: '+251 91 100 4580',
        email: 'alifcarimports@gmail.com',
        mapsUrl: 'https://maps.google.com/?q=Meskel+Flower',
        landmarkNote: 'Next to Zemen Bank',
      },
      vehicles: [
        {
          id: 'byd-song-plus',
          title: '2025 BYD Song Plus',
          make: 'BYD',
          model: 'Song Plus',
          year: 2025,
          price: 42000,
          mileage: '605 km',
          transmission: 'Automatic',
          fuelType: 'EV',
          color: 'White',
          origin: 'Direct Import',
          imageUrl: 'https://api.alifcarimport.com/media/vehicles/song.jpg',
          galleryImages: ['https://api.alifcarimport.com/media/vehicles/song-2.jpg'],
          description: 'Brand new EV.',
          tiktokUrl: '',
          status: 'available',
          featured: true,
          createdAt: '2026-11-27T01:00:00.000Z',
        },
      ],
      tiktokPosts: [
        {
          id: 'tt_old',
          title: 'Older Video',
          caption: '',
          tiktokUrl: 'https://www.tiktok.com/@alif_car_import/video/111',
          coverImageUrl: 'https://api.alifcarimport.com/media/tiktok/old.jpg',
          sortOrder: 0,
          updatedAtMillis: 1000,
        },
        {
          id: 'tt_new',
          title: 'Newest Video',
          caption: '',
          tiktokUrl: 'https://www.tiktok.com/@alif_car_import/video/222',
          coverImageUrl: 'https://api.alifcarimport.com/media/tiktok/new.jpg',
          sortOrder: 5,
          updatedAtMillis: 5000,
        },
      ],
    },
    INITIAL_SHOWROOM_STORE
  );

  assert.equal(meta.allLoaded, true);
  assert.equal(meta.hasConfig, true);
  assert.equal(store.vehicles.length, 1);
  assert.equal(store.vehicles[0].imageUrl, 'https://api.alifcarimport.com/media/vehicles/song.jpg');
  assert.deepEqual(
    store.tiktok.posts.map((p) => p.id),
    ['tt_new', 'tt_old']
  );
  assert.equal(store.contact.addressLine, 'Meskel Flower Showroom');
  assert.equal(store.contact.telegram, '');
});

test('mapRemoteShowroomResponse recovers bundled vehicles when Cloudflare D1 is uninitialized and cached fallback is empty', () => {
  const staleEmptyFallback = {
    ...INITIAL_SHOWROOM_STORE,
    vehicles: [],
  };

  const { store, meta } = mapRemoteShowroomResponse(
    {
      hasConfig: false,
      branding: null,
      hero: null,
      tiktokHeader: null,
      contact: null,
      vehicles: [],
      tiktokPosts: [],
    },
    staleEmptyFallback
  );

  assert.equal(meta.hasConfig, false);
  assert.equal(meta.allLoaded, true);
  assert.equal(store.vehicles.length, INITIAL_SHOWROOM_STORE.vehicles.length);
  assert.ok(store.vehicles.length > 0);
});

test('mapRemoteShowroomResponse respects 0 vehicles once Cloudflare D1 config is initialized', () => {
  const { store, meta } = mapRemoteShowroomResponse(
    {
      hasConfig: true,
      branding: INITIAL_SHOWROOM_STORE.branding,
      hero: INITIAL_SHOWROOM_STORE.hero,
      tiktokHeader: {
        title: INITIAL_SHOWROOM_STORE.tiktok.title,
        description: INITIAL_SHOWROOM_STORE.tiktok.description,
        profileUrl: INITIAL_SHOWROOM_STORE.tiktok.profileUrl,
        handle: INITIAL_SHOWROOM_STORE.tiktok.handle,
      },
      contact: INITIAL_SHOWROOM_STORE.contact,
      vehicles: [],
      tiktokPosts: [],
    },
    INITIAL_SHOWROOM_STORE
  );

  assert.equal(meta.hasConfig, true);
  assert.equal(store.vehicles.length, 0);
});

