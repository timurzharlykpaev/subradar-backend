import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFxAndCatalogTables1776240002000 implements MigrationInterface {
  name = 'CreateFxAndCatalogTables1776240002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // FX snapshots
    await queryRunner.query(`
      CREATE TABLE "fx_rate_snapshots" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "base" VARCHAR(3) NOT NULL DEFAULT 'USD',
        "rates" JSONB NOT NULL,
        "fetchedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "source" VARCHAR(64) NOT NULL DEFAULT 'exchangerate.host',
        CONSTRAINT "PK_fx_rate_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_fx_rate_snapshots_fetchedAt" ON "fx_rate_snapshots" ("fetchedAt")`,
    );

    // Catalog: services
    await queryRunner.query(`
      CREATE TABLE "catalog_services" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "slug" VARCHAR(64) NOT NULL,
        "name" VARCHAR(128) NOT NULL,
        "category" "subscriptions_category_enum" NOT NULL DEFAULT 'OTHER',
        "iconUrl" TEXT,
        "websiteUrl" TEXT,
        "aliases" TEXT[] NOT NULL DEFAULT '{}',
        "lastResearchedAt" TIMESTAMPTZ,
        "researchCount" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_catalog_services" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_catalog_services_slug" ON "catalog_services" ("slug")`,
    );

    // Price source and confidence enums
    await queryRunner.query(`
      CREATE TYPE "catalog_plan_price_source_enum" AS ENUM ('AI_RESEARCH','USER_REPORTED','MANUAL')
    `);
    await queryRunner.query(`
      CREATE TYPE "catalog_plan_price_confidence_enum" AS ENUM ('HIGH','MEDIUM','LOW')
    `);

    // Catalog: plans
    await queryRunner.query(`
      CREATE TABLE "catalog_plans" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "serviceId" UUID NOT NULL,
        "region" VARCHAR(2) NOT NULL,
        "planName" VARCHAR(128) NOT NULL,
        "price" NUMERIC(19,4) NOT NULL,
        "currency" VARCHAR(3) NOT NULL,
        "period" "subscriptions_billingperiod_enum" NOT NULL,
        "trialDays" INTEGER,
        "features" TEXT[] NOT NULL DEFAULT '{}',
        "priceSource" "catalog_plan_price_source_enum" NOT NULL DEFAULT 'AI_RESEARCH',
        "priceConfidence" "catalog_plan_price_confidence_enum" NOT NULL DEFAULT 'HIGH',
        "lastPriceRefreshAt" TIMESTAMPTZ,
        CONSTRAINT "PK_catalog_plans" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_plans_service_region_plan" UNIQUE ("serviceId","region","planName"),
        CONSTRAINT "FK_catalog_plans_service" FOREIGN KEY ("serviceId") REFERENCES "catalog_services"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_catalog_plans_lastPriceRefreshAt" ON "catalog_plans" ("lastPriceRefreshAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_catalog_plans_service_region" ON "catalog_plans" ("serviceId","region")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "catalog_plans"`);
    await queryRunner.query(`DROP TYPE "catalog_plan_price_confidence_enum"`);
    await queryRunner.query(`DROP TYPE "catalog_plan_price_source_enum"`);
    await queryRunner.query(`DROP TABLE "catalog_services"`);
    await queryRunner.query(`DROP TABLE "fx_rate_snapshots"`);
  }
}
