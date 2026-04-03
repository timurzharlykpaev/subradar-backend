import { Recommendation, DuplicateGroup, SubscriptionOverlap } from '../entities/analysis-result.entity';
import { AnalysisJobStatus } from '../entities/analysis-job.entity';

export class AnalysisLatestResponseDto {
  result: {
    id: string;
    summary: string;
    totalMonthlySavings: number;
    currency: string;
    recommendations: Recommendation[];
    duplicates: DuplicateGroup[];
    overlaps?: SubscriptionOverlap[] | null;
    teamSavings?: number | null;
    memberCount?: number | null;
    subscriptionCount: number;
    createdAt: string;
    expiresAt: string;
  } | null;

  job: {
    id: string;
    status: AnalysisJobStatus;
    createdAt: string;
  } | null;

  canRunManual: boolean;
  nextAutoAnalysis: string | null;
}

export class AnalysisStatusResponseDto {
  id: string;
  status: AnalysisJobStatus;
  stageProgress: {
    collect: 'pending' | 'done';
    normalize: 'pending' | 'done';
    marketLookup: 'pending' | 'done';
    aiAnalyze: 'pending' | 'done';
    store: 'pending' | 'done';
  };
  resultId: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export class AnalysisRunResponseDto {
  jobId?: string;
  status?: string;
  cached?: boolean;
  resultId?: string;
}

export class AnalysisUsageResponseDto {
  autoAnalysesUsed: number;
  autoAnalysesLimit: number;
  manualAnalysesUsed: number;
  manualAnalysesLimit: number;
  webSearchesUsed: number;
  webSearchesLimit: number;
  tokensUsed: number;
  tokensLimit: number;
  periodStart: string;
  periodEnd: string;
  lastAnalysisAt: string | null;
  cooldownEndsAt: string | null;
}
