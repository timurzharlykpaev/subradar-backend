/**
 * CLI runner for seeding regional catalog prices.
 *
 * Usage:
 *   npm run seed:prices
 */
import 'dotenv/config';
import { AppDataSource } from '../data-source.js';
import { seedRegionalPrices } from './seed-regional-prices.js';

async function main() {
  console.log('Initializing database connection...');
  await AppDataSource.initialize();

  try {
    console.log('Running seedRegionalPrices...');
    await seedRegionalPrices(AppDataSource);
    console.log('Seed completed successfully.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }
}

main();
