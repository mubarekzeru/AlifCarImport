/**
 * Pure RFC 6238 / RFC 4226 TOTP helper (Web Crypto HMAC-SHA1)
 * + flexible extractor for companion Android app Firestore security documents.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(byteLength = 20): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function buildOtpAuthUrl(secretBase32: string, accountEmail: string, issuer = 'Alif Car Import'): string {
  const cleanSecret = normalizeTotpSecret(secretBase32);
  const label = encodeURIComponent(`${issuer}:${accountEmail || 'admin'}`);
  const iss = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${cleanSecret}&issuer=${iss}&algorithm=SHA1&digits=6&period=30`;
}

export function normalizeTotpSecret(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Support otpauth://totp/...?secret=BASE32... URIs as well as raw Base32 secrets
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    try {
      const parsed = new URL(trimmed);
      const paramSecret = parsed.searchParams.get('secret') || '';
      return paramSecret.toUpperCase().replace(/[^A-Z2-7]/g, '');
    } catch {
      const match = trimmed.match(/[?&]secret=([A-Za-z2-7=]+)/i);
      return match ? match[1].toUpperCase().replace(/[^A-Z2-7]/g, '') : '';
    }
  }

  // Reject values that clearly aren't Base32 secrets (like URLs, emails, sentences)
  if (/[@:/\\]/.test(trimmed)) return '';
  const stripped = trimmed.toUpperCase().replace(/[\s-=]/g, '');
  if (!/^[A-Z2-7]+$/.test(stripped)) return '';
  return stripped;
}

export function decodeBase32(base32: string): Uint8Array {
  const clean = normalizeTotpSecret(base32);
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export async function generateTotpCode(
  secretBase32: string,
  timestampMs = Date.now(),
  stepSeconds = 30,
  digits = 6
): Promise<string> {
  const keyBytes = decodeBase32(secretBase32);
  if (keyBytes.length === 0) {
    return '';
  }

  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBytes = new Uint8Array(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }

  const keyBuffer = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength
  ) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBytes));
  const offset = sig[sig.length - 1] & 0x0f;
  const binCode =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);

  const mod = 10 ** digits;
  return String(binCode % mod).padStart(digits, '0');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyTotpCode(
  secretBase32: string,
  inputCode: string,
  timestampMs = Date.now(),
  windowSteps = 1
): Promise<boolean> {
  const cleanCode = String(inputCode ?? '').replace(/\D/g, '');
  if (cleanCode.length !== 6) return false;

  const cleanSecret = normalizeTotpSecret(secretBase32);
  if (!cleanSecret) return false;

  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const candidate = await generateTotpCode(cleanSecret, timestampMs + delta * 30_000);
    if (candidate && timingSafeEqual(candidate, cleanCode)) {
      return true;
    }
  }
  return false;
}

export interface ExtractedTwoFactorConfig {
  enabled: boolean;
  secret: string;
  backupCodes: string[];
}

function isTruthyFlag(val: unknown): boolean {
  return val === true || val === 'true' || val === 1 || val === 'enabled' || val === 'active';
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

function readStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => (typeof item === 'string' ? item.trim().toUpperCase() : ''))
    .filter(Boolean);
}

/**
 * Inspects a Firestore security document written by the companion Android app
 * (e.g. config/security, admins/{uid}, or per-user maps) and extracts 2FA enabled status,
 * TOTP secret, and optional backup codes across common camelCase and snake_case field names.
 */
