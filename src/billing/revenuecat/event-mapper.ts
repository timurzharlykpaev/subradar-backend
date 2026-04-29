import { BillingEvent } from '../state-machine/types';

/**
 * Minimal shape of the RevenueCat webhook `event` object — see:
 * https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 *
 * We only model the fields consumed by the state-machine mapper; the rest
 * (currency, price_in_purchased_currency, environment …) is still available
 * on the raw event for audit/logging.
 */
export interface RCRawEvent {
  type: string;
  product_id?: string;
  period_type?: string;
  expiration_at_ms?: number | string | null;
  purchased_at_ms?: number | string | null;
  app_user_id: string;
  id?: string;
  event_timestamp_ms?: number;
  /**
   * "PRODUCTION" | "SANDBOX". Used by the webhook handler to filter out
   * sandbox events on the prod backend — without this filter a developer
   * with a TestFlight build can flip real prod users to Pro by triggering
   * sandbox transactions.
   */
  environment?: 'PRODUCTION' | 'SANDBOX';
  /**
   * Why the subscription was cancelled. RC sets this to "REFUNDED" when
   * Apple grants a refund — we map that to RC_REFUND so access is removed
   * immediately, not deferred to period end.
   */
  cancel_reason?: string;
  cancellation_reason?: string;
}

/**
 * Product identifiers we ship to Apple / Google. Sandbox / StoreKit test
 * ids share the mapping — RC normalises these upstream.
 *
 * Keep in sync with `RC_PRODUCT_TO_PLAN` in `billing.service.ts`.
 */
export const PRODUCT_TO_PLAN: Record<string, 'pro' | 'organization'> = {
  'io.subradar.mobile.pro.monthly': 'pro',
  'io.subradar.mobile.pro.yearly': 'pro',
  'io.subradar.mobile.team.monthly': 'organization',
  'io.subradar.mobile.team.yearly': 'organization',
  'com.goalin.subradar.pro.monthly': 'pro',
  'com.goalin.subradar.pro.yearly': 'pro',
  'com.goalin.subradar.team.monthly': 'organization',
  'com.goalin.subradar.team.yearly': 'organization',
};

export const PRODUCT_TO_PERIOD: Record<string, 'monthly' | 'yearly'> = {
  'io.subradar.mobile.pro.monthly': 'monthly',
  'io.subradar.mobile.pro.yearly': 'yearly',
  'io.subradar.mobile.team.monthly': 'monthly',
  'io.subradar.mobile.team.yearly': 'yearly',
  'com.goalin.subradar.pro.monthly': 'monthly',
  'com.goalin.subradar.pro.yearly': 'yearly',
  'com.goalin.subradar.team.monthly': 'monthly',
  'com.goalin.subradar.team.yearly': 'yearly',
};

function parseMs(v: number | string | null | undefined): Date {
  if (v === null || v === undefined) return new Date();
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return new Date();
  return new Date(n);
}

/**
 * Translate a RevenueCat webhook event into a billing state-machine event.
 *
 * Returns `null` for events we deliberately don't transition on (e.g.
 * `TRANSFER`, `SUBSCRIBER_ALIAS`, `TEST`) — the caller logs-and-skips.
 */
export function mapRCEventToBillingEvent(e: RCRawEvent): BillingEvent | null {
  const productId = e.product_id ?? '';
  const plan = PRODUCT_TO_PLAN[productId];
  // Fallback period from product id naming convention; matches the legacy
  // `extractBillingPeriod` behaviour so we don't regress on off-catalog ids.
  const period =
    PRODUCT_TO_PERIOD[productId] ??
    (productId.toLowerCase().includes('yearly') ? 'yearly' : 'monthly');
  const periodStart = parseMs(e.purchased_at_ms);
  const periodEnd = parseMs(e.expiration_at_ms);

  switch (e.type) {
    case 'INITIAL_PURCHASE':
      return plan
        ? { type: 'RC_INITIAL_PURCHASE', plan, period, periodStart, periodEnd }
        : null;
    case 'RENEWAL':
    case 'NON_RENEWING_PURCHASE':
      return { type: 'RC_RENEWAL', periodStart, periodEnd };
    case 'PRODUCT_CHANGE':
      return plan
        ? { type: 'RC_PRODUCT_CHANGE', newPlan: plan, period, periodStart, periodEnd }
        : null;
    case 'CANCELLATION': {
      // Refund-style cancellations have a different cancellation_reason
      // and require an immediate downgrade — Apple already reversed the
      // charge, the user is no longer entitled to the period. RC has used
      // both `cancel_reason` and `cancellation_reason` across versions.
      const reason = (e.cancel_reason ?? e.cancellation_reason ?? '').toUpperCase();
      if (reason === 'REFUNDED' || reason === 'CUSTOMER_SUPPORT') {
        return { type: 'RC_REFUND' };
      }
      return { type: 'RC_CANCELLATION', periodEnd };
    }
    case 'UNCANCELLATION':
      return { type: 'RC_UNCANCELLATION' };
    case 'EXPIRATION':
      return { type: 'RC_EXPIRATION' };
    case 'BILLING_ISSUE':
      return { type: 'RC_BILLING_ISSUE' };
    default:
      return null;
  }
}
