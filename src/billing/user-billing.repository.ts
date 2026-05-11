import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UserBilling } from './entities/user-billing.entity';
import { BillingDeadLetter } from './entities/billing-dead-letter.entity';
import { AuditService } from '../common/audit/audit.service';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { EffectiveAccessResolver } from './effective-access/effective-access.service';
import { transition } from './state-machine/transitions';
import {
  BillingEvent,
  BillingPeriod,
  BillingSource,
  BillingState,
  GraceReason,
  InvalidTransitionError,
  Plan,
  UserBillingSnapshot,
} from './state-machine/types';

export type BillingActor =
  | 'webhook_rc'
  | 'webhook_ls'
  | 'user_cancel'
  | 'sync'
  | 'reconcile'
  | 'cron_trial'
  | 'cron_grace'
  | 'admin_grant';

export type TransitionResult =
  | { applied: true; from: BillingState; to: BillingState; snapshot: UserBillingSnapshot }
  | {
      applied: false;
      reason: 'invalid_transition' | 'idempotent_noop';
      from: BillingState;
      eventType: string;
    };

/**
 * Single source of truth for the 10 billing fields on the `users` row:
 * plan, billingStatus, billingSource, billingPeriod, currentPeriodStart,
 * currentPeriodEnd, cancelAtPeriodEnd, gracePeriodEnd, gracePeriodReason,
 * billingIssueAt.
 *
 * Every mutation funnels through `applyTransition`, which runs the pure
 * state-machine reducer and writes both the snapshot and an audit row in
 * one transaction. Direct writes via `usersService.update` are forbidden:
 * the whitelist no longer accepts these keys after Phase 1.
 */
@Injectable()
export class UserBillingRepository {
  private readonly logger = new Logger(UserBillingRepository.name);

  constructor(
    @InjectRepository(UserBilling)
    private readonly billingRepo: Repository<UserBilling>,
    @InjectRepository(BillingDeadLetter)
    private readonly dlqRepo: Repository<BillingDeadLetter>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly tg: TelegramAlertService,
    private readonly effective: EffectiveAccessResolver,
  ) {}

  async read(userId: string): Promise<UserBillingSnapshot> {
    const row = await this.billingRepo.findOne({ where: { userId } });
    if (!row) {
      throw new Error(
        `UserBillingRepository.read: user_billing row missing for ${userId}`,
      );
    }
    return this.snapshotFromRow(row);
  }

  async applyTransition(
    userId: string,
    event: BillingEvent,
    opts: { actor: BillingActor; manager?: EntityManager },
  ): Promise<TransitionResult> {
    const run = async (m: EntityManager): Promise<TransitionResult> => {
      const row = await m.findOne(UserBilling, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) {
        throw new Error(
          `UserBillingRepository.applyTransition: user_billing row missing for ${userId}`,
        );
      }
      const current = this.snapshotFromRow(row);

      let next: UserBillingSnapshot;
      try {
        next = transition(current, event);
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          await this.audit
            .log({
              userId,
              action: 'billing.transition.invalid',
              resourceType: 'user',
              resourceId: userId,
              metadata: {
                from: current.state,
                eventType: event.type,
                actor: opts.actor,
                error: err.message,
              },
            })
            .catch(() => undefined);
          // Persist into the DLQ so an operator can find / replay it
          // later. Best-effort — DLQ insert MUST NOT fail the original
          // request (the webhook still wants to be marked processed so
          // RC stops retrying it).
          await this.recordDeadLetter(
            userId,
            current.state,
            event,
            opts.actor,
            err.message,
          );
          return {
            applied: false,
            reason: 'invalid_transition',
            from: current.state,
            eventType: event.type,
          };
        }
        throw err;
      }

      if (this.snapshotsEqual(current, next)) {
        return {
          applied: false,
          reason: 'idempotent_noop',
          from: current.state,
          eventType: event.type,
        };
      }

      const updates = {
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
        refundedAt: next.refundedAt,
      };
      await m.update(UserBilling, { userId }, updates);

      await this.audit.log({
        userId,
        action: 'billing.transition',
        resourceType: 'user',
        resourceId: userId,
        metadata: {
          from: current.state,
          to: next.state,
          eventType: event.type,
          actor: opts.actor,
          payload: event,
        },
      });

      return { applied: true, from: current.state, to: next.state, snapshot: next };
    };

    const result = opts.manager
      ? await run(opts.manager)
      : await this.dataSource.transaction(run);
    // Invalidate the EffectiveAccess cache for this user so the next
    // /billing/me reflects the transition immediately. We do this OUT
    // OF the transaction so a rollback of the audit row doesn't leave
    // a stale cache (the row never moved either).
    if (result.applied) {
      this.effective.invalidate(userId);
    }
    return result;
  }

  private snapshotFromRow(row: UserBilling): UserBillingSnapshot {
    return {
      userId: row.userId,
      plan: (row.plan as Plan) ?? 'free',
      state: (row.billingStatus as BillingState) ?? 'free',
      billingSource: (row.billingSource as BillingSource) ?? null,
      billingPeriod: (row.billingPeriod as BillingPeriod | null) ?? null,
      currentPeriodStart: row.currentPeriodStart ?? null,
      currentPeriodEnd: row.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: !!row.cancelAtPeriodEnd,
      graceExpiresAt: row.gracePeriodEnd ?? null,
      graceReason: (row.gracePeriodReason as GraceReason) ?? null,
      billingIssueAt: row.billingIssueAt ?? null,
      refundedAt: row.refundedAt ?? null,
    };
  }

  private snapshotsEqual(a: UserBillingSnapshot, b: UserBillingSnapshot): boolean {
    const fields: (keyof UserBillingSnapshot)[] = [
      'plan',
      'state',
      'billingSource',
      'billingPeriod',
      'currentPeriodStart',
      'currentPeriodEnd',
      'cancelAtPeriodEnd',
      'graceExpiresAt',
      'graceReason',
      'billingIssueAt',
      'refundedAt',
    ];
    for (const f of fields) {
      const av = a[f];
      const bv = b[f];
      if (av instanceof Date && bv instanceof Date) {
        if (av.getTime() !== bv.getTime()) return false;
      } else if (av !== bv) {
        return false;
      }
    }
    return true;
  }

  /**
   * Persist an invalid-transition row to the dead-letter queue and fire
   * a Telegram alert. Both calls are best-effort: a DB or Telegram
   * outage MUST NOT mask the original transition failure to the caller
   * (which would cause webhook retry loops or surprise-blocking the
   * mobile cancel flow).
   */
  private async recordDeadLetter(
    userId: string,
    fromState: BillingState,
    event: BillingEvent,
    actor: BillingActor,
    error: string,
  ): Promise<void> {
    try {
      await this.dlqRepo.insert({
        userId,
        fromState,
        eventType: event.type,
        actor,
        eventPayload: event as any,
        error,
        resolved: false,
      });
    } catch (e: any) {
      this.logger.warn(
        `DLQ insert failed for user ${userId} ${event.type}: ${e?.message ?? e}`,
      );
    }
    // Telegram alert — keyed by user+event so two retries of the same
    // event don't spam the channel within 10 minutes (the alert
    // service already dedupes).
    void this.tg
      .send(
        `⚠️ Billing DLQ: user=${userId} event=${event.type} from=${fromState} actor=${actor}\nReason: ${error}`,
        `billing-dlq:${userId}:${event.type}`,
      )
      .catch(() => undefined);
  }
}
