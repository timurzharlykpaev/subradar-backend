import {
  AesGcmTransformer,
  looksEncrypted,
  _resetCryptoKeyCache,
} from './aes-gcm-transformer';

describe('AesGcmTransformer', () => {
  const PREV_KEY = process.env.DATA_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.DATA_ENCRYPTION_KEY =
      'unit-test-key-do-not-use-in-prod-must-be-long-enough';
    _resetCryptoKeyCache();
  });

  afterAll(() => {
    if (PREV_KEY !== undefined) process.env.DATA_ENCRYPTION_KEY = PREV_KEY;
    else delete process.env.DATA_ENCRYPTION_KEY;
    _resetCryptoKeyCache();
  });

  describe('to (write)', () => {
    it('returns null for null/undefined', () => {
      expect(AesGcmTransformer.to(null)).toBeNull();
      expect(AesGcmTransformer.to(undefined)).toBeNull();
    });

    it('produces enc:v1: prefix on every write', () => {
      const out = AesGcmTransformer.to('hello world') as string;
      expect(out.startsWith('enc:v1:')).toBe(true);
      expect(looksEncrypted(out)).toBe(true);
    });

    it('produces a different ciphertext on repeat encrypt (random IV)', () => {
      const a = AesGcmTransformer.to('same plaintext') as string;
      const b = AesGcmTransformer.to('same plaintext') as string;
      expect(a).not.toBe(b);
    });

    it('does NOT double-wrap an already-encrypted value', () => {
      const once = AesGcmTransformer.to('first') as string;
      const twice = AesGcmTransformer.to(once);
      expect(twice).toBe(once);
    });
  });

  describe('from (read)', () => {
    it('returns null for null/undefined', () => {
      expect(AesGcmTransformer.from(null)).toBeNull();
      expect(AesGcmTransformer.from(undefined)).toBeNull();
    });

    it('round-trips arbitrary UTF-8 strings', () => {
      const samples = [
        'simple-ascii',
        'with spaces and 123 numbers',
        'unicode 🚀 emoji + кириллица',
        'a'.repeat(10_000), // long
        '',
      ];
      for (const s of samples) {
        const enc = AesGcmTransformer.to(s) as string;
        expect(AesGcmTransformer.from(enc)).toBe(s);
      }
    });

    it('passes through legacy plaintext that lacks the enc:v1: prefix', () => {
      // Pre-migration rows hold the raw value with no prefix.
      expect(AesGcmTransformer.from('legacy-google-sub-12345')).toBe(
        'legacy-google-sub-12345',
      );
    });

    it('rejects malformed ciphertext (wrong segment count)', () => {
      expect(() =>
        AesGcmTransformer.from('enc:v1:not-enough-parts'),
      ).toThrow();
    });

    it('rejects malformed ciphertext (bad iv length)', () => {
      // A v1-prefixed value with wrong-length IV must NOT silently decrypt
      // to garbage — throw so callers see the corruption.
      expect(() => AesGcmTransformer.from('enc:v1:aaaa:bbbb:cccc')).toThrow();
    });

    it('rejects ciphertext encrypted with a different key (auth-tag mismatch)', () => {
      const encWithKeyA = AesGcmTransformer.to('secret') as string;
      // Rotate the master key.
      process.env.DATA_ENCRYPTION_KEY = 'a-completely-different-master-key-32+chars';
      _resetCryptoKeyCache();
      expect(() => AesGcmTransformer.from(encWithKeyA)).toThrow();
    });
  });

  describe('key handling', () => {
    it('throws if DATA_ENCRYPTION_KEY is not set when first used', () => {
      delete process.env.DATA_ENCRYPTION_KEY;
      _resetCryptoKeyCache();
      expect(() => AesGcmTransformer.to('foo')).toThrow(
        /DATA_ENCRYPTION_KEY env var is required/,
      );
    });

    it('rejects whitespace-only key', () => {
      process.env.DATA_ENCRYPTION_KEY = '   \t\n  ';
      _resetCryptoKeyCache();
      expect(() => AesGcmTransformer.to('foo')).toThrow();
    });

    it('accepts a passphrase OR a hex key (SHA-256 derives 32 bytes)', () => {
      process.env.DATA_ENCRYPTION_KEY = 'short-passphrase-with-enough-entropy-to-pass';
      _resetCryptoKeyCache();
      expect(() => AesGcmTransformer.to('foo')).not.toThrow();
    });
  });

  describe('looksEncrypted', () => {
    it('detects enc:v1: prefix', () => {
      expect(looksEncrypted('enc:v1:abc:def:ghi')).toBe(true);
    });
    it('returns false for plaintext / nullish / non-string', () => {
      expect(looksEncrypted('plaintext')).toBe(false);
      expect(looksEncrypted(null)).toBe(false);
      expect(looksEncrypted(undefined)).toBe(false);
      expect(looksEncrypted('')).toBe(false);
    });
  });
});
