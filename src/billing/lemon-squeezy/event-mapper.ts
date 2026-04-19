import { BillingEvent } from '../state-machine/types';

/**
 * Known Lemon Squeezy variant ids → plan/period. Populated from both
 * env vars (if set — the canonical way in prod) and the legacy numeric
 * defaults we've been shipping since the first LS integration.
 *
 * The fallback hard-coded ids (`1377279`, `1377285`, `874616`, `874623`)
 * match the defaults used elsewhere in BillingService so webhook parsing
 * keeps working even when the env vars are not provided (dev / tests).
 */
export interface LSVariantEntry {
  plan: 'pro' | 'organization';
  period: 'monthly' | 'yearly';
}

/**
 * Build the variant → plan/period map from ConfigService / env. Exported
 * so BillingService can rebuild it on startup (when ConfigService is
 * available) AND the static map below can be used by unit tests that
 * don't boot the Nest container.
 */
export function buildVariantToPlanMap(env: NodeJS.ProcessEnv = process.env): Record<
  string,
  LSVariantEntry
> {
  const map: Record<string, LSVariantEntry> = {};

  const addIf = (id: string | undefined, entry: LSVariantEntry) => {
    if (id && id.trim()) map[id.trim()] = entry;
  };

  // Env-driven (preferred)
  addIf(env.LEMON_SQUEEZY_PRO_MONTHLY_VARIANT_ID, { plan: 'pro', period: 'monthly' });
  addIf(env.LEMON_SQUEEZY_PRO_YEARLY_VARIANT_ID, { plan: 'pro', period: 'yearly' });
  addIf(env.LEMON_SQUEEZY_TEAM_MONTHLY_VARIANT_ID, { plan: 'organization', period: 'monthly' });
  addIf(env.LEMON_SQUEEZY_TEAM_YEARLY_VARIANT_ID, { plan: 'organization', period: 'yearly' });
  // Legacy single-period vars that some deployments still set.
  addIf(env.LEMON_SQUEEZY_PRO_VARIANT_ID, { plan: 'pro', period: 'monthly' });
  addIf(env.LEMON_SQUEEZY_TEAM_VARIANT_ID, { plan: 'organization', period: 'monthly' });

  // Known production defaults — safety net for missing env config.
  // Keeping these in sync with billing.service.ts / billing.controller.ts.
  if (!map['874616']) map['874616'] = { plan: 'pro', period: 'monthly' };
  if (!map['874623']) map['874623'] = { plan: 'organization', period: 'monthly' };
  if (!map['1377279']) map['1377279'] = { plan: 'organization', period: 'monthly' };
  if (!map['1377285']) map['1377285'] = { plan: 'organization', period: 'yearly' };

  return map;
}

/**
 * Default export used by the event mapper. Consumers that need a
 * refreshable map (tests, dynamic config) should call `buildVariantToPlanMap`
 * with their own env.
 */
export const VARIANT_TO_PLAN: Record<string, LSVariantEntry> = buildVariantToPlanMap();

interface LSWebhookData {
  id?: string;
  attributes?: {
    variant_id?: string | number;
    variant_name?: string;
    status?: string;
    user_email?: string;
    customer_id?: string | number;
    renews_at?: string | null;
    ends_at?: string | null;
    updated_at?: string;
  };
}

/**
 * Translate a Lemon Squeezy webhook event into a billing state-machine
 * event.
 *
 * `name` is `body.meta.event_name` (e.g. `subscription_created`,
 * `subscription_updated`, `subscription_cancelled`). Returns `null` for
 * events we deliberately don't transition on (`order_created`, refunds,
 * etc.) — the caller logs-and-skips.
 *
 * Period detection prefers the variant mapping (explicit config) over
 * the `variant_name` heuristic.
 */
export function mapLSEventToBillingEvent(
  name: string,
  data: LSWebhookData,
  variantMap: Record<string, LSVariantEntry> = VARIANT_TO_PLAN,
): BillingEvent | null {
  const variantId = String(data?.attributes?.variant_id ?? '');
  const variantName = data?.attributes?.variant_name ?? '';
  const mapped = variantMap[variantId];
  const plan = mapped?.plan;
  const period: 'monthly' | 'yearly' =
    mapped?.period ?? (/yearly|annual/i.test(variantName) ? 'yearly' : 'monthly');

  const rawEnd = data?.attributes?.renews_at ?? data?.attributes?.ends_at;
  const periodEnd = rawEnd ? new Date(rawEnd) : new Date();

  switch (name) {
    case 'subscription_created':
      return plan
        ? { type: 'LS_SUBSCRIPTION_CREATED', plan, period, periodEnd }
        : null;
    case 'subscription_updated': {
      if (!plan) return null;
      // Status `cancelled` / `expired` from LS arrive as subscription_updated
      // with an end-of-life attribute — treat that as a cancellation.
      const status = String(data?.attributes?.status ?? '').toLowerCase();
      if (status === 'cancelled' || status === 'expired') {
        return { type: 'LS_SUBSCRIPTION_CANCELLED' };
      }
      return { type: 'LS_SUBSCRIPTION_UPDATED', plan, period, periodEnd };
    }
    case 'subscription_cancelled':
    case 'subscription_expired':
      return { type: 'LS_SUBSCRIPTION_CANCELLED' };
    default:
      return null;
  }
}
