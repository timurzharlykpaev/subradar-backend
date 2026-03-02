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
import * as path from 'path';

const isProd = process.env.NODE_ENV === 'production';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'subradar',
  ssl: isProd ? { rejectUnauthorized: false } : undefined,
  entities: [path.join(__dirname, '**', '*.entity.{ts,js}')],
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: false,
});
