import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeeklyDigestToUser1775200100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD "weeklyDigestEnabled" boolean NOT NULL DEFAULT true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "weeklyDigestEnabled"`);
  }
}
