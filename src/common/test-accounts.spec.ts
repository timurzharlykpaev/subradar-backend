import {
  isActiveDemoAccount,
  isDemoEmail,
  isReviewEmail,
  resolveOtpBypass,
  shouldSkipThrottle,
} from './test-accounts';

describe('test-accounts gating', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  describe('email matching', () => {
    it('matches the review email case-insensitively', () => {
      expect(isReviewEmail('review@subradar.ai')).toBe(true);
      expect(isReviewEmail('  Review@SubRadar.ai ')).toBe(true);
      expect(isReviewEmail('reviewer@subradar.ai')).toBe(false);
    });

    it('matches testN@subradar.ai demo emails only', () => {
      expect(isDemoEmail('test1@subradar.ai')).toBe(true);
      expect(isDemoEmail('test42@subradar.ai')).toBe(true);
      expect(isDemoEmail('test@subradar.ai')).toBe(false); // needs a digit
      expect(isDemoEmail('test1@gmail.com')).toBe(false);
      expect(isDemoEmail('contest1@subradar.ai')).toBe(false);
    });
  });

  describe('resolveOtpBypass', () => {
    it('treats real users as non-bypass', () => {
      expect(resolveOtpBypass('alice@gmail.com')).toEqual({
        matched: false,
        enabled: false,
      });
    });

    it('matches review but reports disabled when the flag is off', () => {
      delete process.env.ENABLE_REVIEW_ACCOUNT;
      expect(resolveOtpBypass('review@subradar.ai')).toEqual({
        matched: true,
        kind: 'review',
        enabled: false,
      });
    });

    it('enables review when the flag is on', () => {
      process.env.ENABLE_REVIEW_ACCOUNT = 'true';
      expect(resolveOtpBypass('review@subradar.ai')).toEqual({
        matched: true,
        kind: 'review',
        enabled: true,
      });
    });

    it('gates demo on ENABLE_DEMO_ACCOUNTS, independent of the review flag', () => {
      process.env.ENABLE_REVIEW_ACCOUNT = 'true';
      delete process.env.ENABLE_DEMO_ACCOUNTS;
      expect(resolveOtpBypass('test1@subradar.ai')).toEqual({
        matched: true,
        kind: 'demo',
        enabled: false,
      });
      process.env.ENABLE_DEMO_ACCOUNTS = 'true';
      expect(resolveOtpBypass('test1@subradar.ai')).toEqual({
        matched: true,
        kind: 'demo',
        enabled: true,
      });
    });

    it('does not treat qa-*@subradar.test as a bypass in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_REVIEW_ACCOUNT = 'true';
      expect(resolveOtpBypass('qa-pro@subradar.test')).toEqual({
        matched: false,
        enabled: false,
      });
    });

    it('treats qa-*@subradar.test as a bypass off-prod', () => {
      process.env.NODE_ENV = 'test';
      process.env.ENABLE_REVIEW_ACCOUNT = 'true';
      expect(resolveOtpBypass('qa-pro@subradar.test')).toEqual({
        matched: true,
        kind: 'e2e',
        enabled: true,
      });
    });
  });

  describe('isActiveDemoAccount', () => {
    it('is true only when the email matches AND the flag is on', () => {
      delete process.env.ENABLE_DEMO_ACCOUNTS;
      expect(isActiveDemoAccount('test1@subradar.ai')).toBe(false);
      process.env.ENABLE_DEMO_ACCOUNTS = 'true';
      expect(isActiveDemoAccount('test1@subradar.ai')).toBe(true);
      expect(isActiveDemoAccount('alice@gmail.com')).toBe(false);
    });
  });

  describe('shouldSkipThrottle', () => {
    it('skips review + @subradar.test under the review flag', () => {
      process.env.ENABLE_REVIEW_ACCOUNT = 'true';
      expect(shouldSkipThrottle('review@subradar.ai')).toBe(true);
      expect(shouldSkipThrottle('qa-x@subradar.test')).toBe(true);
      expect(shouldSkipThrottle('alice@gmail.com')).toBe(false);
    });

    it('skips demo accounts under the demo flag', () => {
      delete process.env.ENABLE_REVIEW_ACCOUNT;
      process.env.ENABLE_DEMO_ACCOUNTS = 'true';
      expect(shouldSkipThrottle('test2@subradar.ai')).toBe(true);
    });

    it('does not skip anything with all flags off', () => {
      delete process.env.ENABLE_REVIEW_ACCOUNT;
      delete process.env.ENABLE_DEMO_ACCOUNTS;
      expect(shouldSkipThrottle('review@subradar.ai')).toBe(false);
      expect(shouldSkipThrottle('test1@subradar.ai')).toBe(false);
    });
  });
});
