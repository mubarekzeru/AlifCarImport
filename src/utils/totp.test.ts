import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractAppTwoFactorConfig,
  generateTotpCode,
  normalizeTotpSecret,
  verifyTotpCode,
  verifyTwoFactorCodeOrBackup,
} from './totp';

// RFC 6238 SHA-1 test vector: ASCII "12345678901234567890" -> Base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
const RFC_TEST_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('generateTotpCode matches RFC 6238 SHA-1 test vector', async () => {
  // At t = 59s, RFC 6238 8-digit SHA-1 value is 94287082 -> 6-digit is 287082
  const codeAt59 = await generateTotpCode(RFC_TEST_SECRET_BASE32, 59_000);
  assert.equal(codeAt59, '287082');

  // At t = 1111111109s, RFC 6238 8-digit SHA-1 value is 07081804 -> 6-digit is 081804
  const codeAt1111 = await generateTotpCode(RFC_TEST_SECRET_BASE32, 1_111_111_109_000);
  assert.equal(codeAt1111, '081804');
});

test('verifyTotpCode accepts current and +/-1 30s window codes and rejects wrong codes', async () => {
  const nowMs = 1_730_000_000_000;
  const currentCode = await generateTotpCode(RFC_TEST_SECRET_BASE32, nowMs);
  const prevCode = await generateTotpCode(RFC_TEST_SECRET_BASE32, nowMs - 30_000);
  const nextCode = await generateTotpCode(RFC_TEST_SECRET_BASE32, nowMs + 30_000);
  const expiredCode = await generateTotpCode(RFC_TEST_SECRET_BASE32, nowMs - 120_000);

  assert.equal(await verifyTotpCode(RFC_TEST_SECRET_BASE32, currentCode, nowMs), true);
  assert.equal(await verifyTotpCode(RFC_TEST_SECRET_BASE32, prevCode, nowMs), true);
  assert.equal(await verifyTotpCode(RFC_TEST_SECRET_BASE32, nextCode, nowMs), true);
  assert.equal(await verifyTotpCode(RFC_TEST_SECRET_BASE32, expiredCode, nowMs), false);
  assert.equal(await verifyTotpCode(RFC_TEST_SECRET_BASE32, '000000', nowMs), false);
  assert.equal(await verifyTotpCode(RFC_TEST_SECRET_BASE32, '123', nowMs), false);
});

test('normalizeTotpSecret parses raw Base32 and otpauth URIs', () => {
  assert.equal(normalizeTotpSecret(' gezd gnbv gy3t qojq '), 'GEZDGNBVGY3TQOJQ');
  assert.equal(
    normalizeTotpSecret(
      'otpauth://totp/AlifCarImport:admin?secret=JBSWY3DPEHPK3PXP&issuer=AlifCarImport'
    ),
    'JBSWY3DPEHPK3PXP'
  );
});

test('extractAppTwoFactorConfig detects flat and nested Firestore security schemas', async () => {
  const flat = extractAppTwoFactorConfig({
    totpEnabled: true,
    totpSecret: RFC_TEST_SECRET_BASE32,
    backupCodes: ['ABC-123'],
  });
  assert.equal(flat.enabled, true);
  assert.equal(flat.secret, RFC_TEST_SECRET_BASE32);
  assert.deepEqual(flat.backupCodes, ['ABC-123']);

  const nested = extractAppTwoFactorConfig({
    authenticator: {
      enabled: true,
      otpauthUri: `otpauth://totp/Alif?secret=${RFC_TEST_SECRET_BASE32}`,
    },
  });
  assert.equal(nested.enabled, true);
  assert.equal(nested.secret, RFC_TEST_SECRET_BASE32);

  assert.equal(await verifyTwoFactorCodeOrBackup(flat, 'ABC-123', 59_000), true);
  assert.equal(await verifyTwoFactorCodeOrBackup(flat, '287082', 59_000), true);
  assert.equal(await verifyTwoFactorCodeOrBackup(flat, '999999', 59_000), false);
});
