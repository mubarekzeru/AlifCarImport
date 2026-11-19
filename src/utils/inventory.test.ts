import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterVehicles,
  getFilterOptions,
  formatPrice,
  formatVehicleTileModel,
  extractTikTokVideoId,
  normalizeTikTokUrl,
  isTikTokVideoUrl,
  filterActiveTikTokPosts,
  resolveTikTokAdminCardMode,
  isPlaceholderTikTokCover,
  shouldAutoFetchTikTokCover,
  deriveTitleFromVideoDescription,
  validateVehicleInput,
  buildWhatsAppHref,
  buildSocialMediaUrl,
  getConfiguredSocialLinks,
  getVehicleGalleryImages,
  getRelatedShowroomVehicles,
  getSimilarVehicles,
  getVehiclePricingBreakdown,
  getAvailableColorSwatches,
  splitDisplayBrandLines,
  resolvePublicAssetUrl,
  resolveHeroVideoUrl,
  isAuthorizedAdminEmail,
  needsCatalogSyncToFirestore,
  findLegacyDuplicateVehicleIds,
  mergeRemoteVehiclesWithCatalog,
} from './inventory';
import type { Vehicle } from '../types/showroom';

const SAMPLE_VEHICLES: Vehicle[] = [
  {
    id: 'v1',
    title: '2024 Toyota Land Cruiser 300 ZX',
    make: 'Toyota',
    model: 'Land Cruiser',
    year: 2024,
    price: 89500,
    mileage: '4,200 km',
    transmission: 'Automatic',
    fuelType: 'V6 Twin-Turbo',
    color: 'Pearl White',
    origin: 'Japan Import',
    imageUrl: '/car1.jpg',
    description: 'Clean direct import with full leather interior and sunroof.',
    tiktokUrl: 'https://www.tiktok.com/@alifcarimport/video/7340123456789012345',
    status: 'available',
    featured: true,
    createdAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'v2',
    title: '2023 Mercedes-Benz GLE 450 AMG Line',
    make: 'Mercedes-Benz',
    model: 'GLE 450',
    year: 2023,
    price: 78000,
    mileage: '11,800 km',
    transmission: '9G-Tronic',
    fuelType: 'Mild Hybrid',
    color: 'Obsidian Black',
    origin: 'Germany Import',
    imageUrl: '/car2.jpg',
    description: 'Executive SUV with panoramic roof and Burmester audio.',
    tiktokUrl: '',
    status: 'reserved',
    featured: false,
    createdAt: '2026-10-02T00:00:00Z',
  },
  {
    id: 'v3',
    title: '2024 Toyota RAV4 Hybrid Limited',
    make: 'Toyota',
    model: 'RAV4',
    year: 2024,
    price: 44000,
    mileage: '1,900 km',
    transmission: 'e-CVT',
    fuelType: 'Hybrid',
    color: 'Silver',
    origin: 'UAE Import',
    imageUrl: '/car3.jpg',
    description: 'Fuel-efficient AWD hybrid ready for immediate registration.',
    tiktokUrl: '',
    status: 'available',
    featured: false,
    createdAt: '2026-10-03T00:00:00Z',
  },
];

test('filterVehicles filters by make, model, year, and free-text query', () => {
  const byMake = filterVehicles(SAMPLE_VEHICLES, {
    query: '',
    make: 'Toyota',
    model: '',
    year: '',
  });
  assert.equal(byMake.length, 2);

  const byMakeAndModel = filterVehicles(SAMPLE_VEHICLES, {
    query: '',
    make: 'Toyota',
    model: 'Land Cruiser',
    year: '',
  });
  assert.equal(byMakeAndModel.length, 1);
  assert.equal(byMakeAndModel[0].id, 'v1');

  const byYear = filterVehicles(SAMPLE_VEHICLES, {
    query: '',
    make: '',
    model: '',
    year: '2023',
  });
  assert.equal(byYear.length, 1);
  assert.equal(byYear[0].id, 'v2');

  const byQuery = filterVehicles(SAMPLE_VEHICLES, {
    query: 'burmester',
    make: '',
    model: '',
    year: '',
  });
  assert.equal(byQuery.length, 1);
  assert.equal(byQuery[0].id, 'v2');

  const byPartialTypedMake = filterVehicles(SAMPLE_VEHICLES, {
    query: '',
    make: 'toy',
    model: 'cruis',
    year: '24',
  });
  assert.equal(byPartialTypedMake.length, 1);
  assert.equal(byPartialTypedMake[0].id, 'v1');
});

