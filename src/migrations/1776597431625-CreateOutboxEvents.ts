import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Transactional outbox for side effects triggered by billing state
 * machine transitions (amplitude tracking, telegram alerts, FCM push,
 * future webhooks, etc).
 *
 * Writer enqueues rows in the same DB transaction as the state
 * transition; a background worker picks them up with FOR UPDATE SKIP
 * LOCKED, processes them, and marks as done/failed. This decouples
 * billing correctness from best-effort side effects.
 *
 * Indexes:
 *  - idx_outbox_pending — partial index over (status, next_attempt_at)
 *    restricted to work-in-progress rows; keeps the poller fast even
 *    when the table grows to millions of done rows.
 *  - idx_outbox_type_status — per-type monitoring queries + targeted
 *    replays after a consumer outage.
 */
export class CreateOutboxEvents1776597431625 implements MigrationInterface {
  name = 'CreateOutboxEvents1776597431625';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "outbox_status_enum" AS ENUM (
          'pending','processing','done','failed'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "outbox_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "type" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" "outbox_status_enum" NOT NULL DEFAULT 'pending',
        "attempts" int NOT NULL DEFAULT 0,
        "last_error" text NULL,
        "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "processed_at" TIMESTAMPTZ NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_pending"
        ON "outbox_events" ("status", "next_attempt_at")
        WHERE status IN ('pending','processing')
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_type_status"
        ON "outbox_events" ("type", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_type_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_pending"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_events"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "outbox_status_enum"`);
  }
}
