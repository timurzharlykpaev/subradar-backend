import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { DataSource, Repository } from 'typeorm';
import type { Queue } from 'bull';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis.module';
import { CatalogService as CatalogEntity } from './entities/catalog-service.entity';
import {
  CatalogPlan,
  PriceConfidence,
  PriceSource,
} from './entities/catalog-plan.entity';
import { AiCatalogProvider } from './ai-catalog.provider';
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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue('catalog-refresh') private readonly refreshQueue: Queue,
  ) {}

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
