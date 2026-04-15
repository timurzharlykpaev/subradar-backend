import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionCurrencyAndCatalogLinks1776240001000
  implements MigrationInterface
{
  name = 'AddSubscriptionCurrencyAndCatalogLinks1776240001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // originalCurrency: nullable first, backfill, then NOT NULL
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN "originalCurrency" VARCHAR(3)`,
    );
    await queryRunner.query(
      `UPDATE "subscriptions" SET "originalCurrency" = "currency" WHERE "originalCurrency" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ALTER COLUMN "originalCurrency" SET NOT NULL`,
    );

    // Catalog links (nullable — backfill is forward-only)
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN "catalogServiceId" UUID DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN "catalogPlanId" UUID DEFAULT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_subscriptions_catalog_service_id" ON "subscriptions" ("catalogServiceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscriptions_catalog_plan_id" ON "subscriptions" ("catalogPlanId")`,
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
