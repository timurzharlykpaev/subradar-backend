import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Request-level idempotency table (`Idempotency-Key` header pattern).
 *
 * `(userId, endpoint, key)` is unique — the same key from a single user on
 * a single endpoint must replay the cached response instead of re-executing.
 * `createdAt` index lets the daily cleanup cron prune rows older than 24h
 * efficiently.
 */
export class CreateIdempotencyKeys1777400100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "idempotency_keys" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL,
        "endpoint" varchar(64) NOT NULL,
        "key" varchar(128) NOT NULL,
        "statusCode" integer NOT NULL,
        "responseBody" jsonb NULL,
        "requestHash" varchar(64) NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_idempotency_user_endpoint_key"
        ON "idempotency_keys" ("userId", "endpoint", "key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_idempotency_created_at"
        ON "idempotency_keys" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_idempotency_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_idempotency_user_endpoint_key"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_keys"`);
  }
}
