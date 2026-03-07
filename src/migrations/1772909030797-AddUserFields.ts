import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserFields1772909030797 implements MigrationInterface {
    name = 'AddUserFields1772909030797'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "push_tokens" DROP CONSTRAINT "push_tokens_userId_fkey"`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_userId_fkey"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "googleId"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "picture"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "currency"`);
        await queryRunner.query(`ALTER TABLE "users" ADD "timezone" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "country" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "defaultCurrency" character varying DEFAULT 'USD'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "dateFormat" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "onboardingCompleted" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD "notificationsEnabled" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "push_tokens" ADD "active" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "locale" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "locale" DROP DEFAULT`);
        await queryRunner.query(`ALTER TYPE "public"."reports_type_enum" RENAME TO "reports_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."reports_type_enum" AS ENUM('SUMMARY', 'DETAILED', 'TAX', 'AUDIT')`);
        await queryRunner.query(`ALTER TABLE "reports" ALTER COLUMN "type" TYPE "public"."reports_type_enum" USING "type"::"text"::"public"."reports_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."reports_type_enum_old"`);
        await queryRunner.query(`ALTER TABLE "reports" DROP COLUMN "status"`);
        await queryRunner.query(`CREATE TYPE "public"."reports_status_enum" AS ENUM('PENDING', 'GENERATING', 'READY', 'FAILED')`);
        await queryRunner.query(`ALTER TABLE "reports" ADD "status" "public"."reports_status_enum" NOT NULL DEFAULT 'PENDING'`);
        await queryRunner.query(`ALTER TABLE "push_tokens" DROP COLUMN "userId"`);
        await queryRunner.query(`ALTER TABLE "push_tokens" ADD "userId" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "push_tokens" DROP CONSTRAINT "push_tokens_token_key"`);
        await queryRunner.query(`ALTER TABLE "push_tokens" ALTER COLUMN "platform" DROP NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_95b226ff93ba9b9edfd06136be" ON "push_tokens" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_610102b60fea1455310ccd299d" ON "refresh_tokens" ("userId") `);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_610102b60fea1455310ccd299de" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_610102b60fea1455310ccd299de"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_610102b60fea1455310ccd299d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_95b226ff93ba9b9edfd06136be"`);
        await queryRunner.query(`ALTER TABLE "push_tokens" ALTER COLUMN "platform" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_token_key" UNIQUE ("token")`);
        await queryRunner.query(`ALTER TABLE "push_tokens" DROP COLUMN "userId"`);
        await queryRunner.query(`ALTER TABLE "push_tokens" ADD "userId" uuid NOT NULL`);
        await queryRunner.query(`ALTER TABLE "reports" DROP COLUMN "status"`);
        await queryRunner.query(`DROP TYPE "public"."reports_status_enum"`);
        await queryRunner.query(`ALTER TABLE "reports" ADD "status" character varying NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`CREATE TYPE "public"."reports_type_enum_old" AS ENUM('summary', 'detailed', 'tax')`);
        await queryRunner.query(`ALTER TABLE "reports" ALTER COLUMN "type" TYPE "public"."reports_type_enum_old" USING "type"::"text"::"public"."reports_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."reports_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."reports_type_enum_old" RENAME TO "reports_type_enum"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "locale" SET DEFAULT 'en'`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "locale" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "push_tokens" DROP COLUMN "active"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "notificationsEnabled"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "onboardingCompleted"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "dateFormat"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "defaultCurrency"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "country"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "timezone"`);
        await queryRunner.query(`ALTER TABLE "users" ADD "currency" character varying NOT NULL DEFAULT 'USD'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "picture" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "googleId" character varying`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
