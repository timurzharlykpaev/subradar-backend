import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionIndexes1774500000000 implements MigrationInterface {
  name = 'AddSubscriptionIndexes1774500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_subscriptions_userId" ON "subscriptions" ("userId")`);
    await queryRunner.query(`CREATE INDEX "IDX_subscriptions_status" ON "subscriptions" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_subscriptions_nextPaymentDate" ON "subscriptions" ("nextPaymentDate")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_subscriptions_nextPaymentDate"`);
    await queryRunner.query(`DROP INDEX "IDX_subscriptions_status"`);
    await queryRunner.query(`DROP INDEX "IDX_subscriptions_userId"`);
  }
}
