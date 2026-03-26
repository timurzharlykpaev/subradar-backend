import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReportErrorColumn1774700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reports"
      ADD COLUMN IF NOT EXISTS "error" text;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reports"
      DROP COLUMN IF EXISTS "error";
    `);
  }
}
