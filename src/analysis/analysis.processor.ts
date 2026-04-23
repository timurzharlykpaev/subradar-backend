import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, In } from 'typeorm';
import type { Job } from 'bull';
import OpenAI from 'openai';
import Decimal from 'decimal.js';

import { ANALYSIS_QUEUE, ANALYSIS_JOB, ANALYSIS_LIMITS, AnalysisPlan } from './analysis.constants';
import { AnalysisJob, AnalysisJobStatus } from './entities/analysis-job.entity';
import { AnalysisResult, Recommendation, DuplicateGroup } from './entities/analysis-result.entity';
import { Subscription, BillingPeriod } from '../subscriptions/entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { MarketDataService } from './market-data.service';
import { AnalysisService } from './analysis.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { ServiceCatalog } from './entities/service-catalog.entity';
import { FxService } from '../fx/fx.service';

interface AnalysisJobData {
  jobId: string;
  userId: string;
  workspaceId?: string;
  plan: AnalysisPlan;
  locale?: string;
  currency?: string;
  region?: string;
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
    private readonly fx: FxService,
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

      // Apply the plan's per-analysis cap at the SQL layer so we never pull
      // every active subscription into memory when a heavy Team/Pro account
      // has thousands of rows. Order by amount so the truncation keeps the
      // most impactful subscriptions (same ranking as before, now enforced
      // in the DB instead of JS).
      const perAnalysisCap = limits.maxSubscriptionsPerAnalysis;

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
            take: perAnalysisCap,
          });
        } else {
          subscriptions = [];
        }
      } else {
        subscriptions = await this.subscriptionRepo.find({
          where: { userId, status: In(['ACTIVE', 'TRIAL'] as any) },
          order: { amount: 'DESC' },
          take: perAnalysisCap,
        });
      }

      // Resolve effective locale/currency/region: per-request override from
      // job.data > user profile > default. Drives FX conversion and the LLM
      // prompt so totals, byCategory and AI copy are coherent.
      const displayCurrency = (job.data.currency || user.displayCurrency || user.defaultCurrency || 'USD').toUpperCase();
      const userRegion = (job.data.region || user.region || user.country || 'US').toUpperCase();
      const userLocale = (job.data.locale || user.locale || 'en').split('-')[0].toLowerCase();

      let fxRates: Record<string, number> = {};
      try {
        const snapshot = await this.fx.getRates();
        fxRates = snapshot.rates;
      } catch (e: any) {
        this.logger.warn(`FX rates unavailable, falling back to raw amounts: ${e?.message}`);
      }

      const monthlyInDisplay = (sub: Subscription): number => {
        const raw = toMonthly(sub);
        const from = (sub.currency || displayCurrency).toUpperCase();
        if (from === displayCurrency || !fxRates[from] && from !== 'USD') {
          return raw;
        }
        try {
          return this.fx.convert(new Decimal(raw), from, displayCurrency, fxRates).toNumber();
        } catch {
          return raw;
        }
      };

      // Deterministic analytics in display currency
      const totalMonthly = subscriptions.reduce((sum, s) => sum + monthlyInDisplay(s), 0);

      const byCategoryMap = new Map<string, { total: number; count: number }>();
      for (const sub of subscriptions) {
        const cat = sub.category || 'OTHER';
        const existing = byCategoryMap.get(cat) || { total: 0, count: 0 };
        existing.total += monthlyInDisplay(sub);
        existing.count += 1;
        byCategoryMap.set(cat, existing);
      }
      const byCategory: CategoryBreakdown[] = Array.from(byCategoryMap.entries()).map(
        ([category, data]) => ({ category, totalMonthly: Math.round(data.total * 100) / 100, count: data.count }),
      );

      this.logger.log(`Collected ${subscriptions.length} subscriptions, total monthly: ${totalMonthly.toFixed(2)} ${displayCurrency}`);

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
        const monthlyDisp = Math.round(monthlyInDisplay(sub) * 100) / 100;
        return {
          id: sub.id,
          name: sub.name,
          normalizedName: normalized,
          // Original amount + currency as the user entered it
          amount: Number(sub.amount),
          currency: sub.currency,
          billingPeriod: sub.billingPeriod,
          // Monthly amount converted to user's display currency (for cross-sub aggregation)
          monthlyEquivalent: Math.round(toMonthly(sub) * 100) / 100,
          monthlyEquivalentInDisplayCurrency: monthlyDisp,
          displayCurrency,
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
            currency: displayCurrency,
            region: userRegion,
            byCategory,
            duplicatesByName,
          },
        },
        null,
        2,
      );

      const systemPrompt = this.buildSystemPrompt(userLocale, displayCurrency, userRegion);

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
        currency: displayCurrency,
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
  private buildSystemPrompt(locale: string, displayCurrency: string, region: string): string {
    return `You are a subscription optimization advisor. You receive a user's subscriptions with normalized market data. Your job:
1. Identify savings opportunities (duplicates, downgrades, plan switches, alternatives)
2. Rank recommendations by estimated monthly savings (highest first)
3. Generate a concise human-readable summary (2-3 sentences)
4. Be specific — reference actual prices and plans from market data
5. If user has overlapping services in same category, suggest keeping the best value

USER CONTEXT (authoritative):
- Display currency: ${displayCurrency}
- Region: ${region}
- Locale: ${locale}

CURRENCY RULES (CRITICAL — the user is in ${region} and reads totals in ${displayCurrency}):
- The "deterministicData.totalMonthly" value is already expressed in ${displayCurrency}. Do NOT relabel it as USD.
- "totalMonthlySavings" in your output MUST be a number expressed in ${displayCurrency}.
- "estimatedSavingsMonthly" / "alternativePrice" in each recommendation MUST be expressed in ${displayCurrency}.
- Each subscription input includes its own "currency" field — that is the original currency the user entered. Many subscriptions in different currencies may be present; respect each one when reasoning, but report aggregate savings in ${displayCurrency}.
- All free-text output (summary, title, description, suggestion, reason) MUST be written in "${locale}".
- Mention currency symbol/code naturally in the language: e.g. "1500 ₸" for Russian/Kazakh users in KZ, "$15" for US users.

Rules:
- Do NOT calculate totals or build charts — that's already done
- Do NOT hallucinate prices — only use provided market data
- If no market data for a service, skip price comparison for it
- Confidence: 0.9+ if based on market data, 0.5-0.8 if reasoning only
- Consider yearly vs monthly savings: if user pays monthly but yearly is cheaper, recommend switching
- Group related services (e.g. multiple streaming services) and suggest bundles if applicable
- Return valid JSON matching the schema`;
  }
}
