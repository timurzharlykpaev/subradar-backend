import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Earlier `AddMissingSubscriptionColumns1777400300000` added
 * `subscriptions.originalCurrency` with a `DEFAULT 'USD'` so the NOT
 * NULL constraint didn't reject the ALTER on existing rows. That left
 * every legacy row with `originalCurrency='USD'` even when the actual
 * `currency` column was already KZT/EUR/etc.
 *
 * Analytics use `originalCurrency || currency` as the source-of-money,
 * so for a 49,990 KZT subscription with the wrong default the converter
 * read it as 49,990 USD → multiplied by USD→KZT rate (~500) → produced
 * 24,995,000 KZT in the by-category breakdown ("миллионы" the user saw).
 *
 * One-time backfill: copy `currency` into `originalCurrency` for every
 * row where they disagree. Idempotent. Future inserts already set
 * `originalCurrency` explicitly in `SubscriptionsService.create`, so
 * this only fixes the historical rows.
 */
export class BackfillSubscriptionOriginalCurrency1777400500000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "subscriptions"
      SET "originalCurrency" = "currency"
      WHERE "originalCurrency" IS NULL
         OR "originalCurrency" = ''
         OR ("originalCurrency" = 'USD' AND "currency" != 'USD')
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op — we cannot recover the pre-backfill state and there's no
    // legitimate reason to want to.
  }
}
