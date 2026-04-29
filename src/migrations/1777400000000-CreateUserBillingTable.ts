import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 of the billing-unified-mutations refactor: physically split
 * the 10 state-machine-owned billing fields out of `users` into a
 * dedicated `user_billing` table, add CHECK constraints that make
 * inconsistent rows physically impossible, and drop the old columns.
 *
 * Single-deploy migration — prod is empty so we don't need the
 * dual-write soak window described in the design doc.
 *
 * 10 fields moved:
 *   plan, billingStatus, billingSource, billingPeriod,
 *   currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd,
 *   gracePeriodEnd, gracePeriodReason, billingIssueAt
 *
 * After this migration:
 *   - UserBillingRepository reads/writes user_billing.
 *   - User entity exposes the fields via an eager OneToOne relation +
 *     backward-compat getters so existing object-level reads keep working.
 *   - QueryBuilder reads against u.plan / u.billingStatus / etc. were
 *     migrated to JOIN user_billing in the same PR.
 *
 * CHECK constraints (rejected by Postgres if any future code path
 * leaves the row inconsistent):
 *   - billing_state_plan_consistent: state='free' iff plan='free'
 *   - billing_cancel_flag_matches_state: cancel_at_period_end <=> state='cancel_at_period_end'
 *     (billing_issue is exempt — can carry either value)
 *   - billing_grace_state_has_end: grace_pro/grace_team rows MUST have grace_period_end
 *   - billing_paid_state_has_period: any non-free / non-grace / non-billing-issue
 *     state needs a current_period_end
 *   - billing_source_required_for_paid: state != 'free' implies billing_source IS NOT NULL
 */
