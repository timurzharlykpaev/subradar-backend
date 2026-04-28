import { pushT, resolvePushLocale, SUPPORTED_PUSH_LOCALES } from './index';

describe('push-i18n', () => {
  describe('resolvePushLocale', () => {
    it('returns "en" for null/undefined/empty', () => {
      expect(resolvePushLocale(null)).toBe('en');
      expect(resolvePushLocale(undefined)).toBe('en');
      expect(resolvePushLocale('')).toBe('en');
    });

    it('strips region suffix (ru-RU → ru, en_US → en)', () => {
      expect(resolvePushLocale('ru-RU')).toBe('ru');
      expect(resolvePushLocale('en_US')).toBe('en');
      expect(resolvePushLocale('pt-BR')).toBe('pt');
    });

    it('lowercases the input', () => {
      expect(resolvePushLocale('RU')).toBe('ru');
      expect(resolvePushLocale('De')).toBe('de');
    });

    it('falls back to "en" for unsupported language code', () => {
      expect(resolvePushLocale('xx')).toBe('en');
      expect(resolvePushLocale('uk-UA')).toBe('en');
    });

    it('accepts every locale in SUPPORTED_PUSH_LOCALES', () => {
      for (const code of SUPPORTED_PUSH_LOCALES) {
        expect(resolvePushLocale(code)).toBe(code);
      }
    });
  });

  describe('pushT — every locale renders every scenario', () => {
    const params = {
      paymentReminder: {
        name: 'Netflix',
        amount: 12,
        currency: 'USD',
        daysLeft: 3,
        dateStr: '2026-05-01',
      },
      paymentRemindersDigest: {
        count: 3,
        totalAmount: 42,
        currency: 'USD',
        earliestDays: 1,
        topNames: ['Netflix', 'Spotify'],
      },
      trialExpiry: { daysLeft: 1 },
      proExpiration: { daysLeft: 7 },
      weeklyDigest: {
        currency: 'USD',
        totalMonthly: 42,
        activeCount: 5,
        renewingThisWeek: 2,
      },
      winBack: { upcomingCount: 3 },
    };

    for (const code of SUPPORTED_PUSH_LOCALES) {
      it(`${code}: renders all scenarios with non-empty title/body`, () => {
        const dict = pushT(code);
        for (const key of Object.keys(params) as (keyof typeof params)[]) {
          const result = (dict[key] as any)(params[key]);
          expect(result.title).toBeTruthy();
          expect(result.body).toBeTruthy();
          expect(typeof result.title).toBe('string');
          expect(typeof result.body).toBe('string');
        }
      });
    }
  });

  describe('pushT — Russian pluralization', () => {
    it('uses "день" for 1, "дня" for 3, "дней" for 5', () => {
      const ru = pushT('ru');
      expect(ru.trialExpiry({ daysLeft: 1 }).title).toContain('день');
      expect(ru.trialExpiry({ daysLeft: 3 }).title).toContain('дня');
      expect(ru.trialExpiry({ daysLeft: 5 }).title).toContain('дней');
    });
  });

  describe('pushT — English pluralization', () => {
    it('uses "1 day" for 1 and "3 days" for 3', () => {
      const en = pushT('en');
      expect(en.trialExpiry({ daysLeft: 1 }).title).toContain('1 day');
      expect(en.trialExpiry({ daysLeft: 3 }).title).toContain('3 days');
    });
  });
});
