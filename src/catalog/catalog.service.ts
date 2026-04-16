import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { DataSource, Repository } from 'typeorm';
import type { Queue } from 'bull';
import Decimal from 'decimal.js';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis.module';
import { CatalogService as CatalogEntity } from './entities/catalog-service.entity';
import {
  CatalogPlan,
  PriceConfidence,
  PriceSource,
} from './entities/catalog-plan.entity';
import { AiCatalogProvider } from './ai-catalog.provider';
import { FxService } from '../fx/fx.service';
import { UsersService } from '../users/users.service';
import {
  SubscriptionCategory,
  BillingPeriod,
} from '../subscriptions/entities/subscription.entity';

const LOCK_TTL_SEC = 60;
const LOCK_POLL_INTERVAL_MS = 500;
const LOCK_MAX_WAIT_MS = 20_000;
const STALE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_QUERY_LENGTH = 200;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Sanitize user-supplied query before sending to OpenAI prompt.
 * Strips control chars and prompt-injection payload candidates (quotes,
 * braces, backticks), then truncates to a safe length.
 */
function sanitizeQuery(s: string): string {
  return (s || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/["'`{}\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @InjectRepository(CatalogEntity)
    private readonly serviceRepo: Repository<CatalogEntity>,
    @InjectRepository(CatalogPlan)
    private readonly planRepo: Repository<CatalogPlan>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ai: AiCatalogProvider,
    private readonly fxService: FxService,
    private readonly usersService: UsersService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue('catalog-refresh') private readonly refreshQueue: Queue,
  ) {}

  async getPopular(
    regionParam?: string,
    currencyParam?: string,
    limitParam?: number,
    jwtUser?: { id: string },
  ) {
    const POPULAR_CACHE_TTL = 3600; // 1 hour
    const limit = Math.min(Math.max(limitParam || 20, 1), 50);

    // Resolve region & currency: param → user prefs → defaults
    let region = regionParam?.toUpperCase();
    let currency = currencyParam?.toUpperCase();

    if ((!region || !currency) && jwtUser?.id) {
      try {
        const user = await this.usersService.findById(jwtUser.id);
        if (!region) region = user.region || 'US';
        if (!currency) currency = user.displayCurrency || 'USD';
      } catch {
        // user lookup failed — use defaults
      }
    }
    region = region || 'US';
    currency = currency || 'USD';

    // Check Redis cache
    const cacheKey = `catalog:popular:${region}:${currency}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // Apply limit on cached result (cache stores up to 50)
        return parsed.slice(0, limit);
      } catch {
        // corrupted cache — fall through
      }
    }

    // Query top services by subscription count.
    // Uses catalogServiceId for accurate matching; falls back to name match
    // for subscriptions created before catalog linking was introduced.
    const rows: Array<CatalogEntity & { sub_count: string }> =
      await this.dataSource.query(
        `SELECT cs.*, COUNT(s.id)::text AS sub_count
         FROM catalog_services cs
         LEFT JOIN subscriptions s
           ON s."catalogServiceId" = cs.id
           OR (s."catalogServiceId" IS NULL AND LOWER(s.name) = LOWER(cs.name))
         GROUP BY cs.id
         ORDER BY COUNT(s.id) DESC, cs."researchCount" DESC
         LIMIT $1`,
        [50], // fetch max for caching, slice for response
      );

    // Fetch FX rates once (needed for potential conversions)
    let fxRates: Record<string, number> | null = null;

    const result: Array<{
      id: string;
      name: string;
      slug: string;
      category: SubscriptionCategory;
      iconUrl: string | null;
      plans: Array<{
        name: string;
        price: number;
        currency: string;
        period: BillingPeriod;
      }>;
    }> = [];

    for (const row of rows) {
      // 1) Try plans for requested region
      let plans = await this.planRepo.find({
        where: { serviceId: row.id, region },
      });

      // 2) Fallback to US region if no plans for requested region
      if (plans.length === 0 && region !== 'US') {
        plans = await this.planRepo.find({
          where: { serviceId: row.id, region: 'US' },
        });
      }

      // Map plans with currency conversion
      const mappedPlans: Array<{
        name: string;
        price: number;
        currency: string;
        period: BillingPeriod;
      }> = [];

      for (const plan of plans) {
        let price = new Decimal(plan.price);
        let planCurrency = plan.currency;

        if (planCurrency !== currency) {
          try {
            if (!fxRates) {
              const fx = await this.fxService.getRates();
              fxRates = fx.rates;
            }
            price = this.fxService.convert(price, planCurrency, currency, fxRates);
            planCurrency = currency;
          } catch (e) {
            // Graceful fallback: return plan in original currency
            this.logger.warn(
              `FX conversion failed for ${planCurrency}→${currency}: ${(e as Error).message}`,
            );
          }
        }

        mappedPlans.push({
          name: plan.planName,
          price: parseFloat(price.toFixed(2)),
          currency: planCurrency,
          period: plan.period,
        });
      }

      result.push({
        id: row.id,
        name: row.name,
        slug: row.slug,
        category: row.category,
        iconUrl: row.iconUrl,
        plans: mappedPlans,
      });
    }

    // Cache full result (up to 50 items)
    await this.redis
      .set(cacheKey, JSON.stringify(result), 'EX', POPULAR_CACHE_TTL)
      .catch(() => {});

    return result.slice(0, limit);
  }

  async search(
    query: string,
    region: string,
  ): Promise<{ service: CatalogEntity; plans: CatalogPlan[] }> {
    const safeQuery = sanitizeQuery(query);
    if (!safeQuery) {
      throw new Error('Invalid catalog query');
    }
    const slug = slugify(safeQuery);
    const upperRegion = region.toUpperCase();
    let service = await this.findBySlug(slug);

    if (service) {
      const plans = await this.planRepo.find({
        where: { serviceId: service.id, region: upperRegion },
      });
      if (plans.length > 0 && this.hasStalePlans(plans)) {
        await this.enqueueLazyRefresh(service, upperRegion, plans);
      }
      return { service, plans };
    }

    const lockKey = `ai:lookup:lock:${slug}`;
    const acquired = await this.redis
      .set(lockKey, '1', 'EX', LOCK_TTL_SEC, 'NX')
      .catch(() => null);

    if (!acquired) {
      service = await this.waitForService(slug);
      if (service) {
        const plans = await this.planRepo.find({
          where: { serviceId: service.id, region: upperRegion },
        });
        return { service, plans };
      }
      throw new Error(`Catalog lookup timed out for ${slug}`);
    }

    try {
      const result = await this.ai.fullResearch(safeQuery, [upperRegion]);
      // Transactional: service + plans saved together, or neither.
      return await this.dataSource.transaction(async (manager) => {
        const svcRepo = manager.getRepository(CatalogEntity);
        const planRepo = manager.getRepository(CatalogPlan);
        const savedService = await this.persistServiceWithManager(
          svcRepo,
          result.service,
        );
        const savedPlans = await this.persistPlansWithManager(
          planRepo,
          savedService.id,
          result.plans,
        );
        return { service: savedService, plans: savedPlans };
      });
    } finally {
      await this.redis.del(lockKey).catch(() => {});
    }
  }

  private async findBySlug(slug: string): Promise<CatalogEntity | null> {
    return this.serviceRepo.findOne({ where: { slug } });
  }

  private hasStalePlans(plans: CatalogPlan[]): boolean {
    if (plans.length === 0) return false;
    // Consider a plan stale if it has no refresh timestamp at all, or the
    // oldest real timestamp is older than STALE_AGE_MS.
    let oldest = Infinity;
    for (const p of plans) {
      const ts = p.lastPriceRefreshAt?.getTime();
      if (!ts) return true; // never refreshed → definitely stale
      if (ts < oldest) oldest = ts;
    }
    return Date.now() - oldest > STALE_AGE_MS;
  }

  private async enqueueLazyRefresh(
    service: CatalogEntity,
    region: string,
    plans: CatalogPlan[],
  ): Promise<void> {
    const knownPlans = Array.from(new Set(plans.map((p) => p.planName)));
    await this.refreshQueue
      .add(
        'refreshServicePrices',
        {
          serviceId: service.id,
          serviceName: service.name,
          regions: [region],
          knownPlans,
        },
        {
          jobId: `refresh:${service.id}:${region}:lazy`,
          attempts: 1,
        },
      )
      .catch((e) =>
        this.logger.warn(`Failed to enqueue lazy refresh: ${e.message}`),
      );
  }

  private async waitForService(
    slug: string,
  ): Promise<CatalogEntity | null> {
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, LOCK_POLL_INTERVAL_MS));
      const lockStillHeld = await this.redis
        .get(`ai:lookup:lock:${slug}`)
        .catch(() => null);
      if (!lockStillHeld) {
        const svc = await this.findBySlug(slug);
        if (svc) return svc;
        return null;
      }
    }
    return null;
  }

  private async persistServiceWithManager(
    repo: Repository<CatalogEntity>,
    data: any,
  ): Promise<CatalogEntity> {
    const slug = slugify(data.slug || data.name);
    const existing = await repo.findOne({ where: { slug } });
    if (existing) {
      existing.researchCount = (existing.researchCount ?? 0) + 1;
      existing.lastResearchedAt = new Date();
      return repo.save(existing);
    }
    const category =
      (SubscriptionCategory as any)[data.category] ??
      SubscriptionCategory.OTHER;
    const entity = repo.create({
      slug,
      name: data.name,
      category,
      iconUrl: data.iconUrl ?? null,
      websiteUrl: data.websiteUrl ?? null,
      aliases: Array.isArray(data.aliases) ? data.aliases : [],
      lastResearchedAt: new Date(),
      researchCount: 1,
    });
    return repo.save(entity);
  }

  private async persistPlansWithManager(
    repo: Repository<CatalogPlan>,
    serviceId: string,
    plans: any[],
  ): Promise<CatalogPlan[]> {
    const now = new Date();
    const entities = plans.map((p) => {
      const period =
        (BillingPeriod as any)[p.period] ?? BillingPeriod.MONTHLY;
      const confidence =
        (PriceConfidence as any)[p.confidence] ?? PriceConfidence.HIGH;
      return repo.create({
        serviceId,
        region: String(p.region || '').toUpperCase(),
        planName: p.planName,
        price: String(p.price),
        currency: String(p.currency || '').toUpperCase(),
        period,
        trialDays: p.trialDays ?? null,
        features: Array.isArray(p.features) ? p.features : [],
        priceSource: PriceSource.AI_RESEARCH,
        priceConfidence: confidence,
        lastPriceRefreshAt: now,
      });
    });
    return repo.save(entities);
  }
}
