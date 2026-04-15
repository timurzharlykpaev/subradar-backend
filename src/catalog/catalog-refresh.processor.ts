import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    for (const priceEntry of result.prices ?? []) {
      const plan = plans.find(
        (p) =>
          p.region === priceEntry.region &&
          p.planName === priceEntry.planName,
      );
      if (!plan) continue;
      const oldPrice = plan.price;
      plan.price = String(priceEntry.price);
      plan.currency = priceEntry.currency;
      plan.lastPriceRefreshAt = now;
      await this.planRepo.save(plan);
      if (oldPrice !== plan.price) {
        this.logger.log(
          `${serviceName} ${plan.region}/${plan.planName}: ${oldPrice} → ${plan.price} ${plan.currency}`,
        );
      }
    }
  }
}
