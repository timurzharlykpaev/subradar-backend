/**
 * TypeORM DataSource для CLI (migration:generate, migration:run, migration:revert)
 * Используется только в dev/CI — не импортируется в runtime приложения.
 *
 * Использование:
 *   npm run migration:generate -- src/migrations/MigrationName
 *   npm run migration:run
 *   npm run migration:revert
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

const isProd = process.env.NODE_ENV === 'production';

// Mirror app.module.ts SSL behaviour: pin DO managed-PG CA when supplied via
// env, otherwise fall back to rejectUnauthorized:false with a warning. The
// CLI (migration:run) is invoked in CI / from the droplet with the same
// env, so applying the same logic keeps prod migrations honest.
function buildSsl(): false | { ca?: string; rejectUnauthorized: boolean } {
  if (!isProd) return false;
  const caInline = process.env.DB_CA_CERT;
  const caPath = process.env.DB_CA_PATH;
  if (caInline && caInline.trim().length > 0) {
    return { ca: caInline, rejectUnauthorized: true };
  }
  if (caPath && caPath.trim().length > 0) {
    return { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
  }

  console.warn(
    '[SECURITY] DataSource TLS: no DB_CA_CERT/DB_CA_PATH set — running with ' +
      'rejectUnauthorized:false. Pin the DO managed-PG CA before CASA submission.',
  );
  return { rejectUnauthorized: false };
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'subradar',
  ssl: buildSsl() || undefined,
  entities: [path.join(__dirname, '**', '*.entity.{ts,js}')],
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: false,
});
