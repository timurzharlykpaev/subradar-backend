import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'crypto';
import type { ValueTransformer } from 'typeorm';

/**
 * Versioned AES-256-GCM transformer for sensitive PII columns.
 *
 * Ciphertext format on disk:
 *   enc:v1:{base64url(iv)}:{base64url(ciphertext)}:{base64url(authTag)}
 *
 * Reads:
 *   - If the column starts with the `enc:v1:` prefix, decrypt and return.
 *   - Otherwise return the value verbatim (legacy plaintext during the
 *     rolling migration window). This keeps existing rows readable
 *     immediately after deploy without a synchronous re-encryption step.
 * Writes: always emit `enc:v1:...`.
 *
 * Key handling:
 *   - Master key comes from DATA_ENCRYPTION_KEY env (32+ raw bytes hex
 *     OR 32+ ASCII chars; we hash with SHA-256 to derive a 32-byte key
 *     so any sufficiently long value works in practice).
 *   - Failure to load the key (missing/empty env) throws on first use,
 *     not at module load — this lets unit tests that don't exercise
 *     encryption paths run without provisioning a key.
 *
 * Threat model addressed (CASA / ASVS V8.3.7):
 *   - Postgres-level disk encryption (DO Managed) is necessary but not
 *     sufficient: backups, replicas, and log streams may carry
 *     plaintext PII outside the encrypted disk boundary. Column-level
 *     ciphertext means a database snapshot or accidentally-leaked
 *     query log doesn't disclose PII without also disclosing the key.
 */

const VERSION_PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const AUTH_TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'DATA_ENCRYPTION_KEY env var is required for column encryption. ' +
        'Generate via: `openssl rand -hex 32` (or any 32+ char string).',
    );
  }
  // Derive a 32-byte key via SHA-256. Allows operator to pass either a
  // raw 64-hex-char value or a passphrase; output is uniform 32 bytes.
  cachedKey = createHash('sha256').update(raw).digest();
  return cachedKey;
}

// Test helper — call between tests to force re-read from env. Not exported
// in production code paths.
export function _resetCryptoKeyCache(): void {
  cachedKey = null;
}

function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION_PREFIX.replace(/:$/, ''),
    iv.toString('base64url'),
    enc.toString('base64url'),
    tag.toString('base64url'),
  ].join(':');
}

function decrypt(ciphertext: string): string {
  const key = loadKey();
  const parts = ciphertext.split(':');
  // Expect: ['enc', 'v1', iv, enc, tag]
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Malformed ciphertext: unexpected versioned format');
  }
  const iv = Buffer.from(parts[2], 'base64url');
  const enc = Buffer.from(parts[3], 'base64url');
  const tag = Buffer.from(parts[4], 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) {
    throw new Error('Malformed ciphertext: bad iv/tag length');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    'utf8',
  );
}

function isCiphertext(value: string): boolean {
  return value.startsWith(VERSION_PREFIX);
}

/**
 * Public predicate so a one-shot migration script can identify rows that
 * still hold legacy plaintext and need re-encryption.
 */
export function looksEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && isCiphertext(value);
}

/**
 * TypeORM transformer for nullable string columns. Apply with:
 *   @Column({ type: 'varchar', nullable: true, transformer: AesGcmTransformer })
 *
 * `to` is invoked when TypeORM writes (always encrypts).
 * `from` is invoked when TypeORM reads (decrypts ciphertext, passes
 * through legacy plaintext for graceful migration).
 */
export const AesGcmTransformer: ValueTransformer = {
  to(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return null;
    // Idempotency: if a caller hands us already-encrypted data (e.g.
    // a service copy from another encrypted column) don't double-wrap.
    if (isCiphertext(value)) return value;
    return encrypt(value);
  },
  from(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return null;
    if (!isCiphertext(value)) {
      // Legacy plaintext — return as-is. Once the migration script has
      // re-encrypted all rows this branch becomes dead but harmless.
      return value;
    }
    return decrypt(value);
  },
};