export function extractAppTwoFactorConfig(
  data: Record<string, unknown> | null | undefined,
  uid?: string
): ExtractedTwoFactorConfig {
  if (!isPlainRecord(data)) {
    return { enabled: false, secret: '', backupCodes: [] };
  }

  const sources: Record<string, unknown>[] = [data];
  const nestedKeys = [
    'twoFactor',
    'two_factor',
    'totp',
    'authenticator',
    'mfa',
    'security',
    'auth',
    'settings',
  ];
  for (const key of nestedKeys) {
    if (isPlainRecord(data[key])) {
      sources.push(data[key] as Record<string, unknown>);
    }
  }

  if (uid) {
    if (isPlainRecord(data[uid])) {
      sources.push(data[uid] as Record<string, unknown>);
    }
    for (const mapKey of ['users', 'accounts', 'byUid', 'totpByUid', 'twoFactorByUid', 'secrets']) {
      const container = data[mapKey];
      if (isPlainRecord(container)) {
        const entry = container[uid];
        if (isPlainRecord(entry)) {
          sources.push(entry);
        } else if (typeof entry === 'string') {
          const maybeSecret = normalizeTotpSecret(entry);
          if (maybeSecret.length >= 16) {
            sources.push({ totpSecret: maybeSecret });
          }
        }
      }
    }
  }

  const enabledKeys = [
    'twoFactorEnabled',
    'two_factor_enabled',
    'totpEnabled',
    'totp_enabled',
    'authenticatorEnabled',
    'authenticator_enabled',
    'mfaEnabled',
    'mfa_enabled',
    'auth2faEnabled',
    'twoFactorAuthEnabled',
    'is2faEnabled',
    'isTwoFactorEnabled',
    'isTotpEnabled',
    'isAuthenticatorEnabled',
    'isMfaEnabled',
    'twoStepEnabled',
    'otpEnabled',
    'gaEnabled',
    'require2fa',
    'requireAuthCode',
    'requireTotp',
    'authenticatorConnected',
    'enabled',
  ];

  const secretKeys = [
    'totpSecret',
    'totp_secret',
    'totpSecretKey',
    'twoFactorSecret',
    'two_factor_secret',
    'twoFaSecret',
    'authenticatorSecret',
    'authenticator_secret',
    'authenticatorKey',
    'mfaSecret',
    'mfa_secret',
    'otpSecret',
    'authSecret',
    'gaSecret',
    'qrSecret',
    'base32Secret',
    'secretKey',
    'secretBase32',
    'totpKey',
    'secret',
    'otpauthUrl',
    'otpauthUri',
    'totpUri',
  ];

  let enabled = false;
  let secret = '';
  const backupCodes: string[] = [];

  for (const src of sources) {
    if (!enabled) {
      for (const k of enabledKeys) {
        if (isTruthyFlag(src[k])) {
          enabled = true;
          break;
        }
      }
    }
    if (!secret) {
      for (const k of secretKeys) {
        const candidate = normalizeTotpSecret(src[k]);
        if (candidate.length >= 16) {
          secret = candidate;
          break;
        }
      }
    }
    // Dynamic fallback: inspect any key mentioning secret/otpauth/totp with a valid Base32 value
    if (!secret) {
      for (const [k, v] of Object.entries(src)) {
        if (typeof v !== 'string') continue;
        const lowerKey = k.toLowerCase();
        if (
          lowerKey.includes('secret') ||
          lowerKey.includes('otpauth') ||
          (lowerKey.includes('totp') && !lowerKey.includes('enabled'))
        ) {
          const candidate = normalizeTotpSecret(v);
          if (candidate.length >= 16) {
            secret = candidate;
            break;
          }
        }
      }
    }
    for (const k of ['backupCodes', 'recoveryCodes', 'twoFactorBackupCodes', 'backup_codes']) {
      for (const code of readStringArray(src[k])) {
        if (!backupCodes.includes(code)) {
          backupCodes.push(code);
        }
      }
    }
  }

  return { enabled, secret, backupCodes };
}

export async function verifyTwoFactorCodeOrBackup(
  config: ExtractedTwoFactorConfig,
  inputCode: string,
  timestampMs = Date.now()
): Promise<boolean> {
  if (config.secret) {
    const validTotp = await verifyTotpCode(config.secret, inputCode, timestampMs, 1);
    if (validTotp) return true;
  }
  const normalizedInput = String(inputCode ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (normalizedInput && config.backupCodes.length > 0) {
    for (const code of config.backupCodes) {
      if (timingSafeEqual(code.replace(/\s+/g, ''), normalizedInput)) {
        return true;
      }
    }
  }
  return false;
}
