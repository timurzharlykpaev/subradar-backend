import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ReconciliationService } from './reconciliation.service';

/**
 * Minimal sleep helper — used between RC API calls to stay well under
 * RC's published rate limit (roughly 10 rps per key). At 300ms per call
 * we top out at ~3.3 rps, so 200 candidates finish in ~60s worst case.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hourly reconciliation cron.
 *
 * Guarded by two independent feature flags so we can roll out safely:
 *  - `BILLING_RECONCILIATION_DRY_RUN=true` — run the scan + compute
 *    diffs but never write (no UPDATE, no audit, no outbox). Useful
 *    first step in production to validate the candidate pool + diff
 *    shapes.
 *  - `BILLING_RECONCILIATION_ENABLED=true` — enable real writes.
 *
 * If either flag is set the cron runs. If both are unset (default), the
 * handler logs and returns immediately — keeping the cron harmless in
 * environments that haven't opted in yet.
 */
@Injectable()
export class ReconciliationCron {
  private readonly logger = new Logger(ReconciliationCron.name);

  constructor(
    private readonly svc: ReconciliationService,
    private readonly cfg: ConfigService,
  ) {}

  @Cron('0 * * * *') // hourly on the hour
  async run(): Promise<void> {
    const enabled =
      this.cfg.get<string>('BILLING_RECONCILIATION_ENABLED') === 'true';
    const dryRun =
      this.cfg.get<string>('BILLING_RECONCILIATION_DRY_RUN') === 'true';

    if (!enabled && !dryRun) {
      this.logger.debug('Reconciliation disabled');
      return;
    }

    const suspicious = await this.svc.findSuspicious(200);
    this.logger.log(
      `Reconciliation: found ${suspicious.length} candidates (dryRun=${dryRun})`,
    );

    let changed = 0;
    for (const user of suspicious) {
      try {
        const did = await this.svc.reconcileOne(user, dryRun);
        if (did) changed++;
        // Rate-limit: RC caps at ~10 rps per key; 300ms keeps us safe
        // even while sharing the key with webhook lookups.
        await sleep(300);
      } catch (err: any) {
        this.logger.error(
          `Reconcile failed for ${user.id}: ${err?.message ?? err}`,
        );
      }
    }

    this.logger.log(
      `Reconciliation: ${changed} users ${dryRun ? 'would be' : 'were'} changed`,
    );
  }
}
