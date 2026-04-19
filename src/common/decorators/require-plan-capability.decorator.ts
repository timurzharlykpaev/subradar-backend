import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key used by {@link PlanGuard} to read the required plan
 * capability off a route handler. Exported so tests and tooling can
 * reference the exact same string.
 */
export const PLAN_CAP_KEY = 'plan_capability';

/**
 * A capability gate that a route can require before allowing the user
 * through. Mirrors the flags surfaced by
 * {@link EffectiveAccessResolver} on `billing/me.limits`.
 *
 * - `canCreateOrg`   — user can create / own an Organization workspace (Team plan).
 * - `canInvite`      — user can invite team members (Pro or Organization).
 * - `unlimitedSubs`  — user has the unlimited subscriptions entitlement
 *                     (Pro+). Reserved for future use.
 */
export type PlanCapability = 'canCreateOrg' | 'canInvite' | 'unlimitedSubs';

/**
 * Decorator that declares a required plan capability on a controller
 * handler. When paired with {@link PlanGuard} the request is rejected
 * with `403 Forbidden` unless the authenticated user's effective
 * access satisfies the capability.
 *
 * Example:
 * ```ts
 * @Post()
 * @UseGuards(JwtAuthGuard, PlanGuard)
 * @RequirePlanCapability('canCreateOrg')
 * create(...) { ... }
 * ```
 */
export const RequirePlanCapability = (cap: PlanCapability) =>
  SetMetadata(PLAN_CAP_KEY, cap);
