import { Injectable, Inject, Logger, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Repository, In } from 'typeorm';
import type { Queue } from 'bull';
import Redis from 'ioredis';
import * as crypto from 'crypto';

import { AnalysisJob, AnalysisJobStatus, AnalysisTriggerType } from './entities/analysis-job.entity';
import { AnalysisResult } from './entities/analysis-result.entity';
import { AnalysisUsage } from './entities/analysis-usage.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
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
  ) {}

  /**
   * Get latest fresh result, any active job, and whether user can run manual analysis.
   */
  async getLatest(userId: string, workspaceId?: string) {
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

    return { latestResult, activeJob, canRunManual: canRun };
  }

  /**
   * Get job status by id and userId.
   */
  async getJobStatus(jobId: string, userId: string) {
    return this.jobRepo.findOne({ where: { id: jobId, userId } });
  }

  /**
   * Main orchestration: validate limits, dedup, enqueue.
   */
  async run(userId: string, triggerType: AnalysisTriggerType, workspaceId?: string, locale?: string) {
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

    // Compute input hash for dedup
    const inputHash = await this.computeInputHash(userId, workspaceId);

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

    // Enqueue to Bull
    await this.analysisQueue.add(
      ANALYSIS_JOB,
      {
        jobId: savedJob.id,
        userId,
        workspaceId: workspaceId ?? null,
        plan,
        locale: locale || user.locale || 'en',
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
   */
  async getOrCreateUsage(userId: string): Promise<AnalysisUsage> {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday),
    );
    const periodEnd = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    let usage = await this.usageRepo.findOne({
      where: { userId, periodStart },
    });

    if (!usage) {
      usage = this.usageRepo.create({
        userId,
        periodStart,
        periodEnd,
        autoAnalysesUsed: 0,
        manualAnalysesUsed: 0,
        webSearchesUsed: 0,
        tokensUsed: 0,
        lastManualAt: null,
      });
      usage = await this.usageRepo.save(usage);
    }

    return usage;
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
   */
  async computeInputHash(userId: string, workspaceId?: string): Promise<string> {
    const subscriptions = await this.subscriptionRepo.find({
      where: { userId, status: In(['ACTIVE', 'TRIAL'] as any) },
      order: { id: 'ASC' },
      select: ['id', 'name', 'amount', 'currency', 'billingPeriod', 'status'],
    });

    const payload = JSON.stringify({
      userId,
      workspaceId: workspaceId ?? null,
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
   * Map user.plan string to AnalysisPlan or null (free users).
   */
  getUserPlan(user: User): AnalysisPlan | null {
    const planLower = (user.plan || 'free').toLowerCase();

    if (planLower === 'pro') return 'pro';
    if (planLower === 'team') return 'team';

    // Check if user is in active trial
    if (user.trialEndDate && new Date(user.trialEndDate) > new Date()) {
      return 'pro';
    }

    return null;
  }

  /**
   * Helper: get user plan by userId.
   */
  private async getUserPlanById(userId: string): Promise<AnalysisPlan | null> {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    return this.getUserPlan(user);
  }
}
