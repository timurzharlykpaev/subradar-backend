import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Repository } from 'typeorm';
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @InjectRepository(CatalogEntity)
    private readonly serviceRepo: Repository<CatalogEntity>,
    @InjectRepository(CatalogPlan)
    private readonly planRepo: Repository<CatalogPlan>,
    private readonly ai: AiCatalogProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue('catalog-refresh') private readonly refreshQueue: Queue,
  ) {}

  async search(
    query: string,
    region: string,
  ): Promise<{ service: CatalogEntity; plans: CatalogPlan[] }> {
    const slug = slugify(query);
    let service = await this.findBySlug(slug);

    if (service) {
      const plans = await this.planRepo.find({
        where: { serviceId: service.id, region },
      });
      if (plans.length > 0 && this.hasStalePlans(plans)) {
        await this.enqueueLazyRefresh(service, region, plans);
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
          where: { serviceId: service.id, region },
        });
        return { service, plans };
      }
      throw new Error(`Catalog lookup timed out for ${slug}`);
    }

    try {
      const result = await this.ai.fullResearch(query, [region]);
      service = await this.persistService(result.service);
      const plans = await this.persistPlans(service.id, result.plans);
      return { service, plans };
    } finally {
      await this.redis.del(lockKey).catch(() => {});
    }
  }

  private async findBySlug(slug: string): Promise<CatalogEntity | null> {
    return this.serviceRepo.findOne({ where: { slug } });
  }

  private hasStalePlans(plans: CatalogPlan[]): boolean {
    const oldest = plans.reduce(
      (min, p) =>
        Math.min(min, p.lastPriceRefreshAt?.getTime() ?? 0),
      Infinity,
    );
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

  private async persistService(data: any): Promise<CatalogEntity> {
    const slug = slugify(data.slug || data.name);
    const existing = await this.findBySlug(slug);
    if (existing) {
      existing.researchCount = (existing.researchCount ?? 0) + 1;
      existing.lastResearchedAt = new Date();
      return this.serviceRepo.save(existing);
    }
    const category = (SubscriptionCategory as any)[data.category] ??
      SubscriptionCategory.OTHER;
    const entity = this.serviceRepo.create({
      slug,
      name: data.name,
      category,
      iconUrl: data.iconUrl ?? null,
      websiteUrl: data.websiteUrl ?? null,
      aliases: Array.isArray(data.aliases) ? data.aliases : [],
      lastResearchedAt: new Date(),
      researchCount: 1,
    });
    return this.serviceRepo.save(entity);
  }

  private async persistPlans(
    serviceId: string,
    plans: any[],
  ): Promise<CatalogPlan[]> {
    const now = new Date();
    const saved: CatalogPlan[] = [];
    for (const p of plans) {
      const period =
        (BillingPeriod as any)[p.period] ?? BillingPeriod.MONTHLY;
      const confidence =
        (PriceConfidence as any)[p.confidence] ?? PriceConfidence.HIGH;
      const entity = this.planRepo.create({
        serviceId,
        region: p.region,
        planName: p.planName,
        price: String(p.price),
        currency: p.currency,
        period,
        trialDays: p.trialDays ?? null,
        features: Array.isArray(p.features) ? p.features : [],
        priceSource: PriceSource.AI_RESEARCH,
        priceConfidence: confidence,
        lastPriceRefreshAt: now,
      });
      saved.push(await this.planRepo.save(entity));
    }
    return saved;
  }
}
