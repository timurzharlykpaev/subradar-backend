import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
          synchronize: !isProd,
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
        if (redisUrl) return { url: redisUrl } as any;
        return {
          redis: {
            host: cfg.get('REDIS_HOST', 'localhost'),
            port: cfg.get<number>('REDIS_PORT', 6379),
            password: cfg.get('REDIS_PASSWORD') || undefined,
          },
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
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
