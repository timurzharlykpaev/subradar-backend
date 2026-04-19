import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { OutboxService } from '../outbox/outbox.service';

/**
 * Operational metrics for the billing subsystem.
 *
 * Exposes the webhook + outbox counters that our on-call playbooks care
 * about (failure rate, queue depth) so external monitors — UptimeRobot,
 * Better Stack, or an internal dashboard — can poll without a Postgres
 * connection.
 *
 * Auth: a shared static token via `BILLING_HEALTH_TOKEN`. This is
 * deliberately NOT wired to JwtAuthGuard / user accounts — the endpoint
 * must work from an alerting pipeline that has no user context. If the
 * token is unset, every request is rejected (fail-closed).
 *
 * Route is mounted outside the /billing prefix (`/health/billing`) so it
 * lives alongside any future `/health/*` siblings.
 */
@ApiTags('health')
@Controller('health/billing')
export class BillingHealthController {
  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookRepo: Repository<WebhookEvent>,
    private readonly outbox: OutboxService,
    private readonly cfg: ConfigService,
  ) {}

  @Get()
  async get(@Headers('authorization') authorization: string | undefined) {
    const token = this.cfg.get<string>('BILLING_HEALTH_TOKEN');
    // Fail-closed: if no token is configured we never expose metrics.
    if (!token || authorization !== `Bearer ${token}`) {
      throw new UnauthorizedException();
    }

    const dayAgo = new Date(Date.now() - 86_400_000);
    const [total, failed, outboxStats] = await Promise.all([
      this.webhookRepo.count({ where: { processedAt: MoreThanOrEqual(dayAgo) } }),
      this.webhookRepo.count({
        where: {
          processedAt: MoreThanOrEqual(dayAgo),
          error: Not(IsNull()),
        },
      }),
      this.outbox.stats(),
    ]);

    return {
      webhookEvents24h: total,
      webhookFailures24h: failed,
      webhookFailureRate: total > 0 ? failed / total : 0,
      outboxPending: outboxStats.pending,
      outboxFailed: outboxStats.failed,
    };
  }
}
