import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { CatalogService as CatalogEntity } from './entities/catalog-service.entity';
import { CatalogPlan } from './entities/catalog-plan.entity';
import { AiCatalogProvider } from './ai-catalog.provider';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogRefreshProcessor } from './catalog-refresh.processor';
import { CatalogRefreshCron } from './catalog-refresh.cron';
import { FxModule } from '../fx/fx.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CatalogEntity, CatalogPlan]),
    BullModule.registerQueue({
      name: 'catalog-refresh',
      defaultJobOptions: {
        removeOnComplete: { age: 24 * 3600, count: 100 },
        removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
      },
    }),
    FxModule,
    UsersModule,
  ],
  providers: [
    CatalogService,
    AiCatalogProvider,
    CatalogRefreshProcessor,
    CatalogRefreshCron,
    {
      provide: 'OPENAI_CLIENT',
      useFactory: (config: ConfigService) =>
        new OpenAI({ apiKey: config.get<string>('OPENAI_API_KEY') }),
      inject: [ConfigService],
    },
  ],
  controllers: [CatalogController],
  exports: [CatalogService, TypeOrmModule],
})
export class CatalogModule {}
