/**
 * One-shot migration: re-encrypt legacy plaintext PII columns under the
 * AES-GCM transformer.
 *
 * After deploying the AesGcmTransformer (BATCH 2), every NEW write to
 * `users.providerId` and `users.lemonSqueezyCustomerId` is encrypted with
 * the `enc:v1:` prefix. Legacy rows still hold plaintext and are read
 * transparently by the transformer's graceful fallback. This script
 * accelerates encryption of those rows by re-saving each one through
 * the entity layer.
 *
 * Run AFTER the BATCH 2 deploy is healthy (so transformer is in place):
 *
 *   ssh root@46.101.197.19 "cd /opt/subradar && \
 *     docker exec subradar-backend node \
 *     dist/scripts/encrypt-legacy-pii.js"
 *
 * Or locally against dev/prod via psql tunnel + DATABASE_URL.
 *
 * Idempotent: rows already carrying `enc:v1:` are skipped.
 */
import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';
import { looksEncrypted } from '../src/common/crypto/aes-gcm-transformer';

async function run(): Promise<void> {
  if (!process.env.DATA_ENCRYPTION_KEY) {
    console.error('DATA_ENCRYPTION_KEY env var is required'); // eslint-disable-line no-console
    process.exit(2);
  }
  const isProd = process.env.NODE_ENV === 'production';
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    host: process.env.DATABASE_URL ? undefined : process.env.DB_HOST,
    port: process.env.DATABASE_URL ? undefined : Number(process.env.DB_PORT || 5432),
    username: process.env.DATABASE_URL ? undefined : process.env.DB_USERNAME,
    password: process.env.DATABASE_URL ? undefined : process.env.DB_PASSWORD,
    database: process.env.DATABASE_URL ? undefined : process.env.DB_DATABASE,
    ssl: isProd ? { rejectUnauthorized: false } : undefined,
    entities: [path.join(__dirname, '..', 'src', '**', '*.entity.{ts,js}')],
    synchronize: false,
    logging: false,
  });
  await ds.initialize();
  // eslint-disable-next-line no-console
  console.log('Connected. Scanning users for legacy plaintext PII…');

  // Use the raw query runner to read each column in its on-disk form
  // (the entity layer would auto-decrypt and we'd lose visibility into
  // which rows are already migrated).
  const rows: Array<{
    id: string;
    providerId: string | null;
    lemonSqueezyCustomerId: string | null;
  }> = await ds.query(
    `SELECT id, "providerId", "lemonSqueezyCustomerId" FROM users`,
  );

  let migratedProviderId = 0;
  let migratedLemon = 0;
  let skipped = 0;

  // Re-save each row through the entity layer; the transformer's `to`
  // callback wraps still-plaintext values in enc:v1:. Idempotent: rows
  // already carrying the prefix are short-circuited by the transformer.
  // We do this via raw UPDATE rather than entity save to avoid loading
  // the full graph (subscriptions, billing, etc.) for every user.
  const userRepo = ds.getRepository('User');
  for (const row of rows) {
    const updates: Record<string, string> = {};
    if (row.providerId && !looksEncrypted(row.providerId)) {
      updates.providerId = row.providerId;
      migratedProviderId++;
    }
    if (row.lemonSqueezyCustomerId && !looksEncrypted(row.lemonSqueezyCustomerId)) {
      updates.lemonSqueezyCustomerId = row.lemonSqueezyCustomerId;
      migratedLemon++;
    }
    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }
    // `userRepo.update` runs the column transformer (`to`) on the new
    // values, producing enc:v1:... on disk.
    await userRepo.update({ id: row.id }, updates);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Done. providerId encrypted: ${migratedProviderId}, lemonSqueezyCustomerId: ${migratedLemon}, already-encrypted/skipped: ${skipped}, total scanned: ${rows.length}`,
  );

  await ds.destroy();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('encrypt-legacy-pii failed:', err);
  process.exit(1);
});
