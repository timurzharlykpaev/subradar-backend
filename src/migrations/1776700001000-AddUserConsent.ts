import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Track GDPR consent for marketing email and analytics. Without this we
 * have no auditable proof that a user agreed to receive recurring email,
 * which makes us liable under GDPR + CCPA if a regulator asks.
 *
 * Backfill strategy: existing users keep `consentedAt = NULL`. Compliance
 * code treats NULL as "legacy user, grandfathered" — they receive a one-off
 * re-consent email next time the policy version is bumped.
 */
export class AddUserConsent1776700001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "consentedAt"     TIMESTAMP NULL DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS "consentVersion"  VARCHAR(16) NULL DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS "consentIp"       VARCHAR(64) NULL DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "consentedAt",
      DROP COLUMN IF EXISTS "consentVersion",
      DROP COLUMN IF EXISTS "consentIp"
    `);
  }
}