test('getFilterOptions scopes models to selectedMake and sorts years descending', () => {
  const allOptions = getFilterOptions(SAMPLE_VEHICLES, '');
  assert.deepEqual(allOptions.makes, ['Mercedes-Benz', 'Toyota']);
  assert.deepEqual(allOptions.models, ['GLE 450', 'Land Cruiser', 'RAV4']);
  assert.deepEqual(allOptions.years, [2024, 2023]);

  const toyotaOptions = getFilterOptions(SAMPLE_VEHICLES, 'Toyota');
  assert.deepEqual(toyotaOptions.models, ['Land Cruiser', 'RAV4']);

  const partialToyotaOptions = getFilterOptions(SAMPLE_VEHICLES, 'toy');
  assert.deepEqual(partialToyotaOptions.models, ['Land Cruiser', 'RAV4']);
});

test('extractTikTokVideoId parses standard TikTok video URLs and rejects invalid ones', () => {
  assert.equal(
    extractTikTokVideoId('https://www.tiktok.com/@alifcarimport/video/7340123456789012345?lang=en'),
    '7340123456789012345'
  );
  assert.equal(extractTikTokVideoId('https://www.tiktok.com/@alifcarimport'), null);
  assert.equal(extractTikTokVideoId('not-a-url'), null);
});

test('formatPrice formats USD without decimals and handles zero/negative gracefully', () => {
  assert.equal(formatPrice(89500), '$89,500');
  assert.equal(formatPrice(0), 'Price on Request');
});

test('validateVehicleInput catches missing required fields and malformed TikTok URLs', () => {
  const bad = validateVehicleInput({
    title: '',
    make: 'Toyota',
    model: '',
    year: 1970,
    price: -10,
    description: '',
    tiktokUrl: 'invalid-url',
  });
  assert.ok(bad.title);
  assert.ok(bad.model);
  assert.ok(bad.year);
  assert.ok(bad.price);
  assert.ok(bad.description);
  assert.ok(bad.tiktokUrl);

  const ok = validateVehicleInput({
    title: '2024 Lexus RX 350',
    make: 'Lexus',
    model: 'RX 350',
    year: 2024,
    price: 68500,
    description: 'Low mileage luxury SUV.',
    tiktokUrl: 'https://www.tiktok.com/@alifcarimport/video/7340123456789012345',
  });
  assert.deepEqual(ok, {});
});

test('buildWhatsAppHref strips formatting characters and encodes message', () => {
  const href = buildWhatsAppHref('+251 91 123 4567', 'Interested in Land Cruiser');
  assert.equal(href, 'https://wa.me/251911234567?text=Interested%20in%20Land%20Cruiser');
});

test('isAuthorizedAdminEmail validates authorized emails case-insensitively and rejects visitors', () => {
  assert.equal(isAuthorizedAdminEmail('alifcarimports@gmail.com'), true);
  assert.equal(isAuthorizedAdminEmail('  AlifCarImports@gmail.com  '), true);
  assert.equal(isAuthorizedAdminEmail('mubyzeru@gmail.com'), false);
  assert.equal(isAuthorizedAdminEmail('visitor@example.com'), false);
  assert.equal(isAuthorizedAdminEmail(''), false);
  assert.equal(isAuthorizedAdminEmail('team@alifcarimport.com', ['team@alifcarimport.com']), true);
});

