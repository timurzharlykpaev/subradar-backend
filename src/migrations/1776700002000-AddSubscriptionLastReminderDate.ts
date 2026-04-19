import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Track the last day a payment-reminder email was sent per subscription.
 * Prevents double-sends when the daily cron retries (e.g. server crash mid-loop)
 * or two pods race on the same schedule.
 */
export class AddSubscriptionLastReminderDate1776700002000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "lastReminderSentDate" DATE NULL DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP COLUMN IF EXISTS "lastReminderSentDate"
    `);
  }
}
