import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds new billing-refactor fields to `users`:
 *  - billingStatus   enum — canonical state machine value (replaces
 *                    the ad-hoc combo of plan + cancelAtPeriodEnd +
 *                    gracePeriodEnd + billingIssueAt flags).
 *  - currentPeriodStart — start of the active paid period (we already
 *                    store currentPeriodEnd; the new field is needed
 *                    for RC_RENEWAL transitions + accurate analytics).
 *  - invitedByUserId — Pro-invite seat graph (NULL for owners, FK to
 *                    the inviter for members who were granted access).
 *                    ON DELETE SET NULL so deleting an inviter does
 *                    not cascade-delete their invitees.
 *
 * Column identifiers keep existing camelCase convention of the users
 * table (see billingIssueAt, gracePeriodEnd, billingSource) so we do
 * not need @Column({ name: ... }) mapping overrides.
 */
export class AlterUsersBillingRefactor1776597428625
  implements MigrationInterface
{
  name = 'AlterUsersBillingRefactor1776597428625';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "billing_status_enum" AS ENUM (
          'active','cancel_at_period_end','billing_issue','grace_pro','grace_team','free'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "billingStatus" "billing_status_enum" NOT NULL DEFAULT 'free'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMPTZ NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invitedByUserId" uuid NULL`,
    );
    // FK is conditional: skip if already added (idempotent re-run).
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "users" ADD CONSTRAINT "fk_users_invited_by_user_id"
        FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_users_invited_by" ON "users"("invitedByUserId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_invited_by"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "fk_users_invited_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "invitedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "currentPeriodStart"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "billingStatus"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "billing_status_enum"`);
  }
}
