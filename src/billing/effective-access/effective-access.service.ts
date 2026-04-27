import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';
import {
  WorkspaceMember,
  WorkspaceMemberStatus,
} from '../../workspace/entities/workspace-member.entity';
import { UserTrial } from '../trials/entities/user-trial.entity';
import { PLANS } from '../plans.config';
import { BillingState, BillingPeriod } from '../state-machine/types';
import { BillingMeResponse } from './billing-me.types';
import { computeBannerPriority } from './banner-priority';

/**
 * Mobile / App Store product IDs for the four purchasable SKUs.
 * Kept in sync with the mobile CLAUDE.md "RevenueCat Products" block.
 * TODO: promote to a config-driven source once the web client ships
 * its own product ladder.
 */
const PRODUCTS = {
  pro: {
    monthly: 'io.subradar.mobile.pro.monthly',
    yearly: 'io.subradar.mobile.pro.yearly',
  },
  team: {
    monthly: 'io.subradar.mobile.team.monthly',
    yearly: 'io.subradar.mobile.team.yearly',
  },
} as const;

const DAY_MS = 86_400_000;
const PAID_STATES: ReadonlySet<BillingState> = new Set<BillingState>([
  'active',
  'cancel_at_period_end',
  'billing_issue',
]);

type EffectivePlan = 'free' | 'pro' | 'organization';
type EffectiveSource = BillingMeResponse['effective']['source'];

/**
 * EffectiveAccessResolver — the single authority that decides **what
 * access a user actually has right now** and produces the canonical
 * {@link BillingMeResponse} shape consumed by `GET /billing/me`.
 *
 * Callers (controllers, guards, features) MUST go through this
 * resolver instead of reading {@link User} flags directly. That's the
 * whole point of the refactor: keep precedence rules (own > team >
 * trial > grace > free, billing_issue wins banners, …) in ONE place.
 *
 * The implementation is pure TypeORM + in-process arithmetic. No
 * Redis caching yet — TODO: wrap .resolve() with a short-lived cache
 * (30–60 s) keyed by userId once the endpoint is wired up and we have
 * real traffic to measure hit rate against.
 */
@Injectable()
export class EffectiveAccessResolver {
  private readonly logger = new Logger(EffectiveAccessResolver.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(UserTrial)
    private readonly trials: Repository<UserTrial>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(Subscription)
    private readonly subs: Repository<Subscription>,
  ) {}

  async resolve(userId: string): Promise<BillingMeResponse> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const [trial, ownedWorkspace, membership, subsCount] = await Promise.all([
      this.trials.findOne({ where: { userId } }),
      this.workspaces.findOne({ where: { ownerId: userId } }),
      this.members.findOne({
        where: { userId, status: WorkspaceMemberStatus.ACTIVE },
        relations: ['workspace'],
      }),
      // Only ACTIVE / TRIAL subs count toward the plan limit. Mirrors what
      // SubscriptionsService.create checks before allowing inserts —
      // counting cancelled rows here would falsely flip subsLimitReached
      // and surface upgrade nags to users who have nothing live.
      this.subs.count({
        where: [
          { userId, status: 'ACTIVE' as any },
          { userId, status: 'TRIAL' as any },
        ],
      }),
    ]);

    const teamOwnerId = membership?.workspace?.ownerId ?? null;
    const teamOwnerActive = teamOwnerId
      ? await this.isTeamOwnerActive(teamOwnerId)
      : false;

    const now = new Date();
    const trialActive = !!trial && trial.endsAt > now;
    const billingSource = user.billingSource ?? null;
    const hasOwnPaidPlan =
      billingSource === 'revenuecat' || billingSource === 'lemon_squeezy';
    const isTeamOwner = !!ownedWorkspace;
    const isTeamMember = !!membership && !isTeamOwner;

    const billingStatus = user.billingStatus as BillingState;
    const billingPeriod = (user.billingPeriod as BillingPeriod | null) ?? null;

    // --- Effective plan resolution (precedence, top wins) -----------
    //   1. team owner on an active org plan  → organization / own
    //   2. team member whose owner is active → organization / team
    //   3. paid own plan (active/cap/issue)  → user.plan / own
    //   4. active trial                      → trial.plan / trial
    //   5. grace_pro                         → pro / grace_pro
    //   6. grace_team                        → organization / grace_team
    //   7. fallthrough                       → free / free
    let effectivePlan: EffectivePlan;
    let source: EffectiveSource;

    if (
      isTeamOwner &&
      (user.plan === 'organization' || user.plan === 'pro') &&
      billingStatus === 'active'
    ) {
      effectivePlan = 'organization';
      source = 'own';
    } else if (isTeamMember && teamOwnerActive) {
      effectivePlan = 'organization';
      source = 'team';
    } else if (hasOwnPaidPlan && PAID_STATES.has(billingStatus)) {
      effectivePlan = (user.plan as EffectivePlan) ?? 'free';
      source = 'own';
    } else if (
      hasOwnPaidPlan &&
      user.plan &&
      user.plan !== 'free' &&
      !PAID_STATES.has(billingStatus)
    ) {
      // Defensive self-heal: billingSource is set and `user.plan` reflects the
      // purchased tier, but `billingStatus` lags behind (e.g. sync-revenuecat
      // succeeded but a late/failed webhook left status as 'free', or the RC
      // webhook arrived before sync in Sandbox). Without this branch the user
      // appears as free right after a verified purchase, which is never
      // correct when we hold a valid RC entitlement. An actual lapse will be
      // corrected by the next RC webhook (BILLING_ISSUE/EXPIRATION).
      this.logger.warn(
        `EffectiveAccess self-heal: user ${userId} billingSource=${billingSource} plan=${user.plan} but billingStatus=${billingStatus}; treating as paid`,
      );
      effectivePlan = user.plan as EffectivePlan;
      source = 'own';
    } else if (trialActive) {
      effectivePlan = trial!.plan;
      source = 'trial';
    } else if (billingStatus === 'grace_pro') {
      effectivePlan = 'pro';
      source = 'grace_pro';
    } else if (billingStatus === 'grace_team') {
      effectivePlan = 'organization';
      source = 'grace_team';
    } else {
      effectivePlan = 'free';
      source = 'free';
    }

