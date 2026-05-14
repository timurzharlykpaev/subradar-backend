import {
  Injectable,
  Inject,
  Logger,
  ForbiddenException,
  ConflictException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Repository, In } from 'typeorm';
import type { Queue } from 'bull';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import Decimal from 'decimal.js';

import { AnalysisJob, AnalysisJobStatus, AnalysisTriggerType } from './entities/analysis-job.entity';
import { AnalysisResult, Recommendation, DuplicateGroup } from './entities/analysis-result.entity';
import { AnalysisUsage } from './entities/analysis-usage.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { BillingService } from '../billing/billing.service';
import { FxService } from '../fx/fx.service';
import {
  ANALYSIS_LIMITS,
  ANALYSIS_QUEUE,
  ANALYSIS_JOB,
  AnalysisPlan,
} from './analysis.constants';

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    @InjectRepository(AnalysisJob)
    private readonly jobRepo: Repository<AnalysisJob>,
    @InjectRepository(AnalysisResult)
    private readonly resultRepo: Repository<AnalysisResult>,
    @InjectRepository(AnalysisUsage)
    private readonly usageRepo: Repository<AnalysisUsage>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
    @InjectQueue(ANALYSIS_QUEUE)
    private readonly analysisQueue: Queue,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
    private readonly fx: FxService,
  ) {}

  /**
   * Get latest fresh result, any active job, and whether user can run manual analysis.
   *
   * `displayCurrency` lets new clients ask for monetary fields converted to their
   * current UI currency without re-running the analysis. Old clients omit it and
   * keep getting amounts in the currency the analysis was computed in.
   */
  async getLatest(
    userId: string,
    opts?: { workspaceId?: string; displayCurrency?: string },
  ) {
    const workspaceId = opts?.workspaceId;
    const requestedCurrency = opts?.displayCurrency?.toUpperCase();
    const plan = await this.getUserPlanById(userId);

    const ttlDays = plan ? ANALYSIS_LIMITS[plan].resultTtlDays : 7;
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

    const [latestResult, activeJob, canRun] = await Promise.all([
      this.resultRepo.findOne({
        where: { userId, ...(workspaceId ? { workspaceId } : {}) },
        order: { createdAt: 'DESC' },
      }).then((r) => (r && r.createdAt >= cutoff ? r : null)),
      this.jobRepo.findOne({
        where: {
          userId,
          ...(workspaceId ? { workspaceId } : {}),
          status: In([
            AnalysisJobStatus.QUEUED,
            AnalysisJobStatus.COLLECTING,
            AnalysisJobStatus.NORMALIZING,
            AnalysisJobStatus.LOOKING_UP,
            AnalysisJobStatus.ANALYZING,
          ]),
        },
        order: { createdAt: 'DESC' },
      }),
      this.canRunManual(userId),
    ]);

    const converted = latestResult
      ? await this.convertResultCurrency(latestResult, requestedCurrency)
      : null;

    return { latestResult: converted, activeJob, canRunManual: canRun };
  }

  /**
   * If `target` differs from the result's currency, convert all monetary
   * fields in-place (totalMonthlySavings, each recommendation's saving and
   * alt-price, each duplicate group's saving and per-sub amount). Free-text
   * AI copy is left untouched — the localized number rendering is the
   * client's job and matters only for the currency symbol, not the magnitude.
   *
   * Falls back to the unconverted result on FX failure: showing the original
   * currency is better than showing nothing.
   */
  private async convertResultCurrency(
    result: AnalysisResult,
    target?: string,
  ): Promise<AnalysisResult> {
    if (!target) return result;
    const from = (result.currency || 'USD').toUpperCase();
    if (from === target) return result;

    let rates: Record<string, number>;
    try {
      const snapshot = await this.fx.getRates();
      rates = snapshot.rates;
    } catch (e: any) {
      this.logger.warn(
        `FX rates unavailable for getLatest conversion (${from} → ${target}): ${e?.message}`,
      );
      return result;
    }

    const conv = (n: number | null | undefined): number => {
      if (n == null || !isFinite(Number(n))) return Number(n) || 0;
      try {
        return Math.round(
          this.fx.convert(new Decimal(Number(n)), from, target, rates).toNumber() * 100,
        ) / 100;
      } catch (e: any) {
        this.logger.warn(
          `FX convert failed for ${from} → ${target}: ${e?.message}; returning raw`,
        );
        return Number(n) || 0;
      }
    };

    // Clone to avoid mutating the cached TypeORM entity instance.
    const cloned: AnalysisResult = { ...result };
    cloned.totalMonthlySavings = conv(Number(result.totalMonthlySavings));
    cloned.recommendations = (result.recommendations || []).map(
      (r): Recommendation => ({
        ...r,
        estimatedSavingsMonthly: conv(r.estimatedSavingsMonthly),
        alternativePrice: r.alternativePrice == null ? r.alternativePrice : conv(r.alternativePrice),
      }),
    );
    cloned.duplicates = (result.duplicates || []).map(
      (d): DuplicateGroup => ({
        ...d,
        estimatedSavingsMonthly: conv(d.estimatedSavingsMonthly),
        subscriptions: (d.subscriptions || []).map((s) => ({
          ...s,
          amount: conv(s.amount),
        })),
      }),
    );
    if (cloned.teamSavings != null) {
      cloned.teamSavings = conv(Number(result.teamSavings));
    }
    cloned.currency = target;
    return cloned;
  }

  /**
   * Get job status by id and userId.
   */
  async getJobStatus(jobId: string, userId: string) {
    return this.jobRepo.findOne({ where: { id: jobId, userId } });
  }

  /**
   * Main orchestration: validate limits, dedup, enqueue.
   *
   * `opts` overrides user-profile defaults for a single run. Mobile clients
   * send per-request `locale`/`currency`/`region` because their UI can change
   * those independently of the saved profile. Passing a string for back-compat
   * is still supported (treated as `locale`).
   */
  async run(
    userId: string,
    triggerType: AnalysisTriggerType,
    workspaceId?: string,
    opts?: string | { locale?: string; currency?: string; region?: string },
  ) {
    const overrides = typeof opts === 'string' ? { locale: opts } : opts || {};
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    const plan = this.getUserPlan(user);

    if (!plan) {
      throw new ForbiddenException('Analysis requires a Pro or Team subscription');
    }

    const limits = ANALYSIS_LIMITS[plan];
    const usage = await this.getOrCreateUsage(userId);

    // Check weekly limits
    if (triggerType === AnalysisTriggerType.MANUAL) {
      if (usage.manualAnalysesUsed >= limits.maxManualPerWeek) {
        throw new ForbiddenException('Weekly manual analysis limit reached');
      }
    }
    if (
      triggerType === AnalysisTriggerType.AUTO ||
      triggerType === AnalysisTriggerType.CRON ||
      triggerType === AnalysisTriggerType.SUBSCRIPTION_CHANGE
    ) {
      if (usage.autoAnalysesUsed >= limits.maxAutoPerWeek) {
        throw new ForbiddenException('Weekly automatic analysis limit reached');
      }
    }

    // Check manual cooldown (24h)
    if (triggerType === AnalysisTriggerType.MANUAL && usage.lastManualAt) {
      const cooldownMs = limits.manualCooldownHours * 60 * 60 * 1000;
      const elapsed = Date.now() - new Date(usage.lastManualAt).getTime();
      if (elapsed < cooldownMs) {
        const remainingMins = Math.ceil((cooldownMs - elapsed) / 60_000);
        throw new ConflictException(
          `Manual analysis cooldown: ${remainingMins} minutes remaining`,
        );
      }
    }

    // Resolve effective locale/currency/region: per-request override > user profile > default.
    // These must all be part of the dedup hash so switching any of them forces
    // a fresh analysis (totals, suggestions and AI copy are rendered in them).
    const effectiveLocale = (overrides.locale || user.locale || 'en').split('-')[0].toLowerCase();
    const effectiveCurrency = (overrides.currency || user.displayCurrency || user.defaultCurrency || 'USD').toUpperCase();
    const effectiveRegion = (overrides.region || user.region || user.country || 'US').toUpperCase();
    const inputHash = await this.computeInputHash(userId, workspaceId, {
      locale: effectiveLocale,
      currency: effectiveCurrency,
      region: effectiveRegion,
    });

    // Check for fresh cached result with same hash
    const ttlDays = limits.resultTtlDays;
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
    const cachedResult = await this.resultRepo.findOne({
      where: { userId, inputHash, ...(workspaceId ? { workspaceId } : {}) },
      order: { createdAt: 'DESC' },
    });

    if (cachedResult && cachedResult.createdAt >= cutoff) {
      this.logger.log(`Returning cached result ${cachedResult.id} for user ${userId}`);
      return { cached: true, resultId: cachedResult.id, result: cachedResult };
    }

    // Check for active job with same hash
    const activeJob = await this.jobRepo.findOne({
      where: {
        userId,
        inputHash,
        status: In([
          AnalysisJobStatus.QUEUED,
          AnalysisJobStatus.COLLECTING,
          AnalysisJobStatus.NORMALIZING,
          AnalysisJobStatus.LOOKING_UP,
          AnalysisJobStatus.ANALYZING,
        ]),
      },
      order: { createdAt: 'DESC' },
    });

    if (activeJob) {
      this.logger.log(`Returning active job ${activeJob.id} for user ${userId}`);
      return { cached: false, jobId: activeJob.id, job: activeJob };
    }

    // Create new job
    const job = this.jobRepo.create({
      userId,
      workspaceId: workspaceId ?? null,
      triggerType,
      inputHash,
      status: AnalysisJobStatus.QUEUED,
    });
    const savedJob = await this.jobRepo.save(job);

    // Enqueue to Bull — pass effective locale/currency/region so processor
    // honours per-request overrides instead of re-reading user profile.
    await this.analysisQueue.add(
      ANALYSIS_JOB,
      {
        jobId: savedJob.id,
        userId,
        workspaceId: workspaceId ?? null,
        plan,
        locale: effectiveLocale,
        currency: effectiveCurrency,
        region: effectiveRegion,
      },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log(`Enqueued analysis job ${savedJob.id} for user ${userId} (${triggerType})`);

    return { cached: false, jobId: savedJob.id, job: savedJob };
  }

  /**
   * Get or create weekly usage record (Monday-Monday UTC).
   *
   * Concurrent callers can both hit the `findOne → null → save` path. The
   * second `save` then violates `unique(userId, periodStart)` and bubbles a
   * 500 to the client. We swallow that one specific conflict and re-read,
   * which is correct because the row exists by the time the catch fires.
   */
  async getOrCreateUsage(userId: string): Promise<AnalysisUsage> {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday),
    );
    const periodEnd = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const existing = await this.usageRepo.findOne({ where: { userId, periodStart } });
    if (existing) return existing;

    try {
      const created = this.usageRepo.create({
        userId,
        periodStart,
        periodEnd,
        autoAnalysesUsed: 0,
        manualAnalysesUsed: 0,
        webSearchesUsed: 0,
        tokensUsed: 0,
        lastManualAt: null,
      });
      return await this.usageRepo.save(created);
    } catch (e: any) {
      // 23505 = Postgres unique_violation. Another request just inserted
      // the row for this (userId, periodStart) — re-read and return it.
      if (e?.code === '23505' || /unique/i.test(e?.message || '')) {
        const racer = await this.usageRepo.findOne({ where: { userId, periodStart } });
        if (racer) return racer;
      }
      throw e;
    }
  }

  /**
   * Get formatted usage stats for a user.
   */
  async getUsageStats(userId: string) {
    const plan = await this.getUserPlanById(userId);
    const usage = await this.getOrCreateUsage(userId);

    if (!plan) {
      return {
        plan: null,
        periodStart: usage.periodStart,
        periodEnd: usage.periodEnd,
        autoAnalyses: { used: usage.autoAnalysesUsed, limit: 0 },
        manualAnalyses: { used: usage.manualAnalysesUsed, limit: 0 },
        tokens: { used: usage.tokensUsed, limit: 0 },
        webSearches: { used: usage.webSearchesUsed, limit: 0 },
        lastManualAt: usage.lastManualAt,
        canRunManual: false,
      };
    }

    const limits = ANALYSIS_LIMITS[plan];

    return {
      plan,
      periodStart: usage.periodStart,
      periodEnd: usage.periodEnd,
      autoAnalyses: { used: usage.autoAnalysesUsed, limit: limits.maxAutoPerWeek },
      manualAnalyses: { used: usage.manualAnalysesUsed, limit: limits.maxManualPerWeek },
      tokens: { used: usage.tokensUsed, limit: limits.maxTokensPerMonth },
      webSearches: { used: usage.webSearchesUsed, limit: limits.maxWebSearchesPerAnalysis },
      lastManualAt: usage.lastManualAt,
      canRunManual: await this.canRunManual(userId),
    };
  }

  /**
   * Check if user can run a manual analysis right now.
   */
  async canRunManual(userId: string): Promise<boolean> {
    const plan = await this.getUserPlanById(userId);
    if (!plan) return false;

    const limits = ANALYSIS_LIMITS[plan];
    const usage = await this.getOrCreateUsage(userId);

    if (usage.manualAnalysesUsed >= limits.maxManualPerWeek) return false;

    if (usage.lastManualAt) {
      const cooldownMs = limits.manualCooldownHours * 60 * 60 * 1000;
      const elapsed = Date.now() - new Date(usage.lastManualAt).getTime();
      if (elapsed < cooldownMs) return false;
    }

    return true;
  }

  /**
   * Compute SHA-256 hash of user's subscription data for dedup.
   *
   * locale/currency/region are included so changing any of them forces a
   * fresh analysis (totals, optimisation suggestions and AI explanations
   * are all rendered in them). Legacy callers can still pass a bare locale
   * string — user profile fills the rest.
   */
  async computeInputHash(
    userId: string,
    workspaceId?: string,
    opts?: string | { locale?: string; currency?: string; region?: string },
  ): Promise<string> {
    const overrides = typeof opts === 'string' ? { locale: opts } : opts || {};
    const [subscriptions, user] = await Promise.all([
      this.subscriptionRepo.find({
        where: { userId, status: In(['ACTIVE', 'TRIAL'] as any) },
        order: { id: 'ASC' },
        select: ['id', 'name', 'amount', 'currency', 'billingPeriod', 'status'],
      }),
      this.userRepo.findOne({
        where: { id: userId },
        select: ['id', 'displayCurrency', 'defaultCurrency', 'region', 'country', 'locale'],
      }),
    ]);

    const locale = (overrides.locale || user?.locale || 'en').split('-')[0].toLowerCase();
    const displayCurrency = (overrides.currency || user?.displayCurrency || user?.defaultCurrency || 'USD').toUpperCase();
    const region = (overrides.region || user?.region || user?.country || 'US').toUpperCase();

    const payload = JSON.stringify({
      userId,
      workspaceId: workspaceId ?? null,
      locale,
      displayCurrency,
      region,
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        name: s.name,
        amount: s.amount,
        currency: s.currency,
        billingPeriod: s.billingPeriod,
        status: s.status,
      })),
    });

    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Debounced handler for subscription changes. Uses Redis key with 1h TTL.
   */
  async onSubscriptionChange(userId: string): Promise<void> {
    const redisKey = `analysis:sub-change-debounce:${userId}`;
    const exists = await this.redis.get(redisKey);

    if (exists) {
      this.logger.debug(`Subscription change debounced for user ${userId}`);
      return;
    }

    const plan = await this.getUserPlanById(userId);
    if (!plan) return;

    const ttlSeconds = ANALYSIS_LIMITS[plan].subscriptionChangeDebounceMins * 60;
    await this.redis.set(redisKey, '1', 'EX', ttlSeconds);

    try {
      await this.run(userId, AnalysisTriggerType.SUBSCRIPTION_CHANGE);
    } catch (error) {
      this.logger.warn(
        `Auto-analysis on subscription change failed for user ${userId}: ${error.message}`,
      );
    }
  }

  /**
   * Increment usage counters after a job completes.
   */
  async incrementUsage(
    userId: string,
    triggerType: AnalysisTriggerType,
    tokensUsed: number,
    webSearchesUsed: number,
  ): Promise<void> {
    const usage = await this.getOrCreateUsage(userId);

    if (
      triggerType === AnalysisTriggerType.AUTO ||
      triggerType === AnalysisTriggerType.CRON ||
      triggerType === AnalysisTriggerType.SUBSCRIPTION_CHANGE
    ) {
      usage.autoAnalysesUsed += 1;
    } else if (triggerType === AnalysisTriggerType.MANUAL) {
      usage.manualAnalysesUsed += 1;
      usage.lastManualAt = new Date();
    }

    usage.tokensUsed += tokensUsed;
    usage.webSearchesUsed += webSearchesUsed;

    await this.usageRepo.save(usage);
  }

  /**
   * Record token spend for a job that failed AFTER OpenAI charged us
   * (parse error, DB error, etc). Doesn't touch manual/auto counters
   * — failed jobs shouldn't burn the user's weekly quota, but the $
   * we spent must still show up in tokensUsed for cost observability.
   */
  async recordFailedJobCost(userId: string, tokensUsed: number): Promise<void> {
    if (!tokensUsed || tokensUsed <= 0) return;
    const usage = await this.getOrCreateUsage(userId);
    usage.tokensUsed += tokensUsed;
    await this.usageRepo.save(usage);
  }

  /**
   * Map user.plan string to AnalysisPlan or null (free users).
   *
   * Delegates trial / cancel-at-period-end handling to
   * `BillingService.getEffectivePlan`, so users with plan='pro' in the DB
   * but an expired trial or lapsed subscription are correctly treated as
   * free.
   */
  getUserPlan(user: User): AnalysisPlan | null {
    if (!user) return null;
    const effective = (this.billingService.getEffectivePlan(user) || 'free').toLowerCase();
    if (effective === 'pro') return 'pro';
    if (effective === 'organization' || effective === 'team') return 'team';
    return null;
  }

  /**
   * Helper: get user plan by userId.
   *
   * Unlike {@link getUserPlan} (which only reads `user.plan`/`billingSource`),
   * this version also considers team membership via {@link BillingService.getEffectiveAccess}.
   * A team member whose owner has an active Team subscription has `user.plan = 'free'`
   * in the DB but effectively has Team-level access — they should be able to use
   * AI analysis, not be rejected as a free user.
   */
  private async getUserPlanById(userId: string): Promise<AnalysisPlan | null> {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    const own = this.getUserPlan(user);
    if (own) return own;
    try {
      const access = await this.billingService.getEffectiveAccess(user);
      if (access.plan === 'pro') return 'pro';
      if (access.plan === 'organization') return 'team';
    } catch {
      // If team lookup fails, fall back to own-only plan resolution.
    }
    return null;
  }
}
