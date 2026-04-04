import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendInviteCodeLength1775400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invite_codes" ALTER COLUMN "code" TYPE varchar(10)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invite_codes" ALTER COLUMN "code" TYPE varchar(6)`);
  }
}
