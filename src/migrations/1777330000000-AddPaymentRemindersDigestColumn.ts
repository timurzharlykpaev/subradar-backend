import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-user idempotency marker for the daily payment-reminder digest.
 *
 * Before this column the cron sent one push + one email per matched
 * subscription, so a user with 5 due subs got 5 pushes and 5 emails on
 * the same day — straight into spam-territory once the user crosses
 * ~10 subs. The cron now bundles every same-day match into a single
 * digest per user; this column gates that digest the same way the
 * existing per-sub `lastReminderSentDate` gates the legacy path.
 */
export class AddPaymentRemindersDigestColumn1777330000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "lastPaymentRemindersSentAt" TIMESTAMP NULL DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "lastPaymentRemindersSentAt"
    `);
  }
}
