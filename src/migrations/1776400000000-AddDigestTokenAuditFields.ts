import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds idempotency + audit support:
 *  - users.weekly_digest_sent_at — last time a weekly digest email was sent
 *    (prevents duplicate sends if the cron fires twice within a few minutes)
 *  - users.refresh_token_issued_at — absolute expiry enforcement for refresh
 *    tokens (must not outlive JWT_REFRESH_EXPIRES_IN even if signing works)
 *  - audit_logs table — append-only log of sensitive operations (account
 *    deletion, plan changes via webhook, admin actions, billing transitions)
 */
export class AddDigestTokenAuditFields1776400000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // users.weekly_digest_sent_at
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "weeklyDigestSentAt" TIMESTAMP NULL
    `);

    // users.refresh_token_issued_at
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "refreshTokenIssuedAt" TIMESTAMP NULL
    `);

    // audit_logs
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NULL,
        "action" varchar(64) NOT NULL,
        "resourceType" varchar(64) NULL,
        "resourceId" varchar(191) NULL,
        "metadata" jsonb NULL,
        "ipAddress" varchar(64) NULL,
        "userAgent" varchar(512) NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_user_id"
        ON "audit_logs" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action"
        ON "audit_logs" ("action")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_created_at"
        ON "audit_logs" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_action"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "refreshTokenIssuedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "weeklyDigestSentAt"`,
    );
  }
}
