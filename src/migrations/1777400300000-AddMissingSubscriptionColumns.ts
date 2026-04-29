import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catch-up migration for `subscriptions` columns that exist on the entity
 * but never made it into a real migration on the dev DB (the dev DB was
 * historically synced via TypeORM `synchronize:true` and bootstrapped
 * later from a snapshot — see bootstrap-dev-migrations.yml workflow).
 *
 * The container started crashing after the Phase 2 deploy because TypeORM
 * autoload introspects every entity column on first query and Postgres
 * raises `errorMissingColumn` on `Subscription.originalCurrency`. The
 * other three columns are silently absent on prod too, so we add them
 * idempotently.
 *
 * Columns added (all idempotent — IF NOT EXISTS):
 *   - originalCurrency  varchar(3)  NOT NULL DEFAULT 'USD'
 *     (entity declares it NOT NULL, default 'USD' for legacy rows)
 *   - catalogServiceId  uuid        NULL
 *   - catalogPlanId     uuid        NULL
 *   - lastReminderSentDate date     NULL
 */
export class AddMissingSubscriptionColumns1777400300000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD COLUMN IF NOT EXISTS "originalCurrency" varchar(3) NOT NULL DEFAULT 'USD',
        ADD COLUMN IF NOT EXISTS "catalogServiceId" uuid NULL,
        ADD COLUMN IF NOT EXISTS "catalogPlanId" uuid NULL,
        ADD COLUMN IF NOT EXISTS "lastReminderSentDate" date NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        DROP COLUMN IF EXISTS "lastReminderSentDate",
        DROP COLUMN IF EXISTS "catalogPlanId",
        DROP COLUMN IF EXISTS "catalogServiceId",
        DROP COLUMN IF EXISTS "originalCurrency"
    `);
  }
}
