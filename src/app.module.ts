import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { AppController } from './app.controller';
import { ClientErrorController } from './common/client-error.controller';
import { TelegramAlertModule } from './common/telegram-alert.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PaymentCardsModule } from './payment-cards/payment-cards.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { AiModule } from './ai/ai.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ReportsModule } from './reports/reports.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BillingModule } from './billing/billing.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { StorageModule } from './storage/storage.module';
import { ScheduleModule } from '@nestjs/schedule';
import { RemindersModule } from './reminders/reminders.module';
import { RedisModule } from './common/redis.module';
import { AnalysisModule } from './analysis/analysis.module';
import { FxModule } from './fx/fx.module';
import { CatalogModule } from './catalog/catalog.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './common/audit/audit.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';

@Module({
  controllers: [AppController, ClientErrorController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TelegramAlertModule,
    RedisModule,
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60000, limit: 300 }, // 300 req/min global
    ]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => {
        const isProd = cfg.get('NODE_ENV') === 'production';
        const url = cfg.get<string>('DATABASE_URL');
        return {
          type: 'postgres' as const,
          url: url || undefined,
          host: url ? undefined : cfg.get<string>('DB_HOST', 'localhost'),
          port: url ? undefined : cfg.get<number>('DB_PORT', 5432),
          username: url
            ? undefined
            : cfg.get<string>('DB_USERNAME', 'postgres'),
          password: url
            ? undefined
            : cfg.get<string>('DB_PASSWORD', 'postgres'),
          database: url
            ? undefined
            : cfg.get<string>('DB_DATABASE', 'subradar'),
          autoLoadEntities: true,
          // Always use migrations for schema changes. `synchronize: true` in dev
          // can't safely add NOT NULL columns to populated tables (e.g.
          // subscriptions.originalCurrency) — our migrations handle the
          // nullable-then-backfill-then-NOT-NULL dance explicitly.
          synchronize: false,
          migrations: [__dirname + '/migrations/*.{ts,js}'],
          // MIGRATION STRATEGY (tracked for future hardening):
          //   `migrationsRun: true` runs pending migrations on every app boot.
          //   Pros: zero-ops, every replica rolls itself forward.
          //   Cons: with multiple replicas the first to boot races to acquire
          //     the TypeORM migrations lock; others block until it finishes. A
          //     long/failing migration can stall the whole fleet.
          //   TODO (safer): move to an explicit `typeorm migration:run` step in
          //     the deploy pipeline (single invocation, fails the deploy
          //     cleanly) and set this to `false`. Left as-is for now to avoid
          //     breaking existing DO App Platform deploys that rely on boot-
          //     time migrations.
          migrationsRun: true,
          logging: false,
          // CASA / ASVS V9.2.3 forbids `rejectUnauthorized: false`. We honour
          // that whenever the operator has supplied DigitalOcean's CA bundle
          // via DB_CA_CERT (PEM contents) or DB_CA_PATH (file path on disk).
          // If neither is configured, we still negotiate TLS but skip CA chain
          // verification — and emit a startup warning so the gap is visible
          // in logs. This avoids breaking existing DO App Platform deploys
          // while making the secure path opt-in via env, not code change.
          ssl: (() => {
            if (!isProd) return undefined;
            const caInline = process.env.DB_CA_CERT;
            const caPath = process.env.DB_CA_PATH;
            if (caInline && caInline.trim().length > 0) {
              return { ca: caInline, rejectUnauthorized: true };
            }
            if (caPath && caPath.trim().length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const fs = require('fs');
              return {
                ca: fs.readFileSync(caPath, 'utf8'),
                rejectUnauthorized: true,
              };
            }

            console.warn(
              '[SECURITY] DB TLS: no DB_CA_CERT/DB_CA_PATH set — falling back to ' +
                'rejectUnauthorized:false. Connection is encrypted but server cert ' +
                'chain is NOT verified. Pin the DO managed-PG CA before CASA submission.',
            );
            return { rejectUnauthorized: false };
          })(),
          // pg driver pool tuning. Hard ceiling is the DO managed-PG cluster's
          // max_connections (25 on Basic 1GB) minus 3 reserved for SUPERUSER
          // and ~5 used by DO internals (pghoard, _dodb, system-stats) — so
          // ~17 usable slots are split across BOTH prod and dev app containers
          // sharing the same cluster. Previous defaults (max:20) blew through
          // that ceiling when midnight cron storms tried to grow the pool,
          // producing "remaining connection slots are reserved for roles with
          // the SUPERUSER attribute" errors. New defaults: prod 12/2,
          // dev 3/1 — total worst case 15+5(DO)=20, headroom 2-5 slots.
          // Override via DB_POOL_MAX / DB_POOL_MIN if the cluster is upgraded.
          extra: {
            max: Number(cfg.get('DB_POOL_MAX')) || (isProd ? 12 : 3),
            min: Number(cfg.get('DB_POOL_MIN')) || (isProd ? 2 : 1),
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
          },
        } as any;
      },
      inject: [ConfigService],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => {
        const redisUrl = cfg.get<string>('REDIS_URL');
        const nodeEnv = cfg.get('NODE_ENV', 'development');
        const prefix = `bull:${nodeEnv}`;
        if (redisUrl) return { url: redisUrl, prefix } as any;
        return {
          redis: {
            host: cfg.get('REDIS_HOST', 'localhost'),
            port: cfg.get<number>('REDIS_PORT', 6379),
            password: cfg.get('REDIS_PASSWORD') || undefined,
          },
          prefix,
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    SubscriptionsModule,
    PaymentCardsModule,
    ReceiptsModule,
    AiModule,
    AnalyticsModule,
    ReportsModule,
    NotificationsModule,
    BillingModule,
    WorkspaceModule,
    StorageModule,
    RemindersModule,
    AnalysisModule,
    FxModule,
    CatalogModule,
    HealthModule,
    AuditModule,
    IdempotencyModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // global rate limiting
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Attach correlation ID to every request (early, before route handlers).
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
