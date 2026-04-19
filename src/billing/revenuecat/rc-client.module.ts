import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RevenueCatClient } from './rc-client.service';

/**
 * Standalone module for the RevenueCat REST API client.
 *
 * Intentionally NOT imported by BillingModule yet — wiring happens in
 * Task 5.3 together with ReconciliationService + cron. Until then this
 * module only makes `RevenueCatClient` discoverable to specs and any
 * consumer that explicitly imports `RevenueCatClientModule`.
 */
@Module({
  imports: [ConfigModule],
  providers: [RevenueCatClient],
  exports: [RevenueCatClient],
})
export class RevenueCatClientModule {}
