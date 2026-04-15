import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { ClientErrorController } from './common/client-error.controller';
import { TelegramAlertService } from './common/telegram-alert.service';
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

@Module({
  controllers: [AppController, ClientErrorController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
          synchronize: !isProd, // dev: auto-sync; prod: use migrations
          migrations: [__dirname + '/migrations/*.{ts,js}'],
          migrationsRun: isProd, // в проде — автозапуск миграций при старте
          logging: false,
          ssl: isProd ? { rejectUnauthorized: false } : undefined,
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
    ScheduleModule.forRoot(),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // global rate limiting
    TelegramAlertService,
  ],
  exports: [TelegramAlertService],
})
export class AppModule {}