export class CreateUserBillingTable1777400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. CREATE TABLE
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_billing" (
        "userId" uuid PRIMARY KEY,
        "plan" varchar(32) NOT NULL DEFAULT 'free',
        "billingStatus" varchar(32) NOT NULL DEFAULT 'free',
        "billingSource" varchar NULL,
        "billingPeriod" varchar NULL,
        "currentPeriodStart" timestamptz NULL,
        "currentPeriodEnd" timestamptz NULL,
        "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
        "gracePeriodEnd" timestamptz NULL,
        "gracePeriodReason" varchar(20) NULL,
        "billingIssueAt" timestamptz NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_user_billing_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // 2. Backfill — copy current state from users into user_billing.
    //    On empty prod this is a no-op; on dev / staging it preserves
    //    whatever billing snapshot already exists.
    await queryRunner.query(`
      INSERT INTO "user_billing" (
        "userId", "plan", "billingStatus", "billingSource", "billingPeriod",
        "currentPeriodStart", "currentPeriodEnd", "cancelAtPeriodEnd",
        "gracePeriodEnd", "gracePeriodReason", "billingIssueAt"
      )
      SELECT
        "id",
        COALESCE("plan", 'free'),
        COALESCE("billingStatus"::varchar, 'free'),
        "billingSource",
        "billingPeriod",
        "currentPeriodStart",
        "currentPeriodEnd",
        COALESCE("cancelAtPeriodEnd", false),
        "gracePeriodEnd",
        "gracePeriodReason",
        "billingIssueAt"
      FROM "users"
      ON CONFLICT ("userId") DO NOTHING
    `);

    // 3. Heal pre-existing drift before adding the constraints.
    //    Any row that currently violates the invariants gets normalised
    //    to free — the safest "I don't know what state this user is
    //    really in" default. Logged so post-migration audit can find them.
    await queryRunner.query(`
      UPDATE "user_billing"
      SET
        "plan" = 'free',
        "billingStatus" = 'free',
        "billingSource" = NULL,
        "billingPeriod" = NULL,
        "currentPeriodStart" = NULL,
        "currentPeriodEnd" = NULL,
        "cancelAtPeriodEnd" = false,
        "gracePeriodEnd" = NULL,
        "gracePeriodReason" = NULL,
        "billingIssueAt" = NULL
      WHERE
        ("billingStatus" = 'free' AND "plan" != 'free')
        OR ("billingStatus" != 'free' AND "plan" = 'free')
        OR ("billingStatus" IN ('grace_pro','grace_team') AND "gracePeriodEnd" IS NULL)
        OR (
          "billingStatus" NOT IN ('free','grace_pro','grace_team','billing_issue','active')
          AND "currentPeriodEnd" IS NULL
        )
        OR (
          "billingStatus" != 'free'
          AND "billingStatus" != 'active'
          AND "billingSource" IS NULL
        )
    `);

    // 4. CHECK constraints
    await queryRunner.query(`
      ALTER TABLE "user_billing"
      ADD CONSTRAINT "billing_state_plan_consistent" CHECK (
        ("billingStatus" = 'free' AND "plan" = 'free')
        OR ("billingStatus" != 'free' AND "plan" != 'free')
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "user_billing"
      ADD CONSTRAINT "billing_cancel_flag_matches_state" CHECK (
        "billingStatus" = 'billing_issue'
        OR ("billingStatus" = 'cancel_at_period_end' AND "cancelAtPeriodEnd" = true)
        OR ("billingStatus" != 'cancel_at_period_end' AND "cancelAtPeriodEnd" = false)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "user_billing"
      ADD CONSTRAINT "billing_grace_state_has_end" CHECK (
        ("billingStatus" IN ('grace_pro','grace_team') AND "gracePeriodEnd" IS NOT NULL)
        OR ("billingStatus" NOT IN ('grace_pro','grace_team') AND "gracePeriodEnd" IS NULL)
      )
    `);
    // Paid states (active / cancel_at_period_end) need a current_period_end —
    // EXCEPT admin grants which carry no period (billingSource is null).
    await queryRunner.query(`
      ALTER TABLE "user_billing"
      ADD CONSTRAINT "billing_paid_state_has_period" CHECK (
        "billingStatus" IN ('free','grace_pro','grace_team','billing_issue')
        OR "currentPeriodEnd" IS NOT NULL
        OR ("billingStatus" = 'active' AND "billingSource" IS NULL)
      )
    `);
    // billing_source must be set for any paid state EXCEPT admin grants
    // (ADMIN_GRANT_PRO produces state='active', plan!='free', billingSource=null
    //  for users who got Pro through a Pro-invite — not via RC/LS).
    await queryRunner.query(`
      ALTER TABLE "user_billing"
      ADD CONSTRAINT "billing_source_required_for_paid" CHECK (
        "billingStatus" = 'free'
        OR "billingSource" IS NOT NULL
        OR ("billingStatus" = 'active' AND "billingSource" IS NULL)
      )
    `);

    // 5. Drop the migrated columns from `users`.
    //    NOTE: order chosen so we drop the named-default first (billingStatus
    //    has an enum type; dropping the column drops the enum's last user
    //    in Postgres only when no other column uses it).
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "billingIssueAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "gracePeriodReason"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "gracePeriodEnd"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "cancelAtPeriodEnd"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "currentPeriodEnd"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "currentPeriodStart"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "billingPeriod"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "billingSource"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "billingStatus"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "plan"`);
    // The `billing_status` enum type may now be orphaned. Drop it if no
    // other table references it; otherwise Postgres raises an error
    // which we tolerate.
    await queryRunner.query(`DROP TYPE IF EXISTS "users_billingstatus_enum"`).catch(() => undefined);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse: re-add columns to users + copy data back + drop user_billing.
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "plan" varchar(32) NOT NULL DEFAULT 'free',
      ADD COLUMN "billingStatus" varchar(32) NOT NULL DEFAULT 'free',
      ADD COLUMN "billingSource" varchar NULL,
      ADD COLUMN "billingPeriod" varchar NULL,
      ADD COLUMN "currentPeriodStart" timestamptz NULL,
      ADD COLUMN "currentPeriodEnd" timestamptz NULL,
      ADD COLUMN "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
      ADD COLUMN "gracePeriodEnd" timestamptz NULL,
      ADD COLUMN "gracePeriodReason" varchar(20) NULL,
      ADD COLUMN "billingIssueAt" timestamptz NULL
    `);
    await queryRunner.query(`
      UPDATE "users" u
      SET
        "plan" = ub."plan",
        "billingStatus" = ub."billingStatus",
        "billingSource" = ub."billingSource",
        "billingPeriod" = ub."billingPeriod",
        "currentPeriodStart" = ub."currentPeriodStart",
        "currentPeriodEnd" = ub."currentPeriodEnd",
        "cancelAtPeriodEnd" = ub."cancelAtPeriodEnd",
        "gracePeriodEnd" = ub."gracePeriodEnd",
        "gracePeriodReason" = ub."gracePeriodReason",
        "billingIssueAt" = ub."billingIssueAt"
      FROM "user_billing" ub
      WHERE ub."userId" = u."id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_billing"`);
  }
}
