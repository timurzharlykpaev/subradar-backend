import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnalysisTables1775200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "analysis_job_status_enum" AS ENUM ('QUEUED','COLLECTING','NORMALIZING','LOOKING_UP','ANALYZING','COMPLETED','FAILED')`);
    await queryRunner.query(`CREATE TYPE "analysis_trigger_type_enum" AS ENUM ('AUTO','MANUAL','CRON','SUBSCRIPTION_CHANGE')`);
    await queryRunner.query(`CREATE TYPE "service_source_enum" AS ENUM ('HARDCODED','WEB_SEARCH','MANUAL')`);

    await queryRunner.query(`
      CREATE TABLE "analysis_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "workspaceId" uuid,
        "status" "analysis_job_status_enum" NOT NULL DEFAULT 'QUEUED',
        "triggerType" "analysis_trigger_type_enum" NOT NULL,
        "inputHash" varchar(64) NOT NULL,
        "stageProgress" jsonb NOT NULL DEFAULT '{"collect":"pending","normalize":"pending","marketLookup":"pending","aiAnalyze":"pending","store":"pending"}',
        "tokensUsed" int NOT NULL DEFAULT 0,
        "webSearchesUsed" int NOT NULL DEFAULT 0,
        "resultId" uuid,
        "error" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "completedAt" TIMESTAMP,
        CONSTRAINT "PK_analysis_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_analysis_jobs_userId_status" ON "analysis_jobs" ("userId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_analysis_jobs_userId_createdAt" ON "analysis_jobs" ("userId", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE "analysis_results" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "workspaceId" uuid,
        "jobId" uuid NOT NULL,
        "inputHash" varchar(64) NOT NULL,
        "summary" text NOT NULL,
        "totalMonthlySavings" decimal(10,2) NOT NULL DEFAULT 0,
        "currency" varchar(3) NOT NULL DEFAULT 'USD',
        "recommendations" jsonb NOT NULL DEFAULT '[]',
        "duplicates" jsonb NOT NULL DEFAULT '[]',
        "overlaps" jsonb,
        "teamSavings" decimal(10,2),
        "memberCount" int,
        "subscriptionCount" int NOT NULL,
        "modelUsed" varchar(32) NOT NULL DEFAULT 'gpt-4o',
        "tokensUsed" int NOT NULL DEFAULT 0,
        "expiresAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analysis_results" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_analysis_results_userId_createdAt" ON "analysis_results" ("userId", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE "analysis_usage" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "periodStart" TIMESTAMP NOT NULL,
        "periodEnd" TIMESTAMP NOT NULL,
        "autoAnalysesUsed" int NOT NULL DEFAULT 0,
        "manualAnalysesUsed" int NOT NULL DEFAULT 0,
        "webSearchesUsed" int NOT NULL DEFAULT 0,
        "tokensUsed" int NOT NULL DEFAULT 0,
        "lastManualAt" TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analysis_usage" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_analysis_usage_userId_periodStart" UNIQUE ("userId", "periodStart")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "service_catalog" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "normalizedName" varchar(128) NOT NULL,
        "displayName" varchar(256) NOT NULL,
        "category" varchar(64),
        "logoUrl" varchar(512),
        "plans" jsonb NOT NULL DEFAULT '[]',
        "alternatives" jsonb NOT NULL DEFAULT '[]',
        "source" "service_source_enum" NOT NULL DEFAULT 'HARDCODED',
        "lastVerifiedAt" TIMESTAMP,
        "expiresAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_service_catalog" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_service_catalog_normalizedName" UNIQUE ("normalizedName")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "service_catalog"`);
    await queryRunner.query(`DROP TABLE "analysis_usage"`);
    await queryRunner.query(`DROP TABLE "analysis_results"`);
    await queryRunner.query(`DROP TABLE "analysis_jobs"`);
    await queryRunner.query(`DROP TYPE "service_source_enum"`);
    await queryRunner.query(`DROP TYPE "analysis_trigger_type_enum"`);
    await queryRunner.query(`DROP TYPE "analysis_job_status_enum"`);
  }
}