    const currentLimits = PLANS[effectivePlan];
    const subscriptionLimit = currentLimits.subscriptionLimit;
    const hiddenCount =
      subscriptionLimit !== null
        ? Math.max(0, subsCount - subscriptionLimit)
        : 0;

    const graceDaysLeft = user.gracePeriodEnd
      ? Math.max(
          0,
          Math.ceil((user.gracePeriodEnd.getTime() - now.getTime()) / DAY_MS),
        )
      : null;

    // nextPaymentDate is null once the user has cancelled — there is
    // literally no next charge. Otherwise mirror currentPeriodEnd.
    const nextPaymentDate = user.cancelAtPeriodEnd
      ? null
      : user.currentPeriodEnd;

    const banner = computeBannerPriority({
      state: billingStatus,
      plan: effectivePlan,
      billingPeriod,
      cancelAtPeriodEnd: user.cancelAtPeriodEnd,
      billingIssueAt: user.billingIssueAt,
      currentPeriodEnd: user.currentPeriodEnd,
      graceExpiresAt: user.gracePeriodEnd,
      graceReason: user.gracePeriodReason ?? null,
      hasOwnPaidPlan,
      isTeamMember,
      isTeamOwner,
      hiddenSubscriptionsCount: hiddenCount,
      hadProBefore: !!user.downgradedAt,
    });

    const workspaceId =
      ownedWorkspace?.id ?? membership?.workspaceId ?? null;

    // When self-heal kicks in (source='own' but billingStatus is 'free'),
    // surface 'active' so the client's state-driven UI (banners, CTA labels,
    // retry modals) doesn't treat a just-purchased user as free.
    const effectiveState: BillingState =
      source === 'own' && effectivePlan !== 'free' && !PAID_STATES.has(billingStatus)
        ? 'active'
        : billingStatus;

    return {
      effective: {
        plan: effectivePlan,
        source,
        state: effectiveState,
        billingPeriod,
      },
      ownership: {
        hasOwnPaidPlan,
        isTeamOwner,
        isTeamMember,
        teamOwnerId,
        workspaceId,
      },
      dates: {
        currentPeriodStart: user.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: user.currentPeriodEnd?.toISOString() ?? null,
        nextPaymentDate: nextPaymentDate?.toISOString() ?? null,
        graceExpiresAt: user.gracePeriodEnd?.toISOString() ?? null,
        graceDaysLeft,
        trialEndsAt: trialActive ? trial!.endsAt.toISOString() : null,
        billingIssueStartedAt: user.billingIssueAt?.toISOString() ?? null,
      },
      flags: {
        cancelAtPeriodEnd: user.cancelAtPeriodEnd,
        hasBillingIssue: billingStatus === 'billing_issue',
        trialEligible: !trial && !hasOwnPaidPlan && effectivePlan === 'free',
        shouldShowDoublePay:
          hasOwnPaidPlan && isTeamMember && !isTeamOwner,
        degradedMode: effectivePlan === 'free' && hiddenCount > 0,
        hiddenSubscriptionsCount: hiddenCount,
        graceReason: user.gracePeriodReason ?? null,
      },
      banner,
      limits: {
        subscriptions: { used: subsCount, limit: subscriptionLimit },
        aiRequests: {
          used: user.aiRequestsUsed ?? 0,
          limit: currentLimits.aiRequestsLimit,
          resetAt: startOfNextMonth(now).toISOString(),
        },
        canCreateOrg: currentLimits.canCreateOrg,
        canInvite: currentLimits.hasInvite,
      },
      actions: {
        canStartTrial:
          !trial && !hasOwnPaidPlan && effectivePlan === 'free',
        canCancel: hasOwnPaidPlan && !user.cancelAtPeriodEnd,
        canRestore: true,
        canUpgradeToYearly: hasOwnPaidPlan && billingPeriod === 'monthly',
        canInviteProFriend:
          currentLimits.hasInvite && !user.proInviteeEmail,
      },
      products: {
        pro: { ...PRODUCTS.pro },
        team: { ...PRODUCTS.team },
      },
      serverTime: now.toISOString(),
    };
  }

  private async isTeamOwnerActive(ownerId: string): Promise<boolean> {
    const owner = await this.users.findOne({ where: { id: ownerId } });
    if (!owner) return false;
    return PAID_STATES.has(owner.billingStatus as BillingState);
  }
}

/**
 * 1st day of next month, 00:00 local server time. Used as the
 * aiRequests.resetAt hint for the client. Kept as a top-level helper
 * so tests can cover it separately if needed.
 */
function startOfNextMonth(ref: Date): Date {
  return new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
}
