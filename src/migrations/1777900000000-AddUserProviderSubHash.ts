import { MigrationInterface, QueryRunner } from 'typeorm';
import { AesGcmTransformer } from '../common/crypto/aes-gcm-transformer';
import { hashProviderSub } from '../common/crypto/provider-sub-hash';

/**
 * Adds `providerSubHash` to `users` — a deterministic, queryable twin of the
 * encrypted `providerId`. It lets the auth flow re-identify a returning OAuth
 * user by their stable provider `sub` even when the identity token omits the
 * email, which Apple does on every login after the first consent. Without it,
 * `/auth/apple` 400'd those users ("Email not provided by Apple").
 *
 * The backfill decrypts `providerId` in Node — it's stored with a
 * non-deterministic AES-GCM transformer, so it can't be hashed in SQL. We read
 * the RAW on-disk value (ciphertext or legacy plaintext) and decrypt each row
 * individually via `AesGcmTransformer.from`, wrapped in try/catch: this
 * migration runs on EVERY boot (migrationsRun: true), so a single
 * undecryptable/garbage row must not abort startup. Reading raw also avoids
 * hydrating entities (and their eager `billing` relation).
 *
 * Idempotent: the column/index use IF NOT EXISTS and the WHERE clause only
 * selects rows whose `providerSubHash` is still null, so a re-run (e.g.
 * partial-apply on dev, or the every-boot re-execution) is safe.
 */
export class AddUserProviderSubHash1777900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "providerSubHash" character varying;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_providerSubHash"
        ON "users" ("providerSubHash");
    `);

    // Backfill existing OAuth users so their first emailless login matches by
    // sub instead of creating a duplicate account.
    const rows: Array<{ id: string; provider: string; providerId: string }> =
      await queryRunner.query(
        `SELECT "id", "provider", "providerId"
           FROM "users"
          WHERE "provider" IN ('apple', 'google')
            AND "providerId" IS NOT NULL
            AND "providerSubHash" IS NULL`,
      );

    for (const row of rows) {
      try {
        const sub = AesGcmTransformer.from(row.providerId);
        if (!sub) continue;
        const hash = hashProviderSub(row.provider, sub);
        await queryRunner.query(
          `UPDATE "users" SET "providerSubHash" = $1 WHERE "id" = $2`,
          [hash, row.id],
        );
      } catch (err: any) {
        // A single undecryptable row (corrupt ciphertext, rotated key) must
        // not wedge the boot-time migration. Skip it — the row keeps working
        // via the email path and can be backfilled later once resolved.
        console.warn(
          `[AddUserProviderSubHash] skipped user ${row.id}: ${err?.message ?? err}`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_users_providerSubHash";`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "providerSubHash";`,
    );
  }
}