test('isTikTokVideoUrl recognizes short vt/vm/t links, bare links, share text, /photo/ and /video/ links', () => {
  assert.equal(isTikTokVideoUrl('https://vt.tiktok.com/ZSpbrcUvR/'), true);
  assert.equal(isTikTokVideoUrl('vt.tiktok.com/ZSpbrcUvR/'), true);
  assert.equal(
    isTikTokVideoUrl('Check this ride out! https://vt.tiktok.com/ZSpbrcUvR/'),
    true
  );
  assert.equal(isTikTokVideoUrl('https://vm.tiktok.com/ZM6abc123/'), true);
  assert.equal(isTikTokVideoUrl('https://www.tiktok.com/t/ZP8abc123/'), true);
  assert.equal(
    isTikTokVideoUrl('https://www.tiktok.com/@alif_car_import/video/7653002113408077064'),
    true
  );
  assert.equal(
    isTikTokVideoUrl('https://www.tiktok.com/@alif_car_import/photo/7653002113408077064'),
    true
  );
  assert.equal(
    normalizeTikTokUrl('Look at this car vt.tiktok.com/ZSpbrcUvR/'),
    'https://vt.tiktok.com/ZSpbrcUvR/'
  );
  assert.equal(isTikTokVideoUrl('https://www.tiktok.com/@alifcarimport'), false);
  assert.equal(isTikTokVideoUrl(''), false);
  assert.equal(isTikTokVideoUrl('https://example.com/video/123'), false);
});

test('filterActiveTikTokPosts excludes posts without an inserted video link', () => {
  const posts = [
    { id: '1', tiktokUrl: 'https://www.tiktok.com/@alif_car_import/video/7653002113408077064' },
    { id: '2', tiktokUrl: 'https://www.tiktok.com/@alifcarimport' },
    { id: '3', tiktokUrl: '' },
    { id: '4', tiktokUrl: 'https://vt.tiktok.com/ZSpbrcUvR/' },
    { id: '5', tiktokUrl: 'vt.tiktok.com/ZSp999abc/' },
  ];
  const filtered = filterActiveTikTokPosts(posts);
  assert.deepEqual(
    filtered.map((p) => p.id),
    ['1', '4', '5']
  );
});

test('deriveTitleFromVideoDescription derives concise titles from prose and hashtag captions', () => {
  assert.equal(
    deriveTitleFromVideoDescription(
      '#SongPlus #alifcarimport #ethiopian_tik_tok🇪🇹🇪🇹🇪🇹🇪🇹 #creatorsearchinsights #ethiopian_tik_tok @Alif Car Import 2 @Alif Car Import 3 @BENJA.K 🎥@hidayah 💃'
    ),
    'Song Plus'
  );

  assert.equal(
    deriveTitleFromVideoDescription(
      '2024 Toyota Land Cruiser 300 ZX arriving in Bole showroom. Contact us for price! #alifcarimport'
    ),
    '2024 Toyota Land Cruiser 300 ZX arriving in Bole showroom'
  );

  assert.equal(
    deriveTitleFromVideoDescription(
      'Fresh customs-cleared Pearl White 300 ZX cabin and twin-turbo inspection.'
    ),
    'Fresh customs-cleared Pearl White 300 ZX cabin and twin-turbo...'
  );

  assert.equal(deriveTitleFromVideoDescription('   '), '');
});

test('resolveTikTokAdminCardMode collapses published posts unless explicitly opened for editing or link change', () => {
  assert.equal(
    resolveTikTokAdminCardMode('https://www.tiktok.com/@alif_car_import/video/7653002113408077064'),
    'collapsed'
  );
  assert.equal(resolveTikTokAdminCardMode(''), 'edit');
  assert.equal(resolveTikTokAdminCardMode('https://vt.tiktok.com/ZSpbrcUvR/', 'edit'), 'edit');
  assert.equal(
    resolveTikTokAdminCardMode('https://vt.tiktok.com/ZSpbrcUvR/', 'change-link'),
    'change-link'
  );
});

