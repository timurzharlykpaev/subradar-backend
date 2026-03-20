import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserReminderAndMissingCols1742500200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // users.reminderDaysBefore — integer, default 3
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reminderDaysBefore" integer DEFAULT 3`);
    // users.emailNotifications — already in entity but may be missing from DB
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailNotifications" boolean DEFAULT true`);
    // users.billingSource — from RevenueCat integration
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "billingSource" varchar`);
    // subscriptions.color — hex color
    await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "color" varchar(7)`);
    // subscriptions.tags — JSON array
    await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "tags" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "tags"`);
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "color"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "billingSource"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "emailNotifications"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "reminderDaysBefore"`);
  }
}
