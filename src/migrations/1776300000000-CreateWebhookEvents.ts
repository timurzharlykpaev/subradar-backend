import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Idempotency table for billing webhooks.
 * Used by RevenueCat and Lemon Squeezy handlers — before processing a
 * webhook we INSERT (provider, event_id). A unique-key violation means
 * we have already processed this event and should return 200 immediately.
 */
export class CreateWebhookEvents1776300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider" varchar(32) NOT NULL,
        "event_id" varchar(191) NOT NULL,
        "processed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_webhook_events_provider_event_id"
        ON "webhook_events" ("provider", "event_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_events_provider"
        ON "webhook_events" ("provider")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhook_events_provider"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_webhook_events_provider_event_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_events"`);
  }
}