test('shouldAutoFetchTikTokCover triggers for missing covers and when a post switches to a different TikTok video URL', () => {
  assert.equal(isPlaceholderTikTokCover(''), true);
  assert.equal(isPlaceholderTikTokCover('/assets/aistudio/hero.jpg'), true);
  assert.equal(isPlaceholderTikTokCover('data:image/jpeg;base64,abc'), false);

  // Valid link with empty cover -> must fetch
  assert.equal(
    shouldAutoFetchTikTokCover({
      tiktokUrl: 'https://vt.tiktok.com/ZSpbrcUvR/',
      coverImageUrl: '',
    }),
    true
  );

  // Already fetched same URL with real cover -> no refetch needed
  assert.equal(
    shouldAutoFetchTikTokCover(
      {
        tiktokUrl: 'https://vt.tiktok.com/ZSpbrcUvR/',
        coverImageUrl: 'data:image/jpeg;base64,abc',
      },
      'https://vt.tiktok.com/ZSpbrcUvR/'
    ),
    false
  );

  // Switched to a different video URL even though old cover exists -> must fetch new video cover
  assert.equal(
    shouldAutoFetchTikTokCover(
      {
        tiktokUrl: 'https://www.tiktok.com/@alif_car_import/video/7653002113408077064',
        coverImageUrl: 'data:image/jpeg;base64,old-cover',
      },
      'https://vt.tiktok.com/ZSpbrcUvR/'
    ),
    true
  );

  // Non-video profile URL -> never auto-fetch
  assert.equal(
    shouldAutoFetchTikTokCover({
      tiktokUrl: 'https://www.tiktok.com/@alif.car1',
      coverImageUrl: '',
    }),
    false
  );
});

test('buildSocialMediaUrl resolves usernames, handles, and full URLs across platforms', () => {
  assert.equal(buildSocialMediaUrl('telegram', '@alif_cars'), 'https://t.me/alif_cars');
  assert.equal(buildSocialMediaUrl('telegram', 't.me/alif_cars'), 'https://t.me/alif_cars');
  assert.equal(
    buildSocialMediaUrl('instagram', 'alifcarimport'),
    'https://www.instagram.com/alifcarimport'
  );
  assert.equal(
    buildSocialMediaUrl('facebook', 'AlifCarImport'),
    'https://www.facebook.com/AlifCarImport'
  );
  assert.equal(buildSocialMediaUrl('x', '@alifcars'), 'https://x.com/alifcars');
  assert.equal(
    buildSocialMediaUrl('whatsapp', 'https://wa.me/251911004580'),
    'https://wa.me/251911004580'
  );
  assert.equal(buildSocialMediaUrl('telegram', '   '), null);
});

test('getConfiguredSocialLinks returns only populated social accounts in display order', () => {
  const configured = getConfiguredSocialLinks(
    {
      phone: '+251911004580',
      whatsapp: '+251911004580',
      telegram: '@alif_telegram',
      instagram: 'alif_insta',
      facebook: '',
      x: '@alif_x',
    },
    { handle: '@alif_car_import', profileUrl: 'https://vt.tiktok.com/ZSpbD52xJ/' }
  );
  assert.deepEqual(
    configured.map((c) => c.platform),
    ['whatsapp', 'telegram', 'instagram', 'x', 'tiktok']
  );
  assert.equal(configured[1].href, 'https://t.me/alif_telegram');
  assert.equal(configured[2].href, 'https://www.instagram.com/alif_insta');
  assert.equal(configured[3].href, 'https://x.com/alif_x');
});

test('formatVehicleTileModel strips leading year and make cleanly', () => {
  assert.equal(
    formatVehicleTileModel({
      title: '2024 Toyota Land Cruiser 300 ZX',
      make: 'Toyota',
      model: 'Land Cruiser',
      year: 2024,
    }),
    'Land Cruiser 300 ZX'
  );
  assert.equal(
    formatVehicleTileModel({
      title: 'Hyundai Tucson Hybrid SEL',
      make: 'Hyundai',
      model: 'Tucson',
      year: 2024,
    }),
    'Tucson Hybrid SEL'
  );
});

test('getVehicleGalleryImages deduplicates primary and gallery images while preserving order', () => {
  const images = getVehicleGalleryImages({
    imageUrl: 'https://example.com/main.jpg',
    galleryImages: [
      'https://example.com/main.jpg',
      ' https://example.com/interior.jpg ',
      '',
      'https://example.com/engine.jpg',
      'https://example.com/interior.jpg',
    ],
  });

  assert.deepEqual(images, [
    'https://example.com/main.jpg',
    'https://example.com/interior.jpg',
    'https://example.com/engine.jpg',
  ]);
});

