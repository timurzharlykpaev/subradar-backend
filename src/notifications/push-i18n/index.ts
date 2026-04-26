import { en } from './locales/en';
import { ru } from './locales/ru';
import { es } from './locales/es';
import { de } from './locales/de';
import { fr } from './locales/fr';
import { pt } from './locales/pt';
import { zh } from './locales/zh';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { kk } from './locales/kk';
import { PushI18n, SupportedPushLocale, SUPPORTED_PUSH_LOCALES } from './types';

const DICTIONARIES: Record<SupportedPushLocale, PushI18n> = {
  en,
  ru,
  es,
  de,
  fr,
  pt,
  zh,
  ja,
  ko,
  kk,
};

/**
 * Resolve a free-form locale string ("ru", "ru-RU", "RU", null) to one of our
 * 10 supported push locales. Falls back to 'en' when nothing matches — never
 * throws. Used at every push call site so a corrupted user.locale value never
 * blocks delivery.
 */
export function resolvePushLocale(
  locale: string | null | undefined,
): SupportedPushLocale {
  if (!locale) return 'en';
  const lang = locale.split(/[-_]/)[0].toLowerCase();
  return (SUPPORTED_PUSH_LOCALES as readonly string[]).includes(lang)
    ? (lang as SupportedPushLocale)
    : 'en';
}

/**
 * Return the typed translator for a given locale. Use like:
 *   const { paymentReminder } = pushT(user.locale);
 *   const { title, body } = paymentReminder({ name, amount, ... });
 */
export function pushT(locale: string | null | undefined): PushI18n {
  return DICTIONARIES[resolvePushLocale(locale)];
}

export type { PushI18n, SupportedPushLocale };
export { SUPPORTED_PUSH_LOCALES };
