import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { RevenueCatClient } from '../revenuecat/rc-client.service';
import {
  reconcile,
  UserBillingSnapshot,
  BillingPeriod,
  BillingSource,
  BillingState,
  GraceReason,
  Plan,
  inferEventFromRcSnapshot,
} from '../state-machine';
import { OutboxService } from '../outbox/outbox.service';
import { UserBillingRepository } from '../user-billing.repository';

/**
 * Reconciles the user's billing state with RevenueCat's source of truth.
 *
 * Hourly cron (see ReconciliationCron) pulls a bounded list of "suspicious"
 * users — either their local `currentPeriodEnd` is in the past but status is
 * still active-like, or a recent RC webhook errored out — then for each one
 * fetches the authoritative RC subscriber snapshot and runs it through the
 * same state-machine `reconcile(...)` function the webhooks use. If the
 * result differs we persist, write audit + outbox events; otherwise no-op.
 *
 * SQL note: `users` is camelCase ("billingSource"/"billingStatus"/...) but
 * `webhook_events` is snake_case (`user_id`, `processed_at`, `error`) —
 * see AlterWebhookEventsForReconciliation migration for the reasoning.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly rc: RevenueCatClient,
    private readonly outbox: OutboxService,
    @Inject(forwardRef(() => UserBillingRepository))
    private readonly userBilling: UserBillingRepository,
  ) {}

  /**
   * Candidates for reconciliation — RC-source users whose state looks
   * stale relative to period end, plus users whose recent webhook failed.
   * Ordered by `currentPeriodEnd` asc so the oldest drift gets fixed first.
   */
  async findSuspicious(limit: number): Promise<User[]> {
    // Phase 2 moved billing fields into `user_billing` — JOIN it in.
    // We still SELECT `u.*` so callers get a fully-populated User entity;
    // the billing snapshot fields are read via the eager OneToOne relation
    // when the entity reaches `snapshotFromUser`.
    return this.users.query(
      `
      SELECT u.* FROM users u
      JOIN user_billing b ON b."userId" = u.id
      WHERE b."billingSource" = 'revenuecat'
        AND (
          -- (a) Active/cancel/billing_issue rows whose period end is
          -- already in the past — the RC webhook (EXPIRATION /
          -- RENEWAL / CANCELLATION) was lost or hasn't arrived yet.
          (b."currentPeriodEnd" IS NOT NULL
           AND b."currentPeriodEnd" < now() - interval '10 minutes'
           AND b."billingStatus" NOT IN ('grace_pro','grace_team','free'))
          -- (b) Rows stuck in grace whose grace window is still open
          -- but RC may have flipped back to active (late RENEWAL).
          -- Without this branch the cron skipped grace forever and
          -- users with a working auto-renewing sub kept the "Pro
          -- expired" banner until grace lapsed and they bought again.
          -- Bounded by gracePeriodEnd so we don't re-check users whose
          -- grace already ended (those drop to free via the cron's
          -- own GRACE_EXPIRED path).
          OR (b."billingStatus" IN ('grace_pro','grace_team')
              AND b."gracePeriodEnd" IS NOT NULL
              AND b."gracePeriodEnd" > now())
          -- (c) Anyone whose recent webhook errored — likely got
          -- partially applied and needs a fresh look against RC.
          OR u.id IN (
            SELECT DISTINCT user_id FROM webhook_events
            WHERE provider = 'revenuecat'
              AND processed_at > now() - interval '24 hours'
              AND error IS NOT NULL
              AND user_id IS NOT NULL
          )
        )
      ORDER BY b."currentPeriodEnd" ASC NULLS LAST
      LIMIT $1
      `,
      [limit],
    );
  }

  /**
   * Translate the persisted `User` row into the state-machine snapshot
   * shape. Kept as a pure mapper (no IO) so tests can drive `reconcile`
   * directly without hitting the repo.
   */
  snapshotFromUser(u: User): UserBillingSnapshot {
    return {
      userId: u.id,
      plan: u.plan as Plan,
      state: u.billingStatus as BillingState,
      billingSource: u.billingSource as BillingSource,
      billingPeriod: (u.billingPeriod as BillingPeriod | null) ?? null,
      currentPeriodStart: u.currentPeriodStart,
      currentPeriodEnd: u.currentPeriodEnd,
      cancelAtPeriodEnd: u.cancelAtPeriodEnd,
      graceExpiresAt: u.gracePeriodEnd,
      graceReason: (u.gracePeriodReason as GraceReason) ?? null,
      billingIssueAt: u.billingIssueAt,
      refundedAt: u.refundedAt,
    };
  }

  /**
   * Reconcile a single user. Returns whether a change was (or would have
   * been, in dry-run mode) applied — the cron uses this to report the
   * count of drifted users.
   *
   * In `dryRun=true` we skip the DB write, audit, and outbox enqueue — the
   * only side effect is a log line, so operators can safely flip the flag
   * on in production before enabling real writes.
   */
  async reconcileOne(user: User, dryRun: boolean): Promise<boolean> {
    const rcSub = await this.rc.getSubscriber(user.id);
    const current = this.snapshotFromUser(user);
    const next = reconcile(current, rcSub);
    if (JSON.stringify(current) === JSON.stringify(next)) return false;

    if (dryRun) {
      this.logger.log(
        `[DRY_RUN] Would reconcile user ${user.id}: ${current.state} → ${next.state}`,
      );
      return true;
    }

    // Previously this method did a raw `users.update()` against the
    // `users` table — wrong on two counts after Phase 2:
    //   1. billing columns now live in `user_billing`; writing the
    //      legacy columns either no-ops or drifts the two tables.
    //   2. it bypassed `applyTransition`, so the in-process
    //      EffectiveAccess TTL cache stayed stale until the row's 60s
    //      timer expired — users on this pod kept seeing the wrong
    //      plan after a reconcile.
    //
    // Route through the same state-machine pipeline as webhooks: infer
    // the event from the RC snapshot + current state, then run
    // applyTransition which writes user_billing atomically + audits +
    // invalidates the effective-access cache. We still keep the
    // pre-computed `next` snapshot for the analytics + telegram
    // payload so observability stays unchanged.
    const event = inferEventFromRcSnapshot(rcSub, current);
    if (!event) {
      this.logger.warn(
        `[reconciliation] user ${user.id.slice(0, 8)}: snapshot drift detected (${current.state} → ${next.state}) but no event mapping — manual review required`,
      );
      await this.outbox.enqueue('telegram.alert', {
        text: `[reconciliation][unmapped] user=${user.id.slice(0, 8)} ${current.state} → ${next.state} — no state-machine event from RC snapshot`,
      });
      return false;
    }

    const result = await this.userBilling.applyTransition(user.id, event, {
      actor: 'reconcile',
    });

    if (!result.applied) {
      // Either invalid_transition (logged to DLQ by applyTransition)
      // or idempotent_noop (state machine considered them equal even
      // though our JSON-equality check above didn't). Either way the
      // user isn't stuck — return false so the cron counter only
      // increments on real fixes.
      this.logger.log(
        `[reconciliation] user ${user.id.slice(0, 8)}: applyTransition no-op (${result.reason})`,
      );
      return false;
    }

    await this.outbox.enqueue('amplitude.track', {
      event: 'billing.reconciliation_mismatch',
      userId: user.id,
      properties: { from: current.state, to: next.state, eventType: event.type },
    });

    await this.outbox.enqueue('telegram.alert', {
      text: `[reconciliation] user=${user.id.slice(0, 8)} ${current.state} → ${next.state} (via ${event.type})`,
    });

    return true;
  }
}
