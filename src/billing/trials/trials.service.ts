import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserTrial, TrialSource, TrialPlan } from './entities/user-trial.entity';
import { User } from '../../users/entities/user.entity';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';

/** Standard trial window — currently 7 days, matches RC intro offer. */
const TRIAL_DURATION_DAYS = 7;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Activates and reports per-user trial state.
 *
 * Invariants:
 *   1. One trial per user — enforced by UNIQUE(user_id) at DB level and by
 *      a pessimistic_write lock on the row inside this transaction. The
 *      lock guards against two concurrent activations racing past the
 *      existence check before either has committed.
 *   2. Backend-source trials are only granted to users currently on
 *      `free` — we don't downgrade a paying user into a trial. RC intro
 *      offers bypass this check because they're driven by store state,
 *      not our plan field.
 *   3. Audit + outbox writes happen inside the same transaction as the
 *      trial row. If any of them fails, we roll the whole activation
 *      back — preferable to a half-applied state where an Amplitude
 *      event fires for a trial that doesn't exist.
 */
@Injectable()
export class TrialsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(UserTrial)
    private readonly trialRepo: Repository<UserTrial>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Grant a user their (one) trial. Throws ConflictException if a trial
   * already exists for this user, BadRequestException if the user is
   * missing or (for `backend` source) already on a paid plan.
   */
  async activate(
    userId: string,
    source: TrialSource,
    plan: TrialPlan,
    originalTxId?: string,
  ): Promise<UserTrial> {
    return this.ds.transaction(async (m) => {
      // Pessimistic-write lock on the (possibly missing) trial row. If a
      // concurrent transaction is mid-activation, we block until it
      // commits/rolls back and then see its result here.
      const existing = await m.findOne(UserTrial, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) throw new ConflictException('Trial already used');

      const user = await m.findOne(User, { where: { id: userId } });
      if (!user) throw new BadRequestException('User not found');
      if (source === 'backend' && user.plan !== 'free') {
        throw new BadRequestException('Already on paid plan');
      }

      const now = new Date();
      const trial = m.create(UserTrial, {
        userId,
        source,
        plan,
        startedAt: now,
        endsAt: addDays(now, TRIAL_DURATION_DAYS),
        consumed: true,
        originalTransactionId: originalTxId ?? null,
      });
      const saved = await m.save(trial);

      await this.audit.log({
        userId,
        action: 'billing.trial_activated',
        resourceType: 'user_trial',
        resourceId: saved.id,
        metadata: { source, plan },
      });
      // Participate in the same tx — if the outer transaction rolls back,
      // the outbox row vanishes with it and Amplitude never hears about
      // a trial that didn't actually happen.
      await this.outbox.enqueue(
        'amplitude.track',
        {
          event: 'billing.trial_started',
          userId,
          properties: { source, plan },
        },
        m,
      );
      return saved;
    });
  }

  /** Returns the user's trial row if any, else null. Read-only. */
  async status(userId: string): Promise<UserTrial | null> {
    return this.trialRepo.findOne({ where: { userId } });
  }
}
