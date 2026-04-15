import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRegionAndDisplayCurrency1776240000000 implements MigrationInterface {
  name = 'AddUserRegionAndDisplayCurrency1776240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "region" VARCHAR(2) NOT NULL DEFAULT 'US'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "displayCurrency" VARCHAR(3) NOT NULL DEFAULT 'USD'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezoneDetected" VARCHAR(64) DEFAULT NULL`,
    );

    // Backfill from existing country/defaultCurrency if present
    await queryRunner.query(`
      UPDATE "users"
      SET "region" = UPPER(SUBSTRING("country" FROM 1 FOR 2))
      WHERE "country" IS NOT NULL AND LENGTH("country") >= 2
    `);
    await queryRunner.query(`
      UPDATE "users"
      SET "displayCurrency" = UPPER("defaultCurrency")
      WHERE "defaultCurrency" IS NOT NULL AND LENGTH("defaultCurrency") = 3
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "timezoneDetected"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "displayCurrency"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "region"`);
  }
}