test('getRelatedShowroomVehicles excludes current vehicle and prioritizes available & same make first', () => {
  const vehicles: Vehicle[] = [
    ...SAMPLE_VEHICLES,
    {
      ...SAMPLE_VEHICLES[0],
      id: 'v4',
      title: '2024 Toyota RAV4 Hybrid',
      make: 'Toyota',
      model: 'RAV4',
      status: 'available',
    },
    {
      ...SAMPLE_VEHICLES[0],
      id: 'v5',
      title: '2022 Toyota Prado TXL',
      make: 'Toyota',
      model: 'Prado',
      status: 'sold',
    },
  ];

  const related = getRelatedShowroomVehicles(vehicles, vehicles[0]);
  assert.equal(related.some((v) => v.id === vehicles[0].id), false);
  // Available same-make ('v3', 'v4') appear before reserved ('v2') and sold ('v5')
  assert.deepEqual(
    related.map((v) => v.id),
    ['v3', 'v4', 'v2', 'v5']
  );
});

test('getSimilarVehicles matches exact same make or origin excluding current vehicle', () => {
  const vehicles: Vehicle[] = [
    ...SAMPLE_VEHICLES,
    {
      ...SAMPLE_VEHICLES[1],
      id: 'v4',
      title: '2024 Porsche Cayenne S',
      make: 'Porsche',
      model: 'Cayenne',
      origin: 'Germany Import',
      status: 'available',
    },
    {
      ...SAMPLE_VEHICLES[0],
      id: 'v5',
      title: '2023 Nissan Patrol',
      make: 'Nissan',
      model: 'Patrol',
      origin: 'Japan Import',
      status: 'available',
    },
  ];

  // Current is v1 (Toyota, Japan Import): matches v3 (Toyota) and v5 (Japan Import), excluding v1
  const similarToV1 = getSimilarVehicles(vehicles, vehicles[0]);
  assert.deepEqual(
    similarToV1.map((v) => v.id),
    ['v3', 'v5']
  );

  // Current is v2 (Mercedes-Benz, Germany Import): matches v4 (Germany Import)
  const similarToV2 = getSimilarVehicles(vehicles, vehicles[1]);
  assert.deepEqual(
    similarToV2.map((v) => v.id),
    ['v4']
  );
});

test('getVehiclePricingBreakdown calculates savings and percentage when originalPrice exceeds price', () => {
  const discounted = getVehiclePricingBreakdown({ price: 3922, originalPrice: 4276 });
  assert.deepEqual(discounted, {
    originalPrice: 4276,
    finalPrice: 3922,
    discountAmount: 354,
    discountPercent: 8,
    hasDiscount: true,
  });

  const standard = getVehiclePricingBreakdown({ price: 68900 });
  assert.deepEqual(standard, {
    originalPrice: 68900,
    finalPrice: 68900,
    discountAmount: 0,
    discountPercent: 0,
    hasDiscount: false,
  });
});

test('getAvailableColorSwatches returns only colors present on currently available vehicles', () => {
  const swatches = getAvailableColorSwatches([
    { color: 'Pearl White', status: 'available' },
    { color: 'Sonic Titanium Silver', status: 'available' },
    { color: 'Obsidian Black Metallic', status: 'reserved' },
    { color: 'Cobalt Blue', status: 'sold' },
    { color: 'Carmine Red', status: 'available' },
  ]);

  assert.deepEqual(
    swatches.map((s) => ({ label: s.label, query: s.query })),
    [
      { label: 'All Colors', query: '' },
      { label: 'Pearl White', query: 'White' },
      { label: 'Carmine Red', query: 'Red' },
      { label: 'Titanium Silver', query: 'Silver' },
    ]
  );

  assert.deepEqual(
    getAvailableColorSwatches([{ color: 'Pearl White', status: 'sold' }]),
    []
  );
});

test('splitDisplayBrandLines splits multi-word company names into balanced hero display lines', () => {
  assert.deepEqual(splitDisplayBrandLines('Alif Car Import'), ['Alif Car', 'Import']);
  assert.deepEqual(splitDisplayBrandLines('Alif Motors'), ['Alif', 'Motors']);
  assert.deepEqual(splitDisplayBrandLines('Alif'), ['Alif']);
  assert.deepEqual(splitDisplayBrandLines('   '), ['Alif Car', 'Import']);
});

