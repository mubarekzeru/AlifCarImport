import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPageVisitPayload,
  buildVisitSessionKey,
  generateVisitorId,
  normalizeVisitPath,
  shouldTrackVisitPath,
} from './visitTracker';

test('normalizeVisitPath defaults empty path to / and truncates at 200 chars', () => {
  assert.equal(normalizeVisitPath(''), '/');
  assert.equal(normalizeVisitPath(null), '/');
  assert.equal(normalizeVisitPath(undefined), '/');
  assert.equal(normalizeVisitPath('/car/song-plus'), '/car/song-plus');

  const longPath = '/' + 'a'.repeat(250);
  const normalized = normalizeVisitPath(longPath);
  assert.equal(normalized.length, 200);
  assert.ok(normalized.startsWith('/aaa'));
});

test('shouldTrackVisitPath excludes admin routes case-insensitively and allows showroom routes', () => {
  assert.equal(shouldTrackVisitPath('/'), true);
  assert.equal(shouldTrackVisitPath('/car/song-plus'), true);
  assert.equal(shouldTrackVisitPath('/AlifCarImport/'), true);
  assert.equal(shouldTrackVisitPath('/admin'), false);
  assert.equal(shouldTrackVisitPath('/ADMIN/settings'), false);
  assert.equal(shouldTrackVisitPath('/AlifCarImport/admin'), false);
});

test('buildVisitSessionKey uses alif_visited_ prefix matching companion app convention', () => {
  assert.equal(buildVisitSessionKey('/'), 'alif_visited_/');
  assert.equal(buildVisitSessionKey('/car/song-plus'), 'alif_visited_/car/song-plus');
});

test('generateVisitorId produces deterministic v_<base36>_<suffix> format', () => {
  const now = 1795680000000;
  const id = generateVisitorId(now, 0.123456789);
  assert.ok(id.startsWith(`v_${now.toString(36)}_`));
  assert.ok(id.length <= 40);
});

test('buildPageVisitPayload builds expected schema and enforces field length limits', () => {
  const fixedTime = Date.UTC(2026, 10, 27, 10, 30, 0);
  const fakeTimestamp = { _methodName: 'serverTimestamp' } as unknown as NonNullable<
    Parameters<typeof buildPageVisitPayload>[0]['createdAt']
  >;
  const payload = buildPageVisitPayload({
    id: 'abc123XYZ',
    page: '/' + 'p'.repeat(240),
    visitorId: 'v_test_12345',
    referrer: 'https://google.com/' + 'r'.repeat(400),
    userAgent: 'Mozilla/5.0 ' + 'u'.repeat(400),
    nowMillis: fixedTime,
    createdAt: fakeTimestamp,
  });

  assert.equal(payload.id, 'abc123XYZ');
  assert.equal(payload.page.length, 200);
  assert.equal(payload.visitorId, 'v_test_12345');
  assert.equal(payload.dateKey, '2026-11-27');
  assert.equal(payload.referrer.length, 300);
  assert.equal(payload.userAgent.length, 300);
  assert.equal(payload.timestampMillis, fixedTime);
  assert.equal(payload.createdAt, fakeTimestamp);
});
