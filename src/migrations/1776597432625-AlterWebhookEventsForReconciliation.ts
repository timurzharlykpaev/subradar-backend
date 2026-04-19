import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extends webhook_events with enough signal for reconciliation +
 * observability:
 *  - user_id    — nullable FK, set when the handler resolved the event
 *                 to a subradar user (some RC events cannot be mapped,
 *                 e.g. INITIAL_PURCHASE before appUserId is attached).
 *  - error      — captured exception text when a handler fails; the
 *                 reconciliation cron uses this to find stuck users
 *                 whose webhook never applied.
 *  - event_type — provider's event name (RC: INITIAL_PURCHASE,
 *                 RENEWAL, CANCELLATION...; LS: subscription_created,
 *                 subscription_updated, ...). Already present as part
 *                 of the event id in practice, but a typed column
 *                 enables fast per-type analytics without parsing.
 *
 * Indexes:
 *  - idx_webhook_events_user_error — errored events per user, sorted
 *    by processed_at (partial: WHERE error IS NOT NULL).
 *  - idx_users_reconciliation_candidates — tight list of users the
 *    hourly cron should re-check against RC: only RC-source + any
 *    state other than grace/free (grace users are already "falling
 *    off"; reconciling them wastes RC API budget).
 *
 * Note on column identifiers: webhook_events was created snake_case
 * (event_id, processed_at — see CreateWebhookEvents migration); we
 * keep that convention here for new columns. users table however is
 * camelCase, so the reconciliation-candidates index quotes its
 * columns with the original casing.
 */
export class AlterWebhookEventsForReconciliation1776597432625
  implements MigrationInterface
{
  name = 'AlterWebhookEventsForReconciliation1776597432625';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "user_id" uuid NULL`,
    );
    // FK added conditionally to keep migration idempotent on re-run.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "webhook_events"
          ADD CONSTRAINT "fk_webhook_events_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "error" text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "event_type" varchar(64) NULL`,
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_webhook_events_user_error"
        ON "webhook_events" ("user_id", "processed_at")
        WHERE error IS NOT NULL
    `);

    // Partial index for reconciliation cron: only RC-source users
    // whose state is not already terminal (grace/free).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_reconciliation_candidates"
        ON "users" ("billingSource", "currentPeriodEnd")
        WHERE "billingSource" = 'revenuecat'
          AND "billingStatus" NOT IN ('grace_pro','grace_team','free')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_reconciliation_candidates"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_webhook_events_user_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_events" DROP COLUMN IF EXISTS "event_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_events" DROP COLUMN IF EXISTS "error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_events" DROP CONSTRAINT IF EXISTS "fk_webhook_events_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_events" DROP COLUMN IF EXISTS "user_id"`,
    );
  }
}
