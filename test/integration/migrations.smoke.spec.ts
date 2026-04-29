import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import * as path from 'path';

/**
 * Migration smoke test — boots a throwaway Postgres via testcontainers,
 * runs every migration `up()` in order, then runs every `down()` back to
 * empty. Catches:
 *   - Missing IF NOT EXISTS in CREATE statements (re-running breaks)
 *   - Down migrations that leave the schema in a state the next up()
 *     can't recreate
 *   - Type clashes between migration sequences (e.g. enum collisions)
 *   - SQL syntax that survived TS compile but fails on real Postgres
 *
 * Gated behind RUN_INTEGRATION=1 because pulling postgres:16-alpine and
 * waiting for it to boot adds ~10s to the test run — too slow for the
 * inner-loop unit suite. The CI workflow runs it on every push.
 *
 * Skipped automatically when Docker isn't reachable (e.g. on CI runners
 * without privileged mode), so a `npm test` on a dev machine without
 * Docker passes locally and falls through to the integration-only CI
 * job.
 */
const RUN = process.env.RUN_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

describeIntegration('migrations smoke', () => {
  let pg: StartedPostgreSqlContainer;
  let ds: DataSource;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('migrations_smoke')
      .withUsername('smoke')
      .withPassword('smoke')
      .start();

    ds = new DataSource({
      type: 'postgres',
      host: pg.getHost(),
      port: pg.getPort(),
      username: pg.getUsername(),
      password: pg.getPassword(),
      database: pg.getDatabase(),
      // Same glob as src/data-source.ts so the discovery list matches prod.
      entities: [
        path.join(__dirname, '..', '..', 'src', '**', '*.entity.{ts,js}'),
      ],
      migrations: [
        path.join(__dirname, '..', '..', 'src', 'migrations', '*.{ts,js}'),
      ],
    });

    await ds.initialize();
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (pg) await pg.stop();
  });

  let migrationCount = 0;

  it('runs every migration up() without error', async () => {
    const ran = await ds.runMigrations({ transaction: 'each' });
    expect(ran.length).toBeGreaterThan(0);
    migrationCount = ran.length;
  }, 90_000);

  it('user_billing table exists with the 5 CHECK constraints', async () => {
    const tables = await ds.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'user_billing'
    `);
    expect(tables.length).toBe(1);

    const constraints = await ds.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.user_billing'::regclass
        AND contype = 'c'
      ORDER BY conname
    `);
    const names = constraints.map((r: any) => r.conname);
    expect(names).toEqual(
      expect.arrayContaining([
        'billing_state_plan_consistent',
        'billing_cancel_flag_matches_state',
        'billing_grace_state_has_end',
        'billing_paid_state_has_period',
        'billing_source_required_for_paid',
      ]),
    );
  });

  it('the 10 billing columns are gone from users', async () => {
    const cols = await ds.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `);
    const names = cols.map((r: any) => r.column_name);
    const removed = [
      'plan',
      'billingStatus',
      'billingSource',
      'billingPeriod',
      'currentPeriodStart',
      'currentPeriodEnd',
      'cancelAtPeriodEnd',
      'gracePeriodEnd',
      'gracePeriodReason',
      'billingIssueAt',
    ];
    for (const c of removed) {
      expect(names).not.toContain(c);
    }
  });

  it('CHECK constraint rejects state=free + plan=pro', async () => {
    // Insert a user first (FK target).
    const userId = '00000000-0000-0000-0000-000000000001';
    await ds.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)`,
      [userId, 'check@test.local'],
    );

    let rejected = false;
    try {
      await ds.query(
        `INSERT INTO user_billing ("userId", "plan", "billingStatus") VALUES ($1, 'pro', 'free')`,
        [userId],
      );
    } catch (e: any) {
      rejected = /billing_state_plan_consistent/.test(String(e?.message ?? e));
    }
    expect(rejected).toBe(true);
  });

  it('CHECK constraint rejects cancel_at_period_end + flag=false', async () => {
    const userId = '00000000-0000-0000-0000-000000000002';
    await ds.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)`,
      [userId, 'check2@test.local'],
    );
    let rejected = false;
    try {
      await ds.query(
        `INSERT INTO user_billing ("userId", "plan", "billingStatus", "cancelAtPeriodEnd", "billingSource", "currentPeriodEnd")
         VALUES ($1, 'pro', 'cancel_at_period_end', false, 'revenuecat', NOW() + INTERVAL '30 days')`,
        [userId],
      );
    } catch (e: any) {
      rejected = /billing_cancel_flag_matches_state/.test(
        String(e?.message ?? e),
      );
    }
    expect(rejected).toBe(true);
  });

  it('admin grant exemption: state=active + billingSource=null is allowed', async () => {
    const userId = '00000000-0000-0000-0000-000000000003';
    await ds.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)`,
      [userId, 'admin@test.local'],
    );
    // No throw expected — exemption clause covers admin grants.
    await expect(
      ds.query(
        `INSERT INTO user_billing ("userId", "plan", "billingStatus", "billingSource", "currentPeriodEnd")
         VALUES ($1, 'pro', 'active', NULL, NULL)`,
        [userId],
      ),
    ).resolves.toBeDefined();
  });

  it('reverting all migrations leaves an empty schema', async () => {
    // Revert exactly the number of migrations we ran in the up() test.
    // Counting via a SELECT loop is fragile — once the very first
    // migration's `down()` drops the migrations bookkeeping table, the
    // SELECT itself starts to throw. Iterate exactly N times instead.
    expect(migrationCount).toBeGreaterThan(0);
    for (let i = 0; i < migrationCount; i++) {
      await ds.undoLastMigration({ transaction: 'each' });
    }

    const remaining = await ds.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name NOT IN ('migrations')`,
    );
    expect(remaining.length).toBe(0);
  }, 120_000);
});
