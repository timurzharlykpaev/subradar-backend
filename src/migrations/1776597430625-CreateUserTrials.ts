import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * New canonical trials table — replaces the legacy
 * users.trialUsed / trialStartDate / trialEndDate trio which cannot
 * express "who granted the trial", the source (RC intro offer vs
 * backend magic-link win-back), or the original transaction id.
 *
 * Unique(user_id) enforces 1-trial-per-user business rule at DB level
 * so the anti-abuse check can never be bypassed by a race condition.
 *
 * On up() we also backfill existing trials from the legacy columns
 * so the new table is immediately consistent with reality. Legacy
 * columns are NOT dropped in this migration — we keep them for one
 * release as a rollback safety net.
 */
export class CreateUserTrials1776597430625 implements MigrationInterface {
  name = 'CreateUserTrials1776597430625';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "trial_source_enum" AS ENUM (
          'revenuecat_intro','backend','lemon_squeezy'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "trial_plan_enum" AS ENUM ('pro','organization');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_trials" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
        "source" "trial_source_enum" NOT NULL,
        "plan" "trial_plan_enum" NOT NULL,
        "started_at" TIMESTAMPTZ NOT NULL,
        "ends_at" TIMESTAMPTZ NOT NULL,
        "consumed" boolean NOT NULL DEFAULT true,
        "original_transaction_id" text NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_user_trials_ends_at" ON "user_trials"("ends_at")`,
    );

    // Backfill from legacy users.trial* columns. Guarded by IF EXISTS
    // in case an environment somehow never had these columns — we do
    // not want this migration to hard-fail on schema drift.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users'
            AND column_name IN ('trialStartDate','trialEndDate','trialUsed')
          GROUP BY table_name
          HAVING COUNT(*) = 3
        ) THEN
          INSERT INTO "user_trials" (user_id, source, plan, started_at, ends_at, consumed)
          SELECT id, 'backend', 'pro', "trialStartDate", "trialEndDate", true
          FROM "users"
          WHERE "trialStartDate" IS NOT NULL
            AND "trialEndDate" IS NOT NULL
            AND "trialUsed" = true
          ON CONFLICT (user_id) DO NOTHING;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_trials_ends_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_trials"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "trial_plan_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "trial_source_enum"`);
  }
}
