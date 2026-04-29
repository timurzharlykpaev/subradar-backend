import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catch-up migration for entity columns that exist in code but never had
 * a real migration on dev (the dev DB was historically kept in sync via
 * TypeORM `synchronize:true` and bootstrapped from a snapshot, see
 * bootstrap-dev-migrations.yml). After Phase 2 deploy the stricter
 * column introspection started raising `column User.region does not exist`
 * on every SELECT against `users`, plus matching gaps on `workspaces`.
 *
 * Idempotent ADD COLUMN IF NOT EXISTS so the same migration runs cleanly
 * on dev (where the columns are missing) and prod (where most are
 * already present from the original synchronize-style schema).
 */
export class AddMissingUserColumns1777400400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "region" varchar(2) NOT NULL DEFAULT 'US',
        ADD COLUMN IF NOT EXISTS "displayCurrency" varchar(3) NOT NULL DEFAULT 'USD',
        ADD COLUMN IF NOT EXISTS "timezoneDetected" varchar(64) NULL,
        ADD COLUMN IF NOT EXISTS "weeklyDigestSentAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "lastTrialPushAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "lastProExpirationPushAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "lastProExpirationEmailAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "lastWeeklyPushDigestAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "lastWinBackPushAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "lastMonthlyReportSentAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "lastPaymentRemindersSentAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "refreshTokenIssuedAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "downgradedAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "invitedByUserId" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "workspaces"
        ADD COLUMN IF NOT EXISTS "expiredAt" timestamp NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workspaces"
        DROP COLUMN IF EXISTS "expiredAt"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "invitedByUserId",
        DROP COLUMN IF EXISTS "downgradedAt",
        DROP COLUMN IF EXISTS "refreshTokenIssuedAt",
        DROP COLUMN IF EXISTS "lastPaymentRemindersSentAt",
        DROP COLUMN IF EXISTS "lastMonthlyReportSentAt",
        DROP COLUMN IF EXISTS "lastWinBackPushAt",
        DROP COLUMN IF EXISTS "lastWeeklyPushDigestAt",
        DROP COLUMN IF EXISTS "lastProExpirationEmailAt",
        DROP COLUMN IF EXISTS "lastProExpirationPushAt",
        DROP COLUMN IF EXISTS "lastTrialPushAt",
        DROP COLUMN IF EXISTS "weeklyDigestSentAt",
        DROP COLUMN IF EXISTS "timezoneDetected",
        DROP COLUMN IF EXISTS "displayCurrency",
        DROP COLUMN IF EXISTS "region"
    `);
  }
}
