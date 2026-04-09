import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixReminderDefaults1775800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fill NULL values before changing default
    await queryRunner.query(
      `UPDATE subscriptions SET "reminderDaysBefore" = '{3}' WHERE "reminderDaysBefore" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE subscriptions SET "reminderEnabled" = true WHERE "reminderEnabled" IS NULL`,
    );

    // Change column defaults
    await queryRunner.query(
      `ALTER TABLE subscriptions ALTER COLUMN "reminderDaysBefore" SET DEFAULT '{3}'`,
    );
    await queryRunner.query(
      `ALTER TABLE subscriptions ALTER COLUMN "reminderEnabled" SET DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE subscriptions ALTER COLUMN "reminderDaysBefore" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE subscriptions ALTER COLUMN "reminderEnabled" SET DEFAULT false`,
    );
  }
}
