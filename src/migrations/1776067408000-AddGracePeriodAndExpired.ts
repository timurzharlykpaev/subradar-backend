import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGracePeriodAndExpired1776067408000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gracePeriodEnd" TIMESTAMP NULL`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gracePeriodReason" VARCHAR(20) NULL`);
    await queryRunner.query(`ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "expiredAt" TIMESTAMP NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "gracePeriodEnd"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "gracePeriodReason"`);
    await queryRunner.query(`ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "expiredAt"`);
  }
}
