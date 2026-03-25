import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNewSubscriptionCategories1774600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "subscriptions_category_enum"
      ADD VALUE IF NOT EXISTS 'EDUCATION';
    `);
    await queryRunner.query(`
      ALTER TYPE "subscriptions_category_enum"
      ADD VALUE IF NOT EXISTS 'FINANCE';
    `);
    await queryRunner.query(`
      ALTER TYPE "subscriptions_category_enum"
      ADD VALUE IF NOT EXISTS 'SECURITY';
    `);
    await queryRunner.query(`
      ALTER TYPE "subscriptions_category_enum"
      ADD VALUE IF NOT EXISTS 'DEVELOPER';
    `);
    await queryRunner.query(`
      ALTER TYPE "subscriptions_category_enum"
      ADD VALUE IF NOT EXISTS 'SPORT';
    `);
    await queryRunner.query(`
      ALTER TYPE "subscriptions_category_enum"
      ADD VALUE IF NOT EXISTS 'BUSINESS';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from enums easily.
    // To rollback, you would need to recreate the enum type without these values.
    // This is intentionally left as a no-op since removing enum values is destructive.
  }
}
