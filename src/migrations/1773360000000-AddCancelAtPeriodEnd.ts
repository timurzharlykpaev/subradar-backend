import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelAtPeriodEnd1773360000000 implements MigrationInterface {
  name = 'AddCancelAtPeriodEnd1773360000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "cancelAtPeriodEnd",
      DROP COLUMN IF EXISTS "currentPeriodEnd"
    `);
  }
}
