import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * InitialSchema — создаёт все таблицы с нуля.
 * Если таблицы уже существуют (созданы через synchronize),
 * миграция помечается как выполненная без повторного создания.
 */
export class InitialSchema1740873600000 implements MigrationInterface {
  name = 'InitialSchema1740873600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // users
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "users_provider_enum" AS ENUM ('local', 'google', 'apple')
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"                       uuid NOT NULL DEFAULT gen_random_uuid(),
        "name"                     character varying,
        "email"                    character varying NOT NULL,
        "password"                 character varying,
        "avatarUrl"                character varying,
        "provider"                 "users_provider_enum" NOT NULL DEFAULT 'local',
        "providerId"               character varying,
        "fcmToken"                 character varying,
        "isActive"                 boolean NOT NULL DEFAULT true,
        "refreshToken"             character varying,
        "magicLinkToken"           character varying,
        "magicLinkExpiry"          TIMESTAMP,
        "lemonSqueezyCustomerId"   character varying,
        "plan"                     character varying NOT NULL DEFAULT 'free',
        "createdAt"                TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"                TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    // payment_cards
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "payment_cards_brand_enum" AS ENUM ('VISA', 'MC', 'AMEX', 'MIR', 'OTHER')
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_cards" (
        "id"         uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId"     character varying NOT NULL,
        "nickname"   character varying NOT NULL,
        "last4"      character varying(4) NOT NULL,
        "brand"      "payment_cards_brand_enum" NOT NULL DEFAULT 'OTHER',
        "color"      character varying NOT NULL DEFAULT '#6366f1',
        "isDefault"  boolean NOT NULL DEFAULT false,
        "createdAt"  TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_cards" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payment_cards_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // subscriptions
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "subscriptions_category_enum" AS ENUM ('STREAMING','AI_SERVICES','INFRASTRUCTURE','PRODUCTIVITY','MUSIC','GAMING','NEWS','HEALTH','OTHER')
    `);
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "subscriptions_billingperiod_enum" AS ENUM ('MONTHLY','YEARLY','WEEKLY','QUARTERLY','LIFETIME','ONE_TIME')
    `);
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "subscriptions_status_enum" AS ENUM ('TRIAL','ACTIVE','PAUSED','CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "subscriptions_addedvia_enum" AS ENUM ('MANUAL','AI_VOICE','AI_SCREENSHOT','AI_TEXT')
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId"              character varying NOT NULL,
        "name"                character varying NOT NULL,
        "category"            "subscriptions_category_enum" NOT NULL DEFAULT 'OTHER',
        "amount"              numeric(10,2) NOT NULL,
        "currency"            character varying NOT NULL DEFAULT 'USD',
        "billingPeriod"       "subscriptions_billingperiod_enum" NOT NULL DEFAULT 'MONTHLY',
        "billingDay"          integer,
        "startDate"           date,
        "currentPlan"         character varying,
        "availablePlans"      jsonb,
        "status"              "subscriptions_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "trialEndDate"        date,
        "cancelledAt"         TIMESTAMP,
        "serviceUrl"          character varying,
        "cancelUrl"           character varying,
        "managePlanUrl"       character varying,
        "iconUrl"             character varying,
        "reminderDaysBefore"  integer[],
        "reminderEnabled"     boolean NOT NULL DEFAULT false,
        "isBusinessExpense"   boolean NOT NULL DEFAULT false,
        "taxCategory"         character varying,
        "notes"               text,
        "addedVia"            "subscriptions_addedvia_enum" NOT NULL DEFAULT 'MANUAL',
        "aiMetadata"          jsonb,
        "paymentCardId"       uuid,
        "createdAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscriptions_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_subscriptions_paymentCardId" FOREIGN KEY ("paymentCardId") REFERENCES "payment_cards"("id") ON DELETE SET NULL
      )
    `);

    // refresh_tokens
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refresh_tokens" (
        "id"         uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId"     character varying NOT NULL,
        "token"      character varying NOT NULL,
        "expiresAt"  TIMESTAMP NOT NULL,
        "revoked"    boolean NOT NULL DEFAULT false,
        "createdAt"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_refresh_tokens_token" UNIQUE ("token"),
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_tokens_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_userId" ON "refresh_tokens" ("userId")`);

    // push_tokens
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "push_tokens" (
        "id"        uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId"    character varying NOT NULL,
        "token"     character varying NOT NULL,
        "platform"  character varying,
        "active"    boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_tokens" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_push_tokens_userId" ON "push_tokens" ("userId")`);

    // receipts
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "receipts" (
        "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId"         character varying NOT NULL,
        "filename"       character varying NOT NULL,
        "fileUrl"        character varying NOT NULL,
        "subscriptionId" character varying,
        "amount"         numeric,
        "currency"       character varying,
        "receiptDate"    TIMESTAMP,
        "uploadedAt"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_receipts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_receipts_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // reports
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "reports_type_enum" AS ENUM ('summary','detailed','tax')
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reports" (
        "id"        uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId"    character varying NOT NULL,
        "type"      "reports_type_enum" NOT NULL,
        "from"      character varying NOT NULL,
        "to"        character varying NOT NULL,
        "fileUrl"   character varying,
        "status"    character varying NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reports" PRIMARY KEY ("id"),
        CONSTRAINT "FK_reports_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // workspaces
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspaces" (
        "id"                         uuid NOT NULL DEFAULT gen_random_uuid(),
        "name"                       character varying NOT NULL,
        "ownerId"                    character varying NOT NULL,
        "plan"                       character varying NOT NULL DEFAULT 'TEAM',
        "maxMembers"                 integer NOT NULL DEFAULT 5,
        "lemonSqueezySubscriptionId" character varying,
        "createdAt"                  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workspaces" PRIMARY KEY ("id")
      )
    `);

    // workspace_members
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "workspace_members_role_enum" AS ENUM ('OWNER','ADMIN','MEMBER')
    `);
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "workspace_members_status_enum" AS ENUM ('PENDING','ACTIVE')
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_members" (
        "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "userId"      character varying,
        "role"        "workspace_members_role_enum" NOT NULL DEFAULT 'MEMBER',
        "inviteEmail" character varying,
        "status"      "workspace_members_status_enum" NOT NULL DEFAULT 'PENDING',
        "joinedAt"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workspace_members" PRIMARY KEY ("id"),
        CONSTRAINT "FK_workspace_members_workspaceId" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_workspace_members_workspaceId" ON "workspace_members" ("workspaceId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_workspace_members_userId" ON "workspace_members" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workspaces"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "workspace_members_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "workspace_members_role_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reports"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "reports_type_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "receipts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "push_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscriptions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscriptions_addedvia_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscriptions_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscriptions_billingperiod_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscriptions_category_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_cards"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_cards_brand_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_provider_enum"`);
  }
}
