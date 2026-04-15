import { Inject, Injectable, Logger } from '@nestjs/common';

export interface FullResearchResult {
  service: {
    name: string;
    slug: string;
    category: string;
    iconUrl: string | null;
    websiteUrl: string | null;
    aliases: string[];
  };
  plans: Array<{
    region: string;
    planName: string;
    price: number;
    currency: string;
    period: string;
    trialDays?: number;
    features: string[];
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
}

export interface PriceRefreshResult {
  prices: Array<{
    region: string;
    planName: string;
    price: number;
    currency: string;
  }>;
  notes?: string;
}

const FULL_RESEARCH_MODEL = 'gpt-4o';
const PRICE_REFRESH_MODEL = 'gpt-4o-mini';

@Injectable()
export class AiCatalogProvider {
  private readonly logger = new Logger(AiCatalogProvider.name);

  constructor(@Inject('OPENAI_CLIENT') private readonly openai: any) {}

  async fullResearch(
    query: string,
    regions: string[],
  ): Promise<FullResearchResult> {
    const systemPrompt = `You are a SaaS subscription research assistant. Given a service name, return JSON describing the service and its current publicly-listed plans for each requested region. If a plan is unavailable in a region, omit it. Be precise with currency (ISO-4217) and period (must be one of: WEEKLY, MONTHLY, QUARTERLY, YEARLY, LIFETIME, ONE_TIME). If uncertain about a price, set confidence: "MEDIUM" or "LOW". Normalize slug to lowercase kebab-case. Return JSON matching: {"service":{"name","slug","category","iconUrl","websiteUrl","aliases":[]},"plans":[{"region","planName","price","currency","period","trialDays","features":[],"confidence"}]}`;
    const userPrompt = JSON.stringify({ query, regions });

    return (await this.callWithRetry(
      FULL_RESEARCH_MODEL,
      systemPrompt,
      userPrompt,
    )) as FullResearchResult;
  }

  async priceRefresh(
    service: string,
    regions: string[],
    knownPlans: string[],
  ): Promise<PriceRefreshResult> {
    const systemPrompt = `Return ONLY current prices for the listed plans in the listed regions. No new plans, no descriptions. Return JSON: {"prices":[{"region","planName","price","currency"}], "notes":"..."}`;
    const userPrompt = JSON.stringify({ service, regions, knownPlans });
    return (await this.callWithRetry(
      PRICE_REFRESH_MODEL,
      systemPrompt,
      userPrompt,
    )) as PriceRefreshResult;
  }

  private async callWithRetry(
    model: string,
    system: string,
    user: string,
    attempt = 1,
  ): Promise<unknown> {
    const resp = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: attempt === 1 ? 0.2 : 0,
    });
    const content = resp.choices?.[0]?.message?.content;
    try {
      return JSON.parse(content);
    } catch {
      if (attempt >= 2) {
        throw new Error(
          `AI response unparseable after retry: ${String(content).slice(0, 200)}`,
        );
      }
      this.logger.warn(
        `AI response invalid JSON, retrying (attempt ${attempt})`,
      );
      return this.callWithRetry(model, system, user, attempt + 1);
    }
  }
}
