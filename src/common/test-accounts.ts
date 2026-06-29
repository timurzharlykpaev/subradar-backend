/**
 * Centralised identity + gating for the three non-real account families that
 * share the fixed-OTP "000000" login backdoor. Before this module the review
 * and E2E checks were duplicated inline in `auth.service` and the throttler
 * guard; the demo family adds a third variant, so the matching + flag logic
 * now lives here once.
 *
 *   1. review@subradar.ai   — App Store reviewers. Gated by
 *                             ENABLE_REVIEW_ACCOUNT; allowed on prod only
 *                             while a build is actively under review.
 *   2. qa-*@subradar.test   — Maestro E2E seed users. Gated by
 *                             ENABLE_REVIEW_ACCOUNT and non-prod only — the
 *                             reserved `.test` TLD (RFC 2606) never resolves,
 *                             so it can only ever be the test harness.
 *   3. testN@subradar.ai    — Marketing/demo accounts used to record App
 *                             Store / social videos. Gated by the SEPARATE
 *                             ENABLE_DEMO_ACCOUNTS flag so the demo channel
 *                             can stay on for a recording session without
 *                             opening the Apple-review backdoor. Allowed on
 *                             prod (that's the whole point — videos are shot
 *                             against the live api.subradar.ai).
 *
 * Real accounts are never affected: every predicate returns false unless the
 * email matches one of the reserved patterns AND its flag is on. A real user
 * on any other address always takes the normal random-OTP / live-AI path.
 */

/** The fixed OTP delivered to every bypass family when its flag is enabled. */
export const FIXED_OTP_CODE = '000000';

const REVIEW_EMAIL = 'review@subradar.ai';
/** test1@subradar.ai, test2@subradar.ai, … — bounded numeric suffix. */
const DEMO_EMAIL_RE = /^test\d+@subradar\.ai$/;
const E2E_SEED_RE = /^qa-.*@subradar\.test$/;
const E2E_TEST_DOMAIN = '@subradar.test';

export type BypassKind = 'review' | 'e2e' | 'demo';

function normaliseEmail(email?: string | null): string {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function reviewAccountsEnabled(): boolean {
  return process.env.ENABLE_REVIEW_ACCOUNT === 'true';
}

export function demoAccountsEnabled(): boolean {
  return process.env.ENABLE_DEMO_ACCOUNTS === 'true';
}

export function isReviewEmail(email?: string | null): boolean {
  return normaliseEmail(email) === REVIEW_EMAIL;
}

export function isDemoEmail(email?: string | null): boolean {
  return DEMO_EMAIL_RE.test(normaliseEmail(email));
}

/**
 * True only for the Maestro E2E seed identities AND only off-prod — matching
 * the original `auth.service` guard. A `qa-*@subradar.test` email in
 * production is treated as an ordinary (non-bypass) address.
 */
export function isE2eSeedEmail(email?: string | null): boolean {
  return E2E_SEED_RE.test(normaliseEmail(email)) && !isProd();
}

/**
 * True when the email is an active demo account: the pattern matches AND the
 * demo flag is on. The AI controller uses this to serve deterministic scan
 * fixtures instead of calling OpenAI, so recorded videos are reproducible.
 */
export function isActiveDemoAccount(email?: string | null): boolean {
  return demoAccountsEnabled() && isDemoEmail(email);
}

export interface OtpBypassResolution {
  /** The email matched one of the reserved bypass families. */
  matched: boolean;
  kind?: BypassKind;
  /** The matched family's env flag is currently on. */
  enabled: boolean;
}

/**
 * Resolve whether an email should receive the fixed "000000" OTP and whether
 * that channel is currently enabled. `sendOtp` uses this to choose between the
 * fixed and a random code, and to 403 when a reserved email is used while its
 * flag is off (so the pattern can't be probed when the channel is closed).
 */
export function resolveOtpBypass(email?: string | null): OtpBypassResolution {
  if (isReviewEmail(email)) {
    return { matched: true, kind: 'review', enabled: reviewAccountsEnabled() };
  }
  if (isDemoEmail(email)) {
    return { matched: true, kind: 'demo', enabled: demoAccountsEnabled() };
  }
  // E2E seed only counts as a bypass off-prod (preserves prior behaviour:
  // a qa-* email in prod falls through to the normal random-OTP path).
  if (E2E_SEED_RE.test(normaliseEmail(email)) && !isProd()) {
    return { matched: true, kind: 'e2e', enabled: reviewAccountsEnabled() };
  }
  return { matched: false, enabled: false };
}

/**
 * Whether rate limiting should be skipped for this email. Review + the whole
 * `@subradar.test` domain ride the review flag (preserves the prior guard,
 * which keyed on the bare domain); demo accounts ride their own flag.
 */
export function shouldSkipThrottle(email?: string | null): boolean {
  const normalised = normaliseEmail(email);
  if (
    reviewAccountsEnabled() &&
    (normalised === REVIEW_EMAIL || normalised.endsWith(E2E_TEST_DOMAIN))
  ) {
    return true;
  }
  return isActiveDemoAccount(normalised);
}
