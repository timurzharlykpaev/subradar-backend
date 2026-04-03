export const ANALYSIS_LIMITS = {
  pro: {
    maxAutoPerWeek: 1,
    maxManualPerWeek: 1,
    maxSubscriptionsPerAnalysis: 50,
    maxWebSearchesPerAnalysis: 5,
    maxTokensPerAnalysis: 12_000,
    maxTokensPerMonth: 50_000,
    manualCooldownHours: 24,
    subscriptionChangeDebounceMins: 60,
    resultTtlDays: 7,
  },
  team: {
    maxAutoPerWeek: 1,
    maxManualPerWeek: 1,
    maxSubscriptionsPerAnalysis: 100,
    maxWebSearchesPerAnalysis: 10,
    maxTokensPerAnalysis: 16_000,
    maxTokensPerMonth: 100_000,
    manualCooldownHours: 24,
    subscriptionChangeDebounceMins: 60,
    resultTtlDays: 7,
  },
} as const;

export const ANALYSIS_QUEUE = 'ai-analysis';
export const ANALYSIS_JOB = 'run-analysis';

export type AnalysisPlan = keyof typeof ANALYSIS_LIMITS;
