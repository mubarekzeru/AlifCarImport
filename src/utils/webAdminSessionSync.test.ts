import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEB_ADMIN_FIRESTORE_DB_ID,
  buildWebAdminSessionId,
  detectBrowserDeviceName,
  sanitizeSessionIdPart,
} from './webAdminSessionSync';

test('WEB_ADMIN_FIRESTORE_DB_ID matches the shared Firestore database ID', () => {
  assert.equal(
    WEB_ADMIN_FIRESTORE_DB_ID,
    'ai-studio-alifcarportal-c5b73261-7322-4966-b5e2-59c51963e99b'
  );
});

test('sanitizeSessionIdPart and buildWebAdminSessionId produce rule-compliant document IDs', () => {
  assert.equal(sanitizeSessionIdPart('abc!@#_12-34'), 'abc_12-34');
  const sessionId = buildWebAdminSessionId('uid1234567890extra', 'dev-9876543210extra');
  assert.equal(sessionId, 'web_uid1234567_dev-98765432');
  assert.match(sessionId, /^[a-zA-Z0-9_-]{1,128}$/);

  const fallbackId = buildWebAdminSessionId('', '');
  assert.equal(fallbackId, 'web_admin_browser');
});

test('detectBrowserDeviceName identifies browser and OS cleanly', () => {
  assert.equal(
    detectBrowserDeviceName(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
    ),
    'Chrome on Windows'
  );
  assert.equal(
    detectBrowserDeviceName(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'
    ),
    'Edge on Windows'
  );
  assert.equal(
    detectBrowserDeviceName(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'
    ),
    'Safari on iOS'
  );
  assert.equal(
    detectBrowserDeviceName(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36'
    ),
    'Chrome on Android'
  );
  assert.equal(
    detectBrowserDeviceName(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5; rv:128.0) Gecko/20100101 Firefox/128.0'
    ),
    'Firefox on macOS'
  );
  assert.equal(detectBrowserDeviceName(''), 'Web Browser on Web');
});
