/**
 * Type contract for push notification translation dictionaries.
 *
 * Every server-side push that reaches a real user must use one of these keys
 * (no inline string literals). Adding a new push scenario:
 *  1. Add fields to PushI18n below.
 *  2. Add the matching strings to ALL 10 locale files (en/ru/es/de/fr/pt/zh/ja/ko/kk).
 *  3. Use `pushT(locale, fn)` from ./index.ts at the call site.
 */

export interface PushI18n {
  /** Daily payment reminder N days before billing date. */
  paymentReminder: (params: {
    name: string;
    amount: number | string;
    currency: string;
    daysLeft: number;
    dateStr: string;
  }) => { title: string; body: string };

  /**
   * Daily digest replacement for paymentReminder. Fires once per user per
   * day and bundles every same-day reminder so a user with 5 due subs gets
   * one push instead of five.
   */
  paymentRemindersDigest: (params: {
    count: number;
    totalAmount: number;
    currency: string;
    earliestDays: number;
    topNames: string[];
  }) => { title: string; body: string };

  /** Trial-ending nudge (1 or 4 days before trialEndDate). */
  trialExpiry: (params: { daysLeft: number }) => {
    title: string;
    body: string;
  };

  /** Pro subscription about to expire (cancelAtPeriodEnd=true). */
  proExpiration: (params: { daysLeft: number }) => {
    title: string;
    body: string;
  };

  /** Sunday weekly summary push. */
  weeklyDigest: (params: {
    currency: string;
    totalMonthly: number;
    activeCount: number;
    renewingThisWeek: number;
  }) => { title: string; body: string };

  /** Re-engagement push for users inactive 7+ days with upcoming charges. */
  winBack: (params: { upcomingCount: number }) => {
    title: string;
    body: string;
  };

  /**
   * Gmail bulk-scan finished. Intentionally low-precision body — we never
   * surface dollar amounts or brand names on the lock screen because the
   * scan ran against the user's real inbox.
   */
  gmailScanComplete: (params: { candidates: number }) => {
    title: string;
    body: string;
  };

  /**
   * Individual subscription's free trial about to end (e.g. user added
   * Netflix trial, it ends tomorrow). Fired from trial-checker.cron.
   */
  subscriptionTrialEnding: (params: { name: string; daysLeft: number }) => {
    title: string;
    body: string;
  };

  /** Pro plan trial ends tomorrow (backend trial, not RC/LS). */
  proTrialExpiring: () => { title: string; body: string };

  /** Pro plan trial has already expired — user was just downgraded. */
  proTrialExpired: () => { title: string; body: string };
}

export const SUPPORTED_PUSH_LOCALES = [
  'en',
  'ru',
  'es',
  'de',
  'fr',
  'pt',
  'zh',
  'ja',
  'ko',
  'kk',
] as const;

export type SupportedPushLocale = (typeof SUPPORTED_PUSH_LOCALES)[number];
