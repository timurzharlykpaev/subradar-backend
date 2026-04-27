import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-user "last sent" markers for the notification cron jobs that
 * previously had no DB-side dedupe. Without these, a container restart
 * or a multi-pod deploy would re-fire trial / pro-expiration / win-back
 * / weekly digest / monthly report on the same day.
 *
 * The columns mirror the existing `weeklyDigestSentAt` pattern — TIMESTAMP
 * NULL DEFAULT NULL — and the cron handlers compare against `now() - N
 * hours` to decide whether to send. Idempotent (`ADD COLUMN IF NOT EXISTS`)
 * so partial-apply states on dev don't wedge.
 */
export class AddNotificationIdempotencyColumns1777310000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "lastTrialPushAt" TIMESTAMP NULL DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS "lastProExpirationPushAt" TIMESTAMP NULL DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS "lastProExpirationEmailAt" TIMESTAMP NULL DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS "lastWeeklyPushDigestAt" TIMESTAMP NULL DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS "lastWinBackPushAt" TIMESTAMP NULL DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS "lastMonthlyReportSentAt" TIMESTAMP NULL DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "lastTrialPushAt",
      DROP COLUMN IF EXISTS "lastProExpirationPushAt",
      DROP COLUMN IF EXISTS "lastProExpirationEmailAt",
      DROP COLUMN IF EXISTS "lastWeeklyPushDigestAt",
      DROP COLUMN IF EXISTS "lastWinBackPushAt",
      DROP COLUMN IF EXISTS "lastMonthlyReportSentAt"
    `);
  }
}
