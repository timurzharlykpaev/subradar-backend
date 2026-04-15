import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FxRateSnapshot } from './entities/fx-rate-snapshot.entity';
import { FxService } from './fx.service';
import { FxCron } from './fx.cron';
import { FxController } from './fx.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FxRateSnapshot])],
  providers: [FxService, FxCron],
  controllers: [FxController],
  exports: [FxService],
})
export class FxModule {}
