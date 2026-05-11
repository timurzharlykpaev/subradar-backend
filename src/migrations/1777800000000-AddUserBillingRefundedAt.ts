import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Track Apple/Google refunds with a dedicated `refundedAt` column on
 * user_billing so the UI can surface a 7-day "refund processed" banner
 * + the push handler can emit a localized FCM notification.
 *
 * Before this change: RC_REFUND transition flipped the user straight to
 * `state='free'` without preserving any trace that the cause was a
 * refund vs an ordinary expiration. The mobile UI couldn't distinguish
 * "your subscription ran out" from "Apple reversed your charge" — both
 * looked like a silent downgrade.
 *
 * `refundedAt` is set by the state machine on RC_REFUND and cleared by
 * any transition into `active` (new purchase / renewal / product change)
 * so a returning subscriber's old refund banner doesn't follow them.
 *
 * Nullable column, default NULL — safe additive change; no backfill
 * needed because existing rows had no way to be in the new state.
 */
export class AddUserBillingRefundedAt1777800000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_billing"
      ADD COLUMN IF NOT EXISTS "refundedAt" timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_billing" DROP COLUMN IF EXISTS "refundedAt"
    `);
  }
}
