import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `workspaceId` to `reports` so the same table can hold both
 * personal reports (workspaceId = NULL — the long-standing default)
 * and team-scoped reports issued by a workspace owner.
 *
 * Idempotent — uses IF NOT EXISTS so partial-apply and dev-prod
 * convergence don't wedge on a re-run. No FK on workspaceId because
 * the reports are intentionally retained even if the workspace is
 * deleted (audit / billing trail). Owner deletion already cascades
 * via the existing User FK.
 */
export class AddReportWorkspaceId1777500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reports"
        ADD COLUMN IF NOT EXISTS "workspaceId" uuid NULL;
    `);

    // Composite index for the typical "list team reports for workspace X
    // ordered by recency" query the new endpoint will run.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_reports_workspaceId_createdAt"
        ON "reports" ("workspaceId", "createdAt" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_reports_workspaceId_createdAt";`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP COLUMN IF EXISTS "workspaceId";`,
    );
  }
}
