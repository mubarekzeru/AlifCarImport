import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const rulesText = fs.readFileSync(RULES_PATH, 'utf-8');

test('firestore.rules enforces rules_version = 2 and global default-deny catch-all', () => {
  assert.match(rulesText, /^rules_version = '2';/m);
  assert.match(rulesText, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
});

test('firestore.rules requires email_verified and bootstraps alifcarimports@gmail.com as owner', () => {
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesText, /request\.auth\.token\.email\.lower\(\) == 'alifcarimports@gmail\.com'/);
  assert.equal(rulesText.includes('mubyzeru@gmail.com'), false);
});

test('firestore.rules defines hardened gates for all blueprint collections', () => {
  for (const col of ['config', 'admins', 'vehicles', 'tiktokPosts', 'inquiries']) {
    assert.match(rulesText, new RegExp(`match /${col}/\\{`));
  }
  assert.match(rulesText, /isValidId\(/);
  assert.match(rulesText, /isValidVehicle\(/);
  assert.match(rulesText, /isValidTikTokPost\(/);
  assert.match(rulesText, /isValidShowroomConfig\(/);
  assert.match(rulesText, /isValidInquiry\(/);
});
