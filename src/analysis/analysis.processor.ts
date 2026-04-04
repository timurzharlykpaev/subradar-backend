import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, In } from 'typeorm';
import type { Job } from 'bull';
import OpenAI from 'openai';

import { ANALYSIS_QUEUE, ANALYSIS_JOB, ANALYSIS_LIMITS, AnalysisPlan } from './analysis.constants';
import { AnalysisJob, AnalysisJobStatus } from './entities/analysis-job.entity';
import { AnalysisResult, Recommendation, DuplicateGroup } from './entities/analysis-result.entity';
import { Subscription, BillingPeriod } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { MarketDataService } from './market-data.service';
import { AnalysisService } from './analysis.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { ServiceCatalog } from './entities/service-catalog.entity';

interface AnalysisJobData {
  jobId: string;
  userId: string;
  workspaceId?: string;
  plan: AnalysisPlan;
  locale?: string;
}

interface CategoryBreakdown {
  category: string;
  totalMonthly: number;
  count: number;
}

interface DuplicateByName {
  normalizedName: string;
  subscriptions: { id: string; name: string; monthlyAmount: number }[];
}

type StageName = 'collect' | 'normalize' | 'marketLookup' | 'aiAnalyze' | 'store';

/** Convert subscription amount to monthly equivalent. */
function toMonthly(sub: Subscription): number {
  const amount = Number(sub.amount) || 0;
  switch (sub.billingPeriod) {
    case BillingPeriod.WEEKLY:
      return amount * 4.33;
    case BillingPeriod.MONTHLY:
      return amount;
    case BillingPeriod.QUARTERLY:
      return amount / 3;
    case BillingPeriod.YEARLY:
      return amount / 12;
    case BillingPeriod.LIFETIME:
    case BillingPeriod.ONE_TIME:
      return 0;
    default:
      return amount;
  }
}

@Processor(ANALYSIS_QUEUE)
export class AnalysisProcessor {
  private readonly logger = new Logger(AnalysisProcessor.name);
  private readonly openai: OpenAI;

