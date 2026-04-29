import { Injectable, Logger } from '@nestjs/common';
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
} from '../state-machine';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';

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
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
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
          (b."currentPeriodEnd" IS NOT NULL
           AND b."currentPeriodEnd" < now() - interval '10 minutes'
           AND b."billingStatus" NOT IN ('grace_pro','grace_team','free'))
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

    // The User entity has `billingSource: string` without the `| null` side
    // even though the column is nullable; cast to `any` to match the state
    // machine's tri-state type without touching the entity schema.
    await this.users.update(user.id, {
      plan: next.plan,
      billingStatus: next.state,
      billingSource: next.billingSource as any,
      billingPeriod: next.billingPeriod,
      currentPeriodStart: next.currentPeriodStart,
      currentPeriodEnd: next.currentPeriodEnd,
      cancelAtPeriodEnd: next.cancelAtPeriodEnd,
      gracePeriodEnd: next.graceExpiresAt,
      gracePeriodReason: next.graceReason,
      billingIssueAt: next.billingIssueAt,
    });

    await this.audit.log({
      userId: user.id,
      action: 'billing.reconciliation_fix',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { from: current.state, to: next.state },
    });

    await this.outbox.enqueue('amplitude.track', {
      event: 'billing.reconciliation_mismatch',
      userId: user.id,
      properties: { from: current.state, to: next.state },
    });

    await this.outbox.enqueue('telegram.alert', {
      text: `[reconciliation] user=${user.id.slice(0, 8)} ${current.state} → ${next.state}`,
    });

    return true;
  }
}
