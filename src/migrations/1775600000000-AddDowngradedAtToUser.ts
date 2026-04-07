import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDowngradedAtToUser1775600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "downgradedAt" TIMESTAMP NULL`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "downgradedAt"`);
  }
}