  constructor(
    @InjectRepository(AnalysisJob)
    private readonly jobRepo: Repository<AnalysisJob>,
    @InjectRepository(AnalysisResult)
    private readonly resultRepo: Repository<AnalysisResult>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly marketData: MarketDataService,
    private readonly analysisService: AnalysisService,
    private readonly workspaceService: WorkspaceService,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: this.config.get('OPENAI_API_KEY') });
  }

  @Process(ANALYSIS_JOB)
  async handleAnalysis(job: Job<AnalysisJobData>): Promise<void> {
    const { jobId, userId, workspaceId, plan } = job.data;
    this.logger.log(`Starting analysis job ${jobId} for user ${userId} (plan: ${plan})`);

    const analysisJob = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!analysisJob) {
      this.logger.error(`Analysis job ${jobId} not found`);
      return;
    }

    const limits = ANALYSIS_LIMITS[plan];

    try {
      // ── Stage 1: COLLECT ──────────────────────────────────────────────
      await this.updateStage(analysisJob, 'collect', AnalysisJobStatus.COLLECTING);

      const user = await this.userRepo.findOneOrFail({ where: { id: userId } });

      let subscriptions: Subscription[];

      if (workspaceId) {
        // Team analysis: collect all members' subscriptions
        const workspace = await this.workspaceService.getMyWorkspace(userId);
        if (workspace) {
          const memberIds = workspace.members
            .filter((m: any) => m.status === 'ACTIVE' && m.userId)
            .map((m: any) => m.userId);

          subscriptions = await this.subscriptionRepo.find({
            where: { userId: In(memberIds), status: In(['ACTIVE', 'TRIAL'] as any) },
            order: { amount: 'DESC' },
          });
        } else {
          subscriptions = [];
        }
      } else {
        subscriptions = await this.subscriptionRepo.find({
          where: { userId, status: In(['ACTIVE', 'TRIAL'] as any) },
          order: { amount: 'DESC' },
        });
      }

      // Truncate to plan limit
      subscriptions = subscriptions.slice(0, limits.maxSubscriptionsPerAnalysis);

      // Deterministic analytics
      const totalMonthly = subscriptions.reduce((sum, s) => sum + toMonthly(s), 0);

      const byCategoryMap = new Map<string, { total: number; count: number }>();
      for (const sub of subscriptions) {
        const cat = sub.category || 'OTHER';
        const existing = byCategoryMap.get(cat) || { total: 0, count: 0 };
        existing.total += toMonthly(sub);
        existing.count += 1;
        byCategoryMap.set(cat, existing);
      }
      const byCategory: CategoryBreakdown[] = Array.from(byCategoryMap.entries()).map(
        ([category, data]) => ({ category, totalMonthly: Math.round(data.total * 100) / 100, count: data.count }),
      );

      this.logger.log(`Collected ${subscriptions.length} subscriptions, total monthly: ${totalMonthly.toFixed(2)}`);

      // ── Stage 2: NORMALIZE ────────────────────────────────────────────
      await this.updateStage(analysisJob, 'normalize', AnalysisJobStatus.NORMALIZING);

      const normalizedNames = new Map<string, string>();
      for (const sub of subscriptions) {
        const normalized = await this.marketData.getNormalizedName(sub.name);
        normalizedNames.set(sub.id, normalized);
      }

      // Detect duplicates by normalized name
      const nameToSubs = new Map<string, { id: string; name: string; monthlyAmount: number }[]>();
      for (const sub of subscriptions) {
        const normalized = normalizedNames.get(sub.id)!;
        const list = nameToSubs.get(normalized) || [];
        list.push({ id: sub.id, name: sub.name, monthlyAmount: toMonthly(sub) });
        nameToSubs.set(normalized, list);
      }
      const duplicatesByName: DuplicateByName[] = Array.from(nameToSubs.entries())
        .filter(([, subs]) => subs.length > 1)
        .map(([normalizedName, subs]) => ({ normalizedName, subscriptions: subs }));

      this.logger.log(`Normalized ${normalizedNames.size} names, found ${duplicatesByName.length} duplicate groups`);

      // ── Stage 3: MARKET LOOKUP ────────────────────────────────────────
      await this.updateStage(analysisJob, 'marketLookup', AnalysisJobStatus.LOOKING_UP);

      const uniqueNames = [...new Set(normalizedNames.values())];
      const marketDataMap = await this.marketData.batchLookup(uniqueNames, limits.maxWebSearchesPerAnalysis);

      this.logger.log(`Market data retrieved for ${marketDataMap.size}/${uniqueNames.length} services`);

      // ── Stage 4: AI ANALYZE ───────────────────────────────────────────
      await this.updateStage(analysisJob, 'aiAnalyze', AnalysisJobStatus.ANALYZING);

      const subscriptionsInput = subscriptions.map((sub) => {
        const normalized = normalizedNames.get(sub.id)!;
        const market = marketDataMap.get(normalized);
        return {
          id: sub.id,
          name: sub.name,
          normalizedName: normalized,
          amount: Number(sub.amount),
          currency: sub.currency,
          billingPeriod: sub.billingPeriod,
          monthlyEquivalent: Math.round(toMonthly(sub) * 100) / 100,
          category: sub.category,
          currentPlan: sub.currentPlan || null,
          status: sub.status,
          marketData: market
            ? {
                displayName: market.displayName,
                plans: market.plans,
                alternatives: market.alternatives,
              }
            : null,
        };
      });

      const userPrompt = JSON.stringify(
        {
          subscriptions: subscriptionsInput,
          deterministicData: {
            totalMonthly: Math.round(totalMonthly * 100) / 100,
            currency: user.defaultCurrency || 'USD',
            byCategory,
            duplicatesByName,
          },
        },
        null,
        2,
      );

      const systemPrompt = this.buildSystemPrompt(job.data.locale || user.locale || 'en');

      const responseSchema = `{
  "summary": "string (2-3 sentences)",
  "totalMonthlySavings": number,
  "recommendations": [
    {
      "type": "CANCEL | DOWNGRADE | SWITCH_PLAN | SWITCH_PROVIDER | BUNDLE | LOW_USAGE",
      "priority": "HIGH | MEDIUM | LOW",
      "subscriptionId": "uuid",
      "subscriptionName": "string",
      "title": "string",
      "description": "string",
      "estimatedSavingsMonthly": number,
      "alternativeProvider": "string | null",
      "alternativePrice": "number | null",
      "alternativePlan": "string | null",
      "confidence": number
    }
  ],
  "duplicates": [
    {
      "reason": "string",
      "subscriptions": [{ "id": "uuid", "name": "string", "amount": number }],
      "suggestion": "string",
      "estimatedSavingsMonthly": number
    }
  ]
}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Analyze these subscriptions and return JSON matching this schema:\n${responseSchema}\n\nInput:\n${userPrompt}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: limits.maxTokensPerAnalysis,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      const parsed = JSON.parse(content) as {
        summary: string;
        totalMonthlySavings: number;
        recommendations: Recommendation[];
        duplicates: DuplicateGroup[];
      };

      const tokensUsed = response.usage
        ? response.usage.prompt_tokens + response.usage.completion_tokens
        : 0;

      analysisJob.tokensUsed = tokensUsed;
      await this.jobRepo.save(analysisJob);

      this.logger.log(`AI analysis complete, tokens used: ${tokensUsed}`);

      // ── Stage 5: STORE ────────────────────────────────────────────────
      await this.updateStage(analysisJob, 'store', AnalysisJobStatus.ANALYZING);

      const expiresAt = new Date(Date.now() + limits.resultTtlDays * 24 * 60 * 60 * 1000);

      const result = this.resultRepo.create({
        userId,
        workspaceId: workspaceId ?? null,
        jobId,
        inputHash: analysisJob.inputHash,
        summary: parsed.summary || '',
        totalMonthlySavings: parsed.totalMonthlySavings || 0,
        currency: user.defaultCurrency || 'USD',
        recommendations: parsed.recommendations || [],
        duplicates: parsed.duplicates || [],
        subscriptionCount: subscriptions.length,
        modelUsed: 'gpt-4o',
        tokensUsed,
        expiresAt,
      });

      const savedResult = await this.resultRepo.save(result);

      // Finalize job
      analysisJob.status = AnalysisJobStatus.COMPLETED;
      analysisJob.resultId = savedResult.id;
      analysisJob.completedAt = new Date();
      analysisJob.stageProgress = {
        collect: 'done',
        normalize: 'done',
        marketLookup: 'done',
        aiAnalyze: 'done',
        store: 'done',
      };
      await this.jobRepo.save(analysisJob);

      // Increment usage counters
      const webSearchesUsed = marketDataMap.size; // approximate
      await this.analysisService.incrementUsage(
        userId,
        analysisJob.triggerType,
        tokensUsed,
        webSearchesUsed,
      );

      this.logger.log(`Analysis job ${jobId} completed, result: ${savedResult.id}`);
    } catch (error) {
      this.logger.error(`Analysis job ${jobId} failed: ${error.message}`, error.stack);

      analysisJob.status = AnalysisJobStatus.FAILED;
      analysisJob.error = error.message?.slice(0, 2000) || 'Unknown error';
      analysisJob.completedAt = new Date();
      await this.jobRepo.save(analysisJob);

      throw error;
    }
  }

  /** Update job stage progress and status. */
  private async updateStage(
    job: AnalysisJob,
    stage: StageName,
    status: AnalysisJobStatus,
  ): Promise<void> {
    job.status = status;
    // Mark previous stages as done
    const stages: StageName[] = ['collect', 'normalize', 'marketLookup', 'aiAnalyze', 'store'];
    const stageIndex = stages.indexOf(stage);
    for (let i = 0; i < stageIndex; i++) {
      job.stageProgress[stages[i]] = 'done';
    }
    await this.jobRepo.save(job);
  }

  /** Build the system prompt for GPT-4o analysis. */
  private buildSystemPrompt(locale: string): string {
    return `You are a subscription optimization advisor. You receive a user's subscriptions with normalized market data. Your job:
1. Identify savings opportunities (duplicates, downgrades, plan switches, alternatives)
2. Rank recommendations by estimated monthly savings (highest first)
3. Generate a concise human-readable summary (2-3 sentences)
4. Be specific — reference actual prices and plans from market data

Rules:
- Do NOT calculate totals or build charts — that's already done
- Do NOT hallucinate prices — only use provided market data
- If no market data for a service, skip price comparison for it
- Confidence: 0.9+ if based on market data, 0.5-0.8 if reasoning only
- Response language: ${locale}
- Return valid JSON matching the schema`;
  }
}
