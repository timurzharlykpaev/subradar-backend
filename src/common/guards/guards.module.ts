import { Module } from '@nestjs/common';
import { EffectiveAccessModule } from '../../billing/effective-access/effective-access.module';
import { PlanGuard } from './plan.guard';

/**
 * GuardsModule — bundles shared cross-cutting guards so feature
 * modules can simply `imports: [GuardsModule]` instead of re-wiring
 * the dependency graph of EffectiveAccessResolver everywhere.
 *
 * Currently exports:
 * - {@link PlanGuard} — capability-based plan gate.
 *
 * New shared guards (e.g. rate-limiting, CSRF) should be added here
 * too rather than copy-pasted into feature modules.
 */
@Module({
  imports: [EffectiveAccessModule],
  providers: [PlanGuard],
  // Re-export EffectiveAccessModule so PlanGuard's EffectiveAccessResolver
  // dependency resolves in consumer modules (e.g. WorkspaceModule). Without
  // the re-export the guard is visible but its dependency isn't, causing
  // UnknownDependenciesException at boot.
  exports: [PlanGuard, EffectiveAccessModule],
})
export class GuardsModule {}
