import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import {
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  isBefore,
  lastDayOfMonth,
  setDate,
} from 'date-fns';
import { REDIS_CLIENT } from '../common/redis.module';
import { TelegramAlertService } from '../common/telegram-alert.service';
import { runCronHandler } from '../common/cron/run-cron-handler';
import {
  Subscription,
  BillingPeriod,
  SubscriptionStatus,
} from './entities/subscription.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { FilterSubscriptionsDto } from './dto/filter-subscriptions.dto';
import { UsersService } from '../users/users.service';
import { PLANS } from '../billing/plans.config';
import { BillingService } from '../billing/billing.service';
import { AnalysisService } from '../analysis/analysis.service';
import Decimal from 'decimal.js';
import { FxService } from '../fx/fx.service';
import { CatalogPlan } from '../catalog/entities/catalog-plan.entity';

function computeNextPaymentDate(
  startDate: Date,
  billingPeriod: BillingPeriod,
  billingDay?: number | null,
): Date | null {
  if (
    billingPeriod === BillingPeriod.LIFETIME ||
    billingPeriod === BillingPeriod.ONE_TIME
  ) {
    return null;
  }

  const now = new Date();
  let next = new Date(startDate);

  const clampBillingDay = (d: Date): Date => {
    if (!billingDay || billingPeriod !== BillingPeriod.MONTHLY) return d;
    const lastDay = lastDayOfMonth(d).getDate();
    return setDate(d, Math.min(billingDay, lastDay));
  };

  const advance = (d: Date): Date => {
    switch (billingPeriod) {
      case BillingPeriod.WEEKLY:
        return addWeeks(d, 1);
      case BillingPeriod.MONTHLY:
        return addMonths(d, 1);
      case BillingPeriod.QUARTERLY:
        return addQuarters(d, 1);
      case BillingPeriod.YEARLY:
        return addYears(d, 1);
      default:
        return addMonths(d, 1);
    }
  };

  // Apply billingDay first — otherwise a startDate later in the same month
  // (e.g. Apr 20) + a smaller billingDay (e.g. 5) would produce a past date.
  next = clampBillingDay(next);

  // Walk forward until we land strictly in the future. Re-clamp after each
  // step in case addMonths crossed a 28/30/31-day edge.
  while (!isBefore(now, next)) {
    next = clampBillingDay(advance(next));
  }

  return next;
}

// Allowed subscription status transitions. CANCELLED is terminal — restore is handled explicitly.
const VALID_STATUS_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  [SubscriptionStatus.ACTIVE]: [
    SubscriptionStatus.PAUSED,
    SubscriptionStatus.CANCELLED,
  ],
  [SubscriptionStatus.TRIAL]: [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELLED,
  ],
  [SubscriptionStatus.PAUSED]: [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELLED,
  ],
  [SubscriptionStatus.CANCELLED]: [],
};

