import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `DESIGN` was added to the SubscriptionCategory entity enum but never shipped
 * a migration, so prod's `subscriptions_category_enum` was missing it — any
 * attempt to save a DESIGN subscription failed with
 * "invalid input value for enum subscriptions_category_enum: DESIGN".
 * This realigns the DB enum with the entity. Idempotent (IF NOT EXISTS) so
 * environments that somehow already have the value are unaffected.
 */
export class AddSubscriptionDesignCategory1778000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "subscriptions_category_enum"
      ADD VALUE IF NOT EXISTS 'DESIGN';
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot drop a single enum value without recreating the type.
    // Intentionally a no-op — removing the value would be destructive.
  }
}
