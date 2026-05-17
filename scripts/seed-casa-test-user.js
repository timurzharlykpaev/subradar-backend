/**
 * Seed / wipe the test user used by CASA Tier 2 DAST scanning.
 *
 * The CASA assessor (ESOF AppSec ADA) authenticates against /auth/login with
 * email + password before sweeping authenticated endpoints. Mobile clients
 * use OAuth/magic-link only, so this user exists exclusively for the scan
 * window and must be removed once the assessment is complete.
 *
 * Run from inside the API container so DATABASE_URL is already in env:
 *
 *   # Seed (idempotent — upserts user + grants Pro for 90 days)
 *   CASA_PASSWORD='...' docker exec -e CASA_PASSWORD subradar-api-prod \
 *     node scripts/seed-casa-test-user.js
 *
 *   # Remove the user (and cascade user_billing)
 *   docker exec subradar-api-prod node scripts/seed-casa-test-user.js --wipe
 *
 * Locally (point DATABASE_URL at a non-prod DB):
 *   CASA_PASSWORD='...' node scripts/seed-casa-test-user.js
 */
const { Client } = require('pg');
const bcrypt = require('bcrypt');

const EMAIL = 'casa-test@subradar.ai';
const NAME = 'CASA Test User';
const WIPE = process.argv.includes('--wipe');
const GRANT_DAYS = 90;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    if (WIPE) {
      const res = await c.query('DELETE FROM users WHERE email = $1', [EMAIL]);
      console.log(`wiped ${res.rowCount} user(s) matching ${EMAIL}`);
      return;
    }
    const pwd = process.env.CASA_PASSWORD;
    if (!pwd || pwd.length < 16) {
      throw new Error('CASA_PASSWORD env required (>= 16 chars)');
    }
    const hash = await bcrypt.hash(pwd, 12);
    const now = new Date();
    const periodEnd = new Date(now.getTime() + GRANT_DAYS * 24 * 3600 * 1000);

    await c.query('BEGIN');
    const existing = await c.query('SELECT id FROM users WHERE email = $1', [EMAIL]);
    let userId;
    if (existing.rows.length === 0) {
      const inserted = await c.query(
        `INSERT INTO users
           (email, name, password, provider, "isActive", "onboardingCompleted",
            locale, country, region, "displayCurrency", "defaultCurrency")
         VALUES ($1, $2, $3, 'local', true, true,
                 'en', 'US', 'US', 'USD', 'USD')
         RETURNING id`,
        [EMAIL, NAME, hash],
      );
      userId = inserted.rows[0].id;
      console.log('user created:', userId);
    } else {
      userId = existing.rows[0].id;
      await c.query(
        `UPDATE users SET password = $1, provider = 'local', "isActive" = true
         WHERE id = $2`,
        [hash, userId],
      );
      console.log('user updated:', userId);
    }

    const billingExists = await c.query(
      'SELECT "userId" FROM user_billing WHERE "userId" = $1',
      [userId],
    );
    if (billingExists.rows.length === 0) {
      await c.query(
        `INSERT INTO user_billing
           ("userId", plan, "billingStatus", "billingSource", "billingPeriod",
            "currentPeriodStart", "currentPeriodEnd")
         VALUES ($1, 'pro', 'active', 'admin_grant', 'monthly', $2, $3)`,
        [userId, now, periodEnd],
      );
      console.log('billing created: pro/active until', periodEnd.toISOString());
    } else {
      await c.query(
        `UPDATE user_billing
         SET plan = 'pro', "billingStatus" = 'active',
             "billingSource" = 'admin_grant', "billingPeriod" = 'monthly',
             "currentPeriodStart" = $2, "currentPeriodEnd" = $3,
             "cancelAtPeriodEnd" = false, "gracePeriodEnd" = NULL,
             "gracePeriodReason" = NULL, "billingIssueAt" = NULL
         WHERE "userId" = $1`,
        [userId, now, periodEnd],
      );
      console.log('billing updated: pro/active until', periodEnd.toISOString());
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
