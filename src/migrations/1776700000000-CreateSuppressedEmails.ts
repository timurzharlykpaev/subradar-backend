import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suppression list for outbound email — addresses we must never mail again
 * (hard bounces, spam complaints, one-click unsubscribes).
 *
 * Idempotent: safe to re-run on any environment.
 */
export class CreateSuppressedEmails1776700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "suppressed_emails" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "email" varchar(320) NOT NULL,
        "reason" varchar(32) NOT NULL,
        "context" text NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suppressed_emails" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_suppressed_emails_email"
        ON "suppressed_emails" ("email")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_suppressed_emails_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "suppressed_emails"`);
  }
}
