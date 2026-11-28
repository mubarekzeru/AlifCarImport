import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEB_ADMIN_FIRESTORE_DB_ID,
  buildWebAdminSessionId,
  detectBrowserDeviceName,
  extractEmailListFromDoc,
  extractFirestoreTimestampMillis,
  parseAuthTimeMillis,
  sanitizeSessionIdPart,
  shouldForceSignOutForSecurityTimestamp,
} from './webAdminSessionSync';

test('extractEmailListFromDoc extracts emails from arrays, object lists, and maps while skipping revoked entries', () => {
  assert.deepEqual(
    extractEmailListFromDoc({
      adminEmails: ['Primary@Gmail.com', 'staff@alifcarimport.com'],
      allowedEmails: [
        { email: 'Active@Example.com', status: 'approved' },
        { email: 'revoked@example.com', status: 'revoked' },
        { email: 'blocked@example.com', revoked: true },
      ],
      members: {
        'manager@example.com': true,
        'denied@example.com': { status: 'denied' },
      },
    }),
    ['primary@gmail.com', 'staff@alifcarimport.com', 'active@example.com', 'manager@example.com']
  );
  assert.deepEqual(extractEmailListFromDoc(undefined), []);
});

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
  assert.equal(
    detectBrowserDeviceName(
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36'
    ),
    'Samsung Internet on Android'
  );
  assert.equal(detectBrowserDeviceName(''), 'Web Browser on Web');
});

test('extractFirestoreTimestampMillis and parseAuthTimeMillis handle Firestore Timestamps and authTime strings', () => {
  const cutoffMs = Date.parse('2026-11-21T16:30:00.000Z');
  assert.equal(
    extractFirestoreTimestampMillis({ toMillis: () => cutoffMs }),
    cutoffMs
  );
  assert.equal(
    extractFirestoreTimestampMillis({ seconds: Math.floor(cutoffMs / 1000), nanoseconds: 500_000_000 }),
    cutoffMs + 500
  );
  assert.equal(extractFirestoreTimestampMillis(null), null);
  assert.equal(extractFirestoreTimestampMillis(undefined), null);

  const authStr = 'Sat, 21 Nov 2026 16:25:00 GMT';
  assert.equal(parseAuthTimeMillis(authStr), Date.parse(authStr));
  assert.equal(parseAuthTimeMillis('not-a-date'), null);
  assert.equal(parseAuthTimeMillis(''), null);
});

test('shouldForceSignOutForSecurityTimestamp signs out only when auth_time < forceSignOutBefore', () => {
  const cutoffMs = Date.parse('2026-11-21T16:30:00.000Z');
  const firestoreTimestamp = { toMillis: () => cutoffMs };

  // Signed in BEFORE password change / global sign-out -> must sign out
  assert.equal(
    shouldForceSignOutForSecurityTimestamp('Sat, 21 Nov 2026 16:29:59 GMT', firestoreTimestamp),
    true
  );

  // Signed in AT exact cutoff -> stays signed in
  assert.equal(
    shouldForceSignOutForSecurityTimestamp('Sat, 21 Nov 2026 16:30:00 GMT', firestoreTimestamp),
    false
  );

  // Signed in AFTER password change with new password -> stays signed in
  assert.equal(
    shouldForceSignOutForSecurityTimestamp('Sat, 21 Nov 2026 16:30:05 GMT', firestoreTimestamp),
    false
  );

  // Missing forceSignOutBefore or invalid authTime -> never falsely signs out
  assert.equal(
    shouldForceSignOutForSecurityTimestamp('Sat, 21 Nov 2026 16:29:59 GMT', undefined),
    false
  );
  assert.equal(
    shouldForceSignOutForSecurityTimestamp('invalid', firestoreTimestamp),
    false
  );
});
