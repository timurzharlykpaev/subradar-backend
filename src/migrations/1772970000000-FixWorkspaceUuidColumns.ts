import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixWorkspaceUuidColumns1772970000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE workspace_members
        ALTER COLUMN "workspaceId" TYPE uuid USING "workspaceId"::uuid,
        ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid;
    `);
    await queryRunner.query(`
      ALTER TABLE workspaces
        ALTER COLUMN "ownerId" TYPE uuid USING "ownerId"::uuid;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE workspace_members
        ALTER COLUMN "workspaceId" TYPE varchar,
        ALTER COLUMN "userId" TYPE varchar;
    `);
    await queryRunner.query(`
      ALTER TABLE workspaces
        ALTER COLUMN "ownerId" TYPE varchar;
    `);
  }
}
