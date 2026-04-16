import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis.module';

/**
 * Liveness/readiness endpoint.
 *
 * Returns HTTP 200 only when:
 *  - Postgres responds to a ping within 2s
 *  - Redis responds to PING
 *
 * Any dependency failure surfaces as HTTP 503 with a structured payload —
 * allowing Docker healthcheck, load balancers, and uptime monitors to react
 * correctly instead of seeing a misleading {status:"ok"}.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 2000 }),
      () => this.checkRedis(),
    ]);
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`Unexpected PING response: ${pong}`);
      }
      return { redis: { status: 'up' } };
    } catch (e: any) {
      throw new ServiceUnavailableException({
        redis: { status: 'down', message: e?.message ?? 'unknown' },
      });
    }
  }
}
