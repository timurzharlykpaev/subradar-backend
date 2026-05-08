import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds Gmail integration columns to `users`. The integration is opt-in:
 * the user explicitly grants Gmail access from the in-app settings
 * screen ("Connect Gmail to detect subscriptions automatically"), and
 * the OAuth flow stores a long-lived refresh token encrypted at rest.
 *
 * Limited Use compliance (Google API Services User Data Policy) is the
 * load-bearing reason every column here exists:
 *   - gmailRefreshToken: ENCRYPTED at rest via AesGcmTransformer.
 *     Required because Gmail returns a single refresh token per grant
 *     and we must persist it across server restarts to keep polling.
 *   - gmailConnectedAt: timestamp of grant; surface in UI ("Connected
 *     2 days ago") and used to enforce per-account-age policies.
 *   - gmailEmail: the email address Google associates with the grant.
 *     May differ from `users.email` (e.g. user signed up with Apple but
 *     connected a separate Gmail).
 *   - gmailScopes: comma-separated scope list from the grant — kept so
 *     we can detect when a re-grant is needed after a scope expansion
 *     and reject access tokens whose scope set is unexpected.
 *
 * No FK changes. CASCADE on user delete is implicit (columns live on
 * `users` itself). The `revoke + clear` step on account deletion is
 * handled in code (UsersService.deleteAccount) so we make a best-effort
 * call to oauth2.googleapis.com/revoke before nulling the row.
 *
 * Idempotent — every ALTER uses IF NOT EXISTS.
 */
export class AddGmailIntegration1777700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "gmailRefreshToken" character varying NULL,
        ADD COLUMN IF NOT EXISTS "gmailConnectedAt"  timestamp NULL,
        ADD COLUMN IF NOT EXISTS "gmailEmail"        character varying NULL,
        ADD COLUMN IF NOT EXISTS "gmailScopes"       character varying NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "gmailRefreshToken",
        DROP COLUMN IF EXISTS "gmailConnectedAt",
        DROP COLUMN IF EXISTS "gmailEmail",
        DROP COLUMN IF EXISTS "gmailScopes";
    `);
  }
}
