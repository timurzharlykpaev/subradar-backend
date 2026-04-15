import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionCurrencyAndCatalogLinks1776240001000
  implements MigrationInterface
{
  name = 'AddSubscriptionCurrencyAndCatalogLinks1776240001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent: if a previous run (or an old synchronize pass) already
    // added the column, handle both states cleanly.
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "originalCurrency" VARCHAR(3)`,
    );
    // Backfill NULL rows from currency (which itself may be NULL on legacy rows).
    await queryRunner.query(
      `UPDATE "subscriptions"
       SET "originalCurrency" = COALESCE("originalCurrency", "currency", 'USD')
       WHERE "originalCurrency" IS NULL`,
    );
    // Safety net — guarantee NOT NULL for any future inserts without going through the app layer.
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ALTER COLUMN "originalCurrency" SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "catalogServiceId" UUID DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "catalogPlanId" UUID DEFAULT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_catalog_service_id" ON "subscriptions" ("catalogServiceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_catalog_plan_id" ON "subscriptions" ("catalogPlanId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_subscriptions_catalog_plan_id"`);
    await queryRunner.query(`DROP INDEX "IDX_subscriptions_catalog_service_id"`);
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "catalogPlanId"`);
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "catalogServiceId"`);
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "originalCurrency"`);
  }
}
