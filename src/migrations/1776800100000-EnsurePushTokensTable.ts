import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ensure the `push_tokens` table exists on every environment.
 *
 * Background: dev was historically bootstrapped via `synchronize: true`, then
 * migrated to explicit migrations with the pre-2026-04-15 ones pre-marked as
 * executed. The entity file for PushToken shipped long after synchronize was
 * disabled, so dev never got the table and `UsersService.deleteAccount()`
 * (which does `DELETE FROM push_tokens`) 500s there. Prod already has it, so
 * this is effectively a no-op for prod thanks to `CREATE TABLE IF NOT EXISTS`.
 */
export class EnsurePushTokensTable1776800100000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
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
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_push_tokens_userId" ON "push_tokens" ("userId")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // Intentionally empty: the table may have pre-existed from the original
    // InitialSchema migration on prod, and reverting shouldn't drop data.
  }
}