test('resolvePublicAssetUrl rebases stored /assets and /AlifCarImport/assets paths cleanly', () => {
  assert.equal(
    resolvePublicAssetUrl(
      '/AlifCarImport/assets/aistudio/file_00000000f2b48211a1d7ce760b266f14_d8a15dfc.png',
      '/'
    ),
    '/assets/aistudio/file_00000000f2b48211a1d7ce760b266f14_d8a15dfc.png'
  );
  assert.equal(
    resolvePublicAssetUrl('/assets/aistudio/gemini_generated_video_9a151ab3_e5ba47be.mp4', '/AlifCarImport/'),
    '/AlifCarImport/assets/aistudio/gemini_generated_video_9a151ab3_e5ba47be.mp4'
  );
  assert.equal(resolvePublicAssetUrl('data:image/png;base64,abc', '/'), 'data:image/png;base64,abc');
  assert.equal(resolvePublicAssetUrl('https://cdn.example.com/logo.png', '/AlifCarImport/'), 'https://cdn.example.com/logo.png');
});

test('resolveHeroVideoUrl switches legacy default video paths to the current default while keeping custom videos', () => {
  assert.equal(
    resolveHeroVideoUrl(
      '/AlifCarImport/assets/aistudio/gemini_generated_video_9a151ab3_e5ba47be.mp4',
      '/assets/aistudio/Alif_Car_Import_Premium_Vehicles_b269f200.mp4',
      '/AlifCarImport/'
    ),
    '/AlifCarImport/assets/aistudio/Alif_Car_Import_Premium_Vehicles_b269f200.mp4'
  );
  assert.equal(
    resolveHeroVideoUrl(
      '',
      '/assets/aistudio/Alif_Car_Import_Premium_Vehicles_b269f200.mp4',
      '/'
    ),
    '/assets/aistudio/Alif_Car_Import_Premium_Vehicles_b269f200.mp4'
  );
  assert.equal(
    resolveHeroVideoUrl(
      'https://cdn.example.com/custom-showroom-reel.mp4',
      '/assets/aistudio/Alif_Car_Import_Premium_Vehicles_b269f200.mp4',
      '/'
    ),
    'https://cdn.example.com/custom-showroom-reel.mp4'
  );
});

test('mergeRemoteVehiclesWithCatalog merges unsynced legacy Firestore docs without duplicating titles and respects synced deletions', () => {
  const catalog: Vehicle[] = [
    { ...SAMPLE_VEHICLES[0], id: 'song-plus', title: 'Song Plus' },
    { ...SAMPLE_VEHICLES[1], id: 'sealion-05', title: 'Sealion 05' },
    { ...SAMPLE_VEHICLES[2], id: 'byd-e2', title: 'BYD E2' },
  ];

  // Unsynced Firestore containing 2 partial legacy entries + 1 unique custom car
  const legacyRemote: Vehicle[] = [
    { ...SAMPLE_VEHICLES[0], id: 'veh_2025_suv_1641f7', title: 'Song Plus' },
    { ...SAMPLE_VEHICLES[1], id: 'veh_2024_suv_94b657', title: 'Sealion 05' },
    { ...SAMPLE_VEHICLES[2], id: 'veh_custom_1', title: 'Custom Showroom Import' },
  ];

  assert.equal(needsCatalogSyncToFirestore(legacyRemote, catalog), true);
  assert.deepEqual(findLegacyDuplicateVehicleIds(legacyRemote, catalog), [
    'veh_2025_suv_1641f7',
    'veh_2024_suv_94b657',
  ]);

  const mergedUnsynced = mergeRemoteVehiclesWithCatalog(legacyRemote, catalog);
  assert.deepEqual(
    mergedUnsynced.map((v) => v.id),
    ['veh_custom_1', 'song-plus', 'sealion-05', 'byd-e2']
  );

  // Once synced (at least one canonical ID present), Firestore is authoritative even if admin deleted a car
  const syncedAfterAdminDelete: Vehicle[] = [catalog[0], catalog[2]];
  assert.equal(needsCatalogSyncToFirestore(syncedAfterAdminDelete, catalog), false);
  assert.deepEqual(
    mergeRemoteVehiclesWithCatalog(syncedAfterAdminDelete, catalog).map((v) => v.id),
    ['song-plus', 'byd-e2']
  );
});

