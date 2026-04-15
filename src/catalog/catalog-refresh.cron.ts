import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

const TOP_N = 50;
const WEEKLY_BUDGET_CAP = 1000;

interface TopServiceRow {
  id: string;
  name: string;
  knownPlans: string[];
}

@Injectable()
export class CatalogRefreshCron {
  private readonly logger = new Logger(CatalogRefreshCron.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue('catalog-refresh') private readonly queue: Queue,
  ) {}

  @Cron('0 4 * * 1')
  async refreshTopServices(): Promise<void> {
    const regionRows: Array<{ region: string }> = await this.dataSource.query(
      `SELECT DISTINCT "region" FROM "users" WHERE "region" IS NOT NULL`,
    );
    const regions = regionRows.map((r) => r.region);
    if (regions.length === 0) {
      this.logger.log('No active regions, skipping catalog refresh');
      return;
    }

    const topServices: TopServiceRow[] = await this.dataSource.query(
      `
      SELECT
        c."id",
        c."name",
        COALESCE(
          array_agg(DISTINCT cp."planName") FILTER (WHERE cp."planName" IS NOT NULL),
          '{}'
        ) AS "knownPlans"
      FROM "catalog_services" c
      LEFT JOIN "subscriptions" s ON s."catalogServiceId" = c."id"
      LEFT JOIN "catalog_plans" cp ON cp."serviceId" = c."id"
      GROUP BY c."id"
      ORDER BY COUNT(s."id") DESC
      LIMIT $1
      `,
      [TOP_N],
    );

    let queued = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const svc of topServices) {
      if (queued >= WEEKLY_BUDGET_CAP) break;
      if (!svc.knownPlans || svc.knownPlans.length === 0) continue;
      await this.queue.add(
        'refreshServicePrices',
        {
          serviceId: svc.id,
          serviceName: svc.name,
          regions,
          knownPlans: svc.knownPlans,
        },
        {
          jobId: `refresh:${svc.id}:${today}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
      queued++;
    }
    this.logger.log(
      `Enqueued ${queued} catalog refresh jobs across ${regions.length} regions`,
    );
  }
}
