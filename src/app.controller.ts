import { Controller, Get } from '@nestjs/common';

/**
 * Root controller.
 *
 * NOTE: the /health endpoint lives in `HealthModule` (src/health/health.controller.ts)
 * and performs real DB + Redis liveness checks via @nestjs/terminus.
 * The old `/health` dummy here previously returned {status:"ok"} unconditionally
 * even when Postgres/Redis were down — that was removed to avoid false positives.
 */
@Controller()
export class AppController {
  /** Simple ping — unauthenticated, no side effects. */
  @Get('ping')
  ping() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
