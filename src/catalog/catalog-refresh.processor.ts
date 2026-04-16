import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { CatalogPlan } from './entities/catalog-plan.entity';
import { CatalogService as CatalogEntity } from './entities/catalog-service.entity';
import { AiCatalogProvider } from './ai-catalog.provider';

export interface RefreshJobData {
  serviceId: string;
  serviceName?: string;
  regions: string[];
  knownPlans: string[];
}

@Processor('catalog-refresh')
export class CatalogRefreshProcessor {
  private readonly logger = new Logger(CatalogRefreshProcessor.name);

  constructor(
    @InjectRepository(CatalogPlan)
    private readonly planRepo: Repository<CatalogPlan>,
    @InjectRepository(CatalogEntity)
    private readonly serviceRepo: Repository<CatalogEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ai: AiCatalogProvider,
  ) {}

  @Process('refreshServicePrices')
  async handleRefresh(job: Job<RefreshJobData>): Promise<void> {
    const { serviceId, regions, knownPlans } = job.data;
    let serviceName = job.data.serviceName;
    if (!serviceName) {
      const svc = await this.serviceRepo.findOne({ where: { id: serviceId } });
      if (!svc) {
        this.logger.warn(`Service ${serviceId} not found, skipping refresh`);
        return;
      }
      serviceName = svc.name;
    }

    let result;
    try {
      result = await this.ai.priceRefresh(serviceName, regions, knownPlans);
    } catch (e: any) {
      this.logger.warn(
        `priceRefresh failed for ${serviceName}: ${e.message}`,
      );
      return;
    }

    const plans = await this.planRepo.find({ where: { serviceId } });
    const now = new Date();
    const diffs: string[] = [];

    // Batch upsert inside a single transaction. We use a raw INSERT ... ON
    // CONFLICT statement keyed on the unique index (serviceId, region, planName)
    // so concurrent refresh jobs (e.g. two workers picking up the same job due
    // to a retry) won't race on TypeORM's insert-or-update detection.
    await this.dataSource.transaction(async (em) => {
      for (const priceEntry of result.prices ?? []) {
        const region = String(priceEntry.region || '').toUpperCase();
        const planName = priceEntry.planName;
        const plan = plans.find(
          (p) => p.region === region && p.planName === planName,
        );
        if (!plan) continue;

        const newPrice = String(priceEntry.price);
        const newCurrency = String(priceEntry.currency || '').toUpperCase();
        const oldPrice = plan.price;

        await em.query(
          `
          INSERT INTO "catalog_plans"
            ("id", "serviceId", "region", "planName", "price", "currency",
             "period", "features", "priceSource", "priceConfidence",
             "lastPriceRefreshAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT ("serviceId", "region", "planName")
          DO UPDATE SET
            "price" = EXCLUDED."price",
            "currency" = EXCLUDED."currency",
            "lastPriceRefreshAt" = EXCLUDED."lastPriceRefreshAt"
          `,
          [
            plan.id,
            plan.serviceId,
            plan.region,
            plan.planName,
            newPrice,
            newCurrency,
            plan.period,
            plan.features ?? [],
            plan.priceSource,
            plan.priceConfidence,
            now,
          ],
        );

        if (oldPrice !== newPrice) {
          diffs.push(
            `${plan.region}/${plan.planName}: ${oldPrice} → ${newPrice} ${newCurrency}`,
          );
        }
      }
    });

    for (const diff of diffs) {
      this.logger.log(`${serviceName} ${diff}`);
    }
  }
}
