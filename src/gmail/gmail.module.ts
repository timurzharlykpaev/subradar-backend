import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { GmailService } from './gmail.service';
import { GmailScanService } from './gmail-scan.service';
import { GmailController } from './gmail.controller';
import { AiModule } from '../ai/ai.module';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AiModule,
    forwardRef(() => BillingModule),
    UsersModule,
  ],
  providers: [GmailService, GmailScanService],
  controllers: [GmailController],
  exports: [GmailService, GmailScanService],
})
export class GmailModule {}
