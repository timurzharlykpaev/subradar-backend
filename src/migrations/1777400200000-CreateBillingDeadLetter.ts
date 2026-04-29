import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBillingDeadLetter1777400200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_dead_letter" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "fromState" varchar(64) NOT NULL,
        "eventType" varchar(64) NOT NULL,
        "actor" varchar(64) NOT NULL,
        "eventPayload" jsonb NULL,
        "error" text NULL,
        "resolved" boolean NOT NULL DEFAULT false,
        "resolutionNotes" text NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_dlq_user_created"
        ON "billing_dead_letter" ("userId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_dlq_unresolved"
        ON "billing_dead_letter" ("resolved", "createdAt")
        WHERE "resolved" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_dlq_unresolved"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_dlq_user_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_dead_letter"`);
  }
}
