import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../common/audit/audit.service';
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
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async read(userId: string): Promise<UserBillingSnapshot> {
    const u = await this.userRepo.findOne({ where: { id: userId } });
    if (!u) throw new Error(`UserBillingRepository.read: user ${userId} not found`);
    return this.snapshotFromUser(u);
  }

  async applyTransition(
    userId: string,
    event: BillingEvent,
    opts: { actor: BillingActor; manager?: EntityManager },
  ): Promise<TransitionResult> {
    const run = async (m: EntityManager): Promise<TransitionResult> => {
      const user = await m.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new Error(
          `UserBillingRepository.applyTransition: user ${userId} not found`,
        );
      }
      const current = this.snapshotFromUser(user);

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
      };
      await m.update(User, userId, updates);

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

    if (opts.manager) return run(opts.manager);
    return this.dataSource.transaction(run);
  }

  private snapshotFromUser(u: User): UserBillingSnapshot {
    return {
      userId: u.id,
      plan: (u.plan as Plan) ?? 'free',
      state: (u.billingStatus as BillingState) ?? 'free',
      billingSource: (u.billingSource as BillingSource) ?? null,
      billingPeriod: (u.billingPeriod as BillingPeriod | null) ?? null,
      currentPeriodStart: u.currentPeriodStart ?? null,
      currentPeriodEnd: u.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: !!u.cancelAtPeriodEnd,
      graceExpiresAt: u.gracePeriodEnd ?? null,
      graceReason: (u.gracePeriodReason as GraceReason) ?? null,
      billingIssueAt: u.billingIssueAt ?? null,
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
}
