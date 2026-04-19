import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill users.billingStatus from existing flag columns so the new
 * state-machine column is immediately in-sync with reality.
 *
 * Priority (highest first, so later UPDATEs only touch rows that are
 * still 'free'):
 *   billing_issue > grace_pro / grace_team > cancel_at_period_end > active
 *
 * Note: column identifiers use camelCase because the live users table
 * was created that way (see InitialSchema + subsequent ALTERs).
 *
 * down() is a no-op: the column can always be recomputed from source
 * flags by re-running this migration. Reverting would otherwise wipe
 * signal we'd just regenerate.
 */
export class BackfillBillingStatus1776597429625
  implements MigrationInterface
{
  name = 'BackfillBillingStatus1776597429625';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // billing_issue: RC flagged billing problem and user is still paid
    await queryRunner.query(`
      UPDATE "users" SET "billingStatus" = 'billing_issue'
      WHERE "billingIssueAt" IS NOT NULL AND "plan" != 'free'
    `);

    // grace_pro: paid Pro expired, within 7-day win-back window
    await queryRunner.query(`
      UPDATE "users" SET "billingStatus" = 'grace_pro'
      WHERE "billingStatus" = 'free'
        AND "gracePeriodReason" = 'pro_expired'
        AND "gracePeriodEnd" IS NOT NULL
        AND "gracePeriodEnd" > now()
    `);

    // grace_team: team owner expired, member read-only window
    await queryRunner.query(`
      UPDATE "users" SET "billingStatus" = 'grace_team'
      WHERE "billingStatus" = 'free'
        AND "gracePeriodReason" = 'team_expired'
        AND "gracePeriodEnd" IS NOT NULL
        AND "gracePeriodEnd" > now()
    `);

    // cancel_at_period_end: user cancelled but period still running
    await queryRunner.query(`
      UPDATE "users" SET "billingStatus" = 'cancel_at_period_end'
      WHERE "billingStatus" = 'free'
        AND "cancelAtPeriodEnd" = true
        AND "plan" != 'free'
    `);

    // active: any remaining paid plan with no cancellation/issue flags
    await queryRunner.query(`
      UPDATE "users" SET "billingStatus" = 'active'
      WHERE "billingStatus" = 'free' AND "plan" != 'free'
    `);
  }

  public async down(): Promise<void> {
    // Intentionally empty: backfill is idempotent and can be
    // regenerated from source columns; reverting would discard
    // signal we'd just recompute.
  }
}
