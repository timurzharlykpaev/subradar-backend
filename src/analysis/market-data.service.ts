// src/analysis/market-data.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceCatalog, ServicePlan, ServiceSource } from './entities/service-catalog.entity';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import OpenAI from 'openai';

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);
  private readonly openai: OpenAI;

  constructor(
    @InjectRepository(ServiceCatalog)
    private readonly catalogRepo: Repository<ServiceCatalog>,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: this.config.get('OPENAI_API_KEY') });
  }

  normalizeServiceName(raw: string): string {
    return raw
      .toLowerCase()
      .trim()
      .replace(/\s+(premium|basic|standard|pro|plus|family|team|enterprise|business|starter|individual|duo|student)\b/gi, '')
      .replace(/\s+(monthly|yearly|annual|lifetime)\b/gi, '')
      .replace(/\s+(plan|subscription|tier|membership)\b/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .replace(/^_|_$/g, '');
  }

  async getNormalizedName(raw: string): Promise<string> {
    const cacheKey = `norm:${raw.toLowerCase().trim()}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return cached;
    const normalized = this.normalizeServiceName(raw);
    await this.redis.set(cacheKey, normalized, 'EX', 7 * 86400).catch(() => {});
    return normalized;
  }

  async getMarketData(normalizedName: string, allowWebSearch: boolean): Promise<ServiceCatalog | null> {
    const entry = await this.catalogRepo.findOne({ where: { normalizedName } });
    if (entry) {
      const now = new Date();
      if (!entry.expiresAt || entry.expiresAt > now) return entry;
    }
    if (!entry) {
      const fuzzy = await this.fuzzyMatch(normalizedName);
      if (fuzzy) return fuzzy;
    }
    if (allowWebSearch) return this.webSearchAndCache(normalizedName);
    return entry || null;
  }

  private async fuzzyMatch(normalizedName: string): Promise<ServiceCatalog | null> {
    return this.catalogRepo
      .createQueryBuilder('sc')
      .where(`sc."normalizedName" LIKE :pattern`, { pattern: `%${normalizedName}%` })
      .limit(1)
      .getOne();
  }

  private async webSearchAndCache(normalizedName: string): Promise<ServiceCatalog | null> {
    try {
      const displayName = normalizedName.replace(/_/g, ' ');
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Search for current pricing of "${displayName}" subscription service.
Return ONLY valid JSON:
{
  "displayName": "Official Service Name",
  "category": "STREAMING|AI_SERVICES|INFRASTRUCTURE|PRODUCTIVITY|MUSIC|GAMING|NEWS|HEALTH|EDUCATION|FINANCE|DESIGN|SECURITY|DEVELOPER|SPORT|BUSINESS|OTHER",
  "plans": [
    { "name": "Plan Name", "priceMonthly": number|null, "priceYearly": number|null, "currency": "USD" }
  ],
  "competitors": ["competitor1", "competitor2", "competitor3"]
}
If service not found or not a subscription service, return { "notFound": true }`,
          },
          { role: 'user', content: `Find current pricing for: ${displayName}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content);
      if (parsed.notFound) return null;

      const catalog = this.catalogRepo.create({
        normalizedName,
        displayName: parsed.displayName || displayName,
        category: parsed.category || null,
        plans: (parsed.plans || []) as ServicePlan[],
        alternatives: (parsed.competitors || []).map((c: string) => this.normalizeServiceName(c)),
        source: ServiceSource.WEB_SEARCH,
        lastVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 86400 * 1000),
      });

      await this.catalogRepo.save(catalog);
      this.logger.log(`Cached web search result for: ${normalizedName}`);
      return catalog;
    } catch (error) {
      this.logger.warn(`Web search failed for ${normalizedName}: ${error.message}`);
      return null;
    }
  }

  async batchLookup(normalizedNames: string[], maxWebSearches: number): Promise<Map<string, ServiceCatalog>> {
    const result = new Map<string, ServiceCatalog>();
    let webSearchCount = 0;
    for (const name of normalizedNames) {
      const allowWeb = webSearchCount < maxWebSearches;
      const data = await this.getMarketData(name, allowWeb);
      if (data) {
        result.set(name, data);
        if (data.source === ServiceSource.WEB_SEARCH && data.createdAt && (Date.now() - data.createdAt.getTime()) < 60000) {
          webSearchCount++;
        }
      }
    }
    return result;
  }
}
