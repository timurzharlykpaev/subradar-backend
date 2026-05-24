/**
 * Shared service-name normalisation used for dedup keys across the
 * codebase. Two places call it:
 *
 *   1. GmailScanService.filterDuplicates — drops candidates that match
 *      a subscription the user already has.
 *   2. SubscriptionsService.create — idempotent guard that returns the
 *      existing subscription instead of inserting a duplicate row when
 *      the same (normalized name, currency, billing period, active
 *      status) tuple is already present.
 *
 * Was previously a private method on MarketDataService; pulled out into
 * a stateless util so SubscriptionsService can use the exact same key
 * without a module dep on AnalysisModule (and the forwardRef ceremony
 * that would entail).
 *
 * Output rules (kept identical to the original for cache-key parity):
 *   - lowercase + trim
 *   - strip plan/tier modifiers (premium, basic, pro, family, …)
 *   - strip billing-frequency words (monthly, yearly, annual, …)
 *   - strip plan-noun words (plan, subscription, tier, membership)
 *   - strip non-alphanumeric except spaces, collapse spaces → underscore
 *   - trim leading/trailing underscores
 */
export function normalizeServiceName(raw: string): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .trim()
    .replace(
      /\s+(premium|basic|standard|pro|plus|family|team|enterprise|business|starter|individual|duo|student)\b/gi,
      '',
    )
    .replace(/\s+(monthly|yearly|annual|lifetime)\b/gi, '')
    .replace(/\s+(plan|subscription|tier|membership)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_|_$/g, '');
}