@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);
  constructor(
    @InjectRepository(Subscription)
    private readonly repo: Repository<Subscription>,
    @InjectRepository(CatalogPlan)
    private readonly catalogPlanRepo: Repository<CatalogPlan>,
    private readonly usersService: UsersService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(forwardRef(() => AnalysisService))
    private readonly analysisService: AnalysisService,
    private readonly fx: FxService,
    private readonly dataSource: DataSource,
    private readonly tg: TelegramAlertService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
  ) {}

  /**
   * Stable 32-bit hash of userId for postgres advisory locks (serialize subscription
   * creation per-user to prevent limit bypass via concurrent requests).
   */
  private hashUserIdForLock(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
    }
    return hash;
  }

  async onModuleInit() {
    await this.recalculateNextPaymentDates();
  }

  private async invalidateAnalyticsCache(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      const patterns = [`ai:*${userId}*`, `analytics:*${userId}*`];
      for (const pattern of patterns) {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            100,
          );
          cursor = nextCursor;
          if (keys.length > 0) {
            await this.redis.del(...keys);
          }
        } while (cursor !== '0');
      }
    } catch (err: any) {
      // Redis unavailable shouldn't block writes — log & continue. Including the
      // error message helps trace scan/del failures vs full connection loss.
      this.logger.debug(
        `Failed to invalidate analytics cache for user ${userId}: ${err?.message}`,
      );
    }
  }

  async create(
    userId: string,
    dto: CreateSubscriptionDto,
  ): Promise<Subscription> {
    const user = await this.usersService.findById(userId);
    // Use effective plan (resolves team membership, trial, grace) instead of
    // raw user.plan — a team member with user.plan='free' is effectively
    // 'organization' through team access and should get unlimited subs.
    const effective = await this.billingService.getEffectiveAccess(user);
    const planConfig = PLANS[effective.plan] ?? PLANS.free;

    let catalogServiceId: string | null = null;
    let catalogPlanId: string | null = null;
    let resolvedCurrency = dto.currency ?? user.displayCurrency ?? 'USD';

    if (dto.catalogPlanId) {
      const plan = await this.catalogPlanRepo.findOne({
        where: { id: dto.catalogPlanId },
      });
      if (plan) {
        catalogPlanId = plan.id;
        catalogServiceId = plan.serviceId;
        if (!dto.currency) resolvedCurrency = plan.currency;
      }
    }

    // Serialize subscription creation per-user with pg advisory lock inside a
    // transaction — prevents race condition where concurrent requests bypass
    // subscriptionLimit (both read count < limit before either writes).
    const lockKey = this.hashUserIdForLock(userId);
    const saved = await this.dataSource.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      if (planConfig.subscriptionLimit !== null) {
        const activeCount = await em.count(Subscription, {
          where: [
            { userId, status: SubscriptionStatus.ACTIVE },
            { userId, status: SubscriptionStatus.TRIAL },
          ],
        });
        if (activeCount >= planConfig.subscriptionLimit) {
          // Every plan now has a numeric cap (Free: 3, Pro: 500, Team: 2000).
          // Suggest the next tier rather than hard-coding "Free".
          const effectivePlan = effective.plan;
          const upgradeHint = effectivePlan === 'free'
            ? 'Upgrade to Pro for up to 500 subscriptions.'
            : effectivePlan === 'pro'
              ? 'Upgrade to Team/Organization for up to 2000 subscriptions.'
              : 'Contact support to raise the limit.';
          throw new ForbiddenException(
            `Subscription limit reached (${planConfig.subscriptionLimit} on ${effectivePlan} plan). ${upgradeHint}`,
          );
        }
      }

      const sub = em.create(Subscription, {
        ...dto,
        currency: resolvedCurrency,
        originalCurrency: resolvedCurrency,
        catalogServiceId,
        catalogPlanId,
        userId,
      });

      if (sub.startDate && sub.billingPeriod) {
        const next = computeNextPaymentDate(
          new Date(sub.startDate),
          sub.billingPeriod,
          sub.billingDay,
        );
        sub.nextPaymentDate = next as Date;
      }

      return em.save(Subscription, sub);
    });

    // Post-commit side effects — never throw from here (the subscription is
    // already persisted). Cache + analysis failures are best-effort and should
    // surface in logs only.
    this.invalidateAnalyticsCache(userId).catch((err) =>
      this.logger.warn(
        `invalidateAnalyticsCache failed for user ${userId} (sub ${saved.id}): ${err?.message}`,
      ),
    );
    this.analysisService.onSubscriptionChange(userId).catch((err) =>
      this.logger.warn(
        `Analysis trigger failed for user ${userId} (sub ${saved.id}): ${err?.message}`,
      ),
    );
    return saved;
  }

  async countActive(userId: string): Promise<number> {
    return this.repo.count({
      where: [
        { userId, status: SubscriptionStatus.ACTIVE },
        { userId, status: SubscriptionStatus.TRIAL },
      ],
    });
  }

  async findAll(userId: string, filters?: FilterSubscriptionsDto): Promise<Subscription[]> {
    const qb = this.repo
      .createQueryBuilder('sub')
      .leftJoinAndSelect('sub.paymentCard', 'paymentCard')
      .where('sub.userId = :userId', { userId });

    if (filters?.status) {
      qb.andWhere('sub.status = :status', { status: filters.status });
    }

    if (filters?.category) {
      qb.andWhere('sub.category = :category', { category: filters.category });
    }

    if (filters?.search) {
      qb.andWhere('sub.name ILIKE :search', { search: `%${filters.search}%` });
    }

    const ALLOWED_SORT_FIELDS = ['name', 'amount', 'createdAt', 'nextPaymentDate', 'status'];
    const rawSortField = filters?.sort || 'createdAt';
    const safeSortField = ALLOWED_SORT_FIELDS.includes(rawSortField) ? rawSortField : 'createdAt';
    const sortOrder = filters?.order || 'DESC';
    qb.orderBy(`sub.${safeSortField}`, sortOrder);

    // Optional pagination (backward compatible — no limit = all results)
    if (filters?.limit) {
      qb.take(filters.limit);
      if (filters?.offset) qb.skip(filters.offset);
    }

    return qb.getMany();
  }

  async findAllWithDisplay(
    userId: string,
    displayCurrencyOverride: string | null | undefined,
    filters?: FilterSubscriptionsDto,
  ): Promise<Array<Subscription & {
    displayAmount: string;
    displayCurrency: string;
    fxRate: number;
    fxFetchedAt: Date;
  }>> {
    let displayCurrency = (displayCurrencyOverride ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(displayCurrency)) {
      const user = await this.usersService.findById(userId);
      displayCurrency = (user?.displayCurrency || 'USD').toUpperCase();
    }

    // Server-side feature gating. When the client opts in via
    // `gateByPlan=true`, cap the response at the user's plan limit
    // (oldest ACTIVE/TRIAL subs by createdAt). Without this, a Free user
    // who saved 5 subs and downgraded could still pull the full list via
    // a direct API call — UI obfuscation is bypassable, server cap isn't.
    //
    // Bug fix (2026-05): the cap only applies to ACTIVE/TRIAL — those are
    // the slots the plan limit actually controls. Previously CANCELLED /
    // PAUSED subs were also stripped, so the moment a user cancelled a
    // subscription it disappeared from the list entirely instead of
    // showing up under the "Cancelled" filter as expected. Terminal /
    // paused states don't count toward the limit, so we always pass them
    // through.
    let allowedIds: Set<string> | null = null;
    if (filters?.gateByPlan) {
      const user = await this.usersService.findById(userId);
      const effective = await this.billingService.getEffectiveAccess(user);
      const planConfig = PLANS[effective.plan] ?? PLANS.free;
      if (planConfig.subscriptionLimit !== null) {
        const [oldestActive, nonActive] = await Promise.all([
          this.repo.find({
            where: [
              { userId, status: SubscriptionStatus.ACTIVE },
              { userId, status: SubscriptionStatus.TRIAL },
            ],
            order: { createdAt: 'ASC' },
            take: planConfig.subscriptionLimit,
            select: ['id'],
          }),
          this.repo.find({
            where: [
              { userId, status: SubscriptionStatus.CANCELLED },
              { userId, status: SubscriptionStatus.PAUSED },
            ],
            select: ['id'],
          }),
        ]);
        allowedIds = new Set([
          ...oldestActive.map((s) => s.id),
          ...nonActive.map((s) => s.id),
        ]);
      }
    }

    const [subs, fx] = await Promise.all([
      this.findAll(userId, filters),
      this.fx.getRates(),
    ]);
    const filteredSubs = allowedIds
      ? subs.filter((s) => allowedIds!.has(s.id))
      : subs;
    return filteredSubs.map((sub) => {
      // Use the SUB'S CURRENT currency as the source for FX conversion,
      // not `originalCurrency`. The two used to drift after a user edited
      // a subscription and changed its currency: `currency` updated, but
      // `originalCurrency` stayed at the create-time value. The converter
      // then ran amount(in NEW currency) × rate(OLD currency → display),
      // producing nonsense numbers. `originalCurrency` is now purely a
      // historical record — never feeds display.
      const sourceCurrency = sub.currency || sub.originalCurrency || displayCurrency;
      let displayAmountStr: string;
      let fxRate: number;
      try {
        const amount = new Decimal(sub.amount as unknown as string);
        const converted = this.fx.convert(
          amount,
          sourceCurrency,
          displayCurrency,
          fx.rates,
        );
        displayAmountStr = converted.toFixed(2);
        fxRate =
          sourceCurrency === displayCurrency
            ? 1
            : (fx.rates[displayCurrency] ?? 1) /
              (fx.rates[sourceCurrency] ?? 1);
      } catch {
        displayAmountStr = String(sub.amount);
        fxRate = 1;
      }
      return Object.assign(sub, {
        displayAmount: displayAmountStr,
        displayCurrency,
        fxRate,
        fxFetchedAt: fx.fetchedAt,
      });
    });
  }

  async findOne(userId: string, id: string): Promise<Subscription> {
    const sub = await this.repo.findOne({
      where: { id },
      relations: ['paymentCard'],
    });
    if (!sub || sub.userId !== userId) throw new NotFoundException('Subscription not found');

    // Refuse to serve subscription details that are locked behind the
    // user's plan limit. Without this guard a Free user who downgraded
    // could still pull every cancelled-from-UI sub by guessing IDs.
    if (sub.status === SubscriptionStatus.ACTIVE || sub.status === SubscriptionStatus.TRIAL) {
      const user = await this.usersService.findById(userId);
      const effective = await this.billingService.getEffectiveAccess(user);
      const planConfig = PLANS[effective.plan] ?? PLANS.free;
      if (planConfig.subscriptionLimit !== null) {
        const oldestActive = (await this.repo.find({
          where: [
            { userId, status: SubscriptionStatus.ACTIVE },
            { userId, status: SubscriptionStatus.TRIAL },
          ],
          order: { createdAt: 'ASC' },
          take: planConfig.subscriptionLimit,
          select: ['id'],
        })) ?? [];
        // Allow the requested sub through when it's already in the oldest-N
        // window OR when the user's total ACTIVE/TRIAL count fits inside the
        // limit (every sub is within the cap, so nothing is locked yet).
        const allowed = new Set(oldestActive.map((s) => s.id));
        if (
          oldestActive.length >= planConfig.subscriptionLimit &&
          !allowed.has(id)
        ) {
          throw new ForbiddenException(
            `Subscription locked on ${effective.plan} plan. Upgrade to access all of your subscriptions.`,
          );
        }
      }
    }

    return sub;
  }

  async update(
    userId: string,
    id: string,
    dto: Partial<CreateSubscriptionDto>,
  ): Promise<Subscription> {
    const sub = await this.findOne(userId, id);
    Object.assign(sub, dto);

    // Keep originalCurrency in lockstep with currency on every edit. The
    // historical "what was it when first saved" notion is unused in the
    // current product, and letting the two drift is what produced the
    // "edited price shows wrong amount in totals" reports — a sub edited
    // from USD→KZT was being converted using its old USD origin.
    if (dto.currency !== undefined && dto.currency !== null) {
      sub.originalCurrency = dto.currency;
    }

    if (dto.billingPeriod || dto.startDate || dto.billingDay !== undefined) {
      const startDate = sub.startDate ? new Date(sub.startDate) : null;
      if (startDate && sub.billingPeriod) {
        const next = computeNextPaymentDate(
          startDate,
          sub.billingPeriod,
          sub.billingDay,
        );
        sub.nextPaymentDate = next as Date;
      }
    }

    const saved = await this.repo.save(sub);
    await this.invalidateAnalyticsCache(userId);
    // Trigger analysis re-evaluation (debounced)
    this.analysisService.onSubscriptionChange(userId).catch(err =>
      this.logger.warn(`Analysis trigger failed: ${err.message}`),
    );
    return saved;
  }

  async remove(userId: string, id: string): Promise<void> {
    const sub = await this.findOne(userId, id);
    await this.repo.remove(sub);
    await this.invalidateAnalyticsCache(userId);
    // Trigger analysis re-evaluation (debounced)
    this.analysisService.onSubscriptionChange(userId).catch(err =>
      this.logger.warn(`Analysis trigger failed: ${err.message}`),
    );
  }

  async updateStatus(
    userId: string,
    id: string,
    status: SubscriptionStatus,
  ): Promise<Subscription> {
    const sub = await this.findOne(userId, id);

    // Explicit restore: CANCELLED → ACTIVE clears cancelledAt timestamp.
    // This is the only legal exit from the terminal CANCELLED state.
    if (
      sub.status === SubscriptionStatus.CANCELLED &&
      status === SubscriptionStatus.ACTIVE
    ) {
      sub.cancelledAt = null as unknown as Date;
      sub.status = SubscriptionStatus.ACTIVE;
      const restored = await this.repo.save(sub);
      await this.invalidateAnalyticsCache(userId);
      return restored;
    }

    if (sub.status === status) {
      return sub;
    }

    const allowed = VALID_STATUS_TRANSITIONS[sub.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition subscription status ${sub.status} → ${status}`,
      );
    }

    sub.status = status;
    if (status === SubscriptionStatus.CANCELLED) {
      sub.cancelledAt = new Date();
    }
    const saved = await this.repo.save(sub);
    await this.invalidateAnalyticsCache(userId);
    return saved;
  }

  findAllForUser(userId: string) {
    return this.repo.find({ where: { userId } });
  }

  async recalculateNextPaymentDates(): Promise<number> {
    const today = new Date().toISOString().split('T')[0];

    const subs = await this.repo.find({
      where: [
        {
          status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]),
          nextPaymentDate: IsNull(),
        },
        {
          status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]),
          nextPaymentDate: LessThanOrEqual(new Date(today)),
        },
      ],
    });

    const toUpdate: typeof subs = [];
    for (const sub of subs) {
      if (!sub.startDate || !sub.billingPeriod) continue;

      const next = computeNextPaymentDate(
        new Date(sub.startDate),
        sub.billingPeriod,
        sub.billingDay,
      );
      if (next && (!sub.nextPaymentDate || next > sub.nextPaymentDate)) {
        sub.nextPaymentDate = next;
        toUpdate.push(sub);
      }
    }

    if (toUpdate.length > 0) {
      await this.repo.save(toUpdate); // bulk save — single query
    }

    this.logger.log(`Recalculated nextPaymentDate for ${toUpdate.length} subscriptions`);
    return toUpdate.length;
  }

  // 01:00 UTC — offset from the 00:00 reminder/outbox cron rush so we don't
  // compete for the small DO managed-PG connection budget.
  @Cron('0 1 * * *')
  async dailyNextPaymentUpdate(): Promise<void> {
    await runCronHandler('dailyNextPaymentUpdate', this.logger, this.tg, async () => {
      await this.recalculateNextPaymentDates();
    });
  }
}
