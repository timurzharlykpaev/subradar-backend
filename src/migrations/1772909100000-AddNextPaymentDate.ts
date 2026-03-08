import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNextPaymentDate1772909100000 implements MigrationInterface {
    name = 'AddNextPaymentDate1772909100000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD IF NOT EXISTS "nextPaymentDate" date`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "nextPaymentDate"`);
    }
}
