import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `tokenVersion` to `users`. Embedded into every JWT we mint; the
 * verifier rejects tokens whose claim doesn't match the user's current
 * value. Bumped on logout, password change, and any other event that
 * should immediately invalidate every outstanding JWT — closes ASVS
 * V3.5.2 ("session terminated on logout"), which the previous design
 * silently violated because access JWTs continued to work for up to
 * 7 days after logout.
 *
 * Default 0 + nullable: false so existing rows automatically get a
 * stable starting value with no backfill step.
 */
export class AddUserTokenVersion1777600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "tokenVersion";`,
    );
  }
}
