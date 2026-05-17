import { Global, Module } from '@nestjs/common';
import { AntivirusService } from './antivirus.service';

/**
 * Global antivirus module — exposes AntivirusService for any upload-path
 * service / controller to scan untrusted file bytes before storage or
 * downstream processing. AuditService comes in via the @Global() audit
 * module so no extra imports are required here.
 */
@Global()
@Module({
  providers: [AntivirusService],
  exports: [AntivirusService],
})
export class AntivirusModule {}
