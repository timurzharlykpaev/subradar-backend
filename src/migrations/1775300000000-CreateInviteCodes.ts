import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInviteCodes1775300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "invite_codes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "code" varchar(6) NOT NULL,
        "createdBy" uuid NOT NULL,
        "usedBy" uuid,
        "usedAt" TIMESTAMP,
        "expiresAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invite_codes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_invite_codes_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_invite_codes_code" ON "invite_codes" ("code")`);
    await queryRunner.query(`CREATE INDEX "IDX_invite_codes_workspaceId" ON "invite_codes" ("workspaceId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "invite_codes"`);
  }
}
