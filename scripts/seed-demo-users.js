/**
 * Seed / wipe the marketing DEMO accounts used to record App Store & social
 * videos against the live api.subradar.ai. Each account logs in with the fixed
 * OTP "000000" (gated by ENABLE_DEMO_ACCOUNTS — see src/common/test-accounts)
 * and ships with a hand-curated, photogenic subscription list: every row has a
 * real icon and a correct 2026 price.
 *
 *   test1@subradar.ai — Free,         3 subs (at the free limit)
 *   test2@subradar.ai — Pro,          9 subs across categories
 *   test3@subradar.ai — Organization, 5 subs + a demo workspace
 *
 * Idempotent — upserts by email and fully replaces each account's billing +
 * subscriptions on every run. Plain node + `pg` (no ts-node) so it runs inside
 * the prod API container exactly like seed-casa-test-user.js.
 *
 * Run from inside the API container so DATABASE_URL is already in env:
 *
 *   # Seed
 *   docker exec subradar-api-prod node scripts/seed-demo-users.js
 *
 *   # Remove the demo accounts (cascades billing / subs / workspace)
 *   docker exec subradar-api-prod node scripts/seed-demo-users.js --wipe
 *
 * Locally (point DATABASE_URL at a non-prod DB):
 *   node scripts/seed-demo-users.js
 *
 * IMPORTANT: seeding does NOT enable login on its own. Set
 * ENABLE_DEMO_ACCOUNTS=true in the API env for the recording session, then
 * unset it afterwards. The accounts can stay in the DB harmlessly while the
 * flag is off (login is rejected and AI falls back to the real path).
 */
const { Client } = require('pg');

const WIPE = process.argv.includes('--wipe');
const DAY = 24 * 3600 * 1000;
const icon = (domain) => `https://icon.horse/icon/${domain}`;

// daysUntil → next payment date spread realistically across the month.
function sub(name, amount, category, billingPeriod, domain, daysUntil, currency = 'USD') {
  return { name, amount, category, billingPeriod, iconUrl: icon(domain), daysUntil, currency };
}

const ACCOUNTS = [
  {
    email: 'test1@subradar.ai',
    name: 'Demo Free',
    plan: 'free',
    billingStatus: 'free',
    subs: [
      sub('Netflix', 22.99, 'STREAMING', 'MONTHLY', 'netflix.com', 5),
      sub('Spotify', 11.99, 'MUSIC', 'MONTHLY', 'spotify.com', 11),
      sub('ChatGPT Plus', 20, 'AI_SERVICES', 'MONTHLY', 'openai.com', 18),
    ],
  },
  {
    email: 'test2@subradar.ai',
    name: 'Demo Pro',
    plan: 'pro',
    billingStatus: 'active',
    billingPeriod: 'monthly',
    subs: [
      sub('Netflix', 22.99, 'STREAMING', 'MONTHLY', 'netflix.com', 3),
      sub('Spotify', 11.99, 'MUSIC', 'MONTHLY', 'spotify.com', 7),
      sub('YouTube Premium', 13.99, 'STREAMING', 'MONTHLY', 'youtube.com', 9),
      sub('iCloud+', 9.99, 'INFRASTRUCTURE', 'MONTHLY', 'icloud.com', 15),
      sub('ChatGPT Plus', 20, 'AI_SERVICES', 'MONTHLY', 'openai.com', 12),
      sub('Claude Pro', 20, 'AI_SERVICES', 'MONTHLY', 'anthropic.com', 21),
      sub('GitHub Copilot', 10, 'DEVELOPER', 'MONTHLY', 'github.com', 24),
      sub('Notion', 10, 'PRODUCTIVITY', 'MONTHLY', 'notion.so', 6),
      sub('Figma', 180, 'PRODUCTIVITY', 'YEARLY', 'figma.com', 70),
    ],
  },
  {
    email: 'test3@subradar.ai',
    name: 'Demo Organization',
    plan: 'organization',
    billingStatus: 'active',
    billingPeriod: 'yearly',
    workspace: { name: 'SubRadar Demo Team', inviteEmail: 'teammate@subradar.ai' },
    subs: [
      sub('Netflix', 22.99, 'STREAMING', 'MONTHLY', 'netflix.com', 4),
      sub('Slack', 87, 'BUSINESS', 'YEARLY', 'slack.com', 40),
      sub('Adobe Creative Cloud', 59.99, 'OTHER', 'MONTHLY', 'adobe.com', 16),
      sub('Microsoft 365', 99.99, 'PRODUCTIVITY', 'YEARLY', 'microsoft.com', 55),
      sub('1Password', 7.99, 'SECURITY', 'MONTHLY', '1password.com', 19),
    ],
  },
];

async function wipe(c) {
  const emails = ACCOUNTS.map((a) => a.email);
  // FK cascades from users → user_billing / subscriptions / workspaces are in
  // place, but workspace_members link by userId too — clear them explicitly.
  const { rows } = await c.query('SELECT id FROM users WHERE email = ANY($1)', [emails]);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) {
    console.log('Nothing to wipe — no demo users present.');
    return;
  }
  await c.query('DELETE FROM workspace_members WHERE "userId" = ANY($1)', [ids]);
  await c.query('DELETE FROM workspaces WHERE "ownerId" = ANY($1)', [ids]);
  await c.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
  console.log(`Wiped ${ids.length} demo user(s) + dependents.`);
}

async function upsertUser(c, acc) {
  const existing = await c.query('SELECT id FROM users WHERE email = $1', [acc.email]);
  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    await c.query(
      `UPDATE users SET name = $1, provider = 'local', "isActive" = true,
         "onboardingCompleted" = true, locale = 'en', country = 'US',
         region = 'US', "displayCurrency" = 'USD', "defaultCurrency" = 'USD'
       WHERE id = $2`,
      [acc.name, id],
    );
    return id;
  }
  const inserted = await c.query(
    `INSERT INTO users
       (email, name, provider, "isActive", "onboardingCompleted",
        locale, country, region, "displayCurrency", "defaultCurrency")
     VALUES ($1, $2, 'local', true, true, 'en', 'US', 'US', 'USD', 'USD')
     RETURNING id`,
    [acc.email, acc.name],
  );
  return inserted.rows[0].id;
}

async function upsertBilling(c, userId, acc, now) {
  const isPaid = acc.plan !== 'free';
  const source = isPaid ? 'admin_grant' : null;
  const period = isPaid ? acc.billingPeriod : null;
  const start = isPaid ? now : null;
  const end = isPaid ? new Date(now.getTime() + 365 * DAY) : null;
  const exists = await c.query('SELECT "userId" FROM user_billing WHERE "userId" = $1', [userId]);
  if (exists.rows.length === 0) {
    await c.query(
      `INSERT INTO user_billing
         ("userId", plan, "billingStatus", "billingSource", "billingPeriod",
          "currentPeriodStart", "currentPeriodEnd")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, acc.plan, acc.billingStatus, source, period, start, end],
    );
  } else {
    await c.query(
      `UPDATE user_billing
       SET plan = $2, "billingStatus" = $3, "billingSource" = $4,
           "billingPeriod" = $5, "currentPeriodStart" = $6, "currentPeriodEnd" = $7,
           "cancelAtPeriodEnd" = false, "gracePeriodEnd" = NULL,
           "gracePeriodReason" = NULL, "billingIssueAt" = NULL, "refundedAt" = NULL
       WHERE "userId" = $1`,
      [userId, acc.plan, acc.billingStatus, source, period, start, end],
    );
  }
}

async function replaceSubs(c, userId, subs, now) {
  await c.query('DELETE FROM subscriptions WHERE "userId" = $1', [userId]);
  for (const s of subs) {
    const next = new Date(now.getTime() + s.daysUntil * DAY);
    const billingDay = next.getUTCDate();
    await c.query(
      `INSERT INTO subscriptions
         ("userId", name, category, amount, currency, "originalCurrency",
          "billingPeriod", "billingDay", "startDate", "nextPaymentDate",
          status, "iconUrl", "addedVia", "reminderEnabled")
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, 'ACTIVE', $10, 'MANUAL', true)`,
      [
        userId,
        s.name,
        s.category,
        s.amount,
        s.currency,
        s.billingPeriod,
        billingDay,
        new Date(now.getTime() - 30 * DAY),
        next,
        s.iconUrl,
      ],
    );
  }
}

async function ensureWorkspace(c, ownerId, ws) {
  let wsId;
  const found = await c.query('SELECT id FROM workspaces WHERE "ownerId" = $1', [ownerId]);
  if (found.rows.length === 0) {
    const inserted = await c.query(
      `INSERT INTO workspaces (name, "ownerId", plan, "maxMembers")
       VALUES ($1, $2, 'TEAM', 5) RETURNING id`,
      [ws.name, ownerId],
    );
    wsId = inserted.rows[0].id;
  } else {
    wsId = found.rows[0].id;
    await c.query('UPDATE workspaces SET name = $2 WHERE id = $1', [wsId, ws.name]);
  }
  // Owner membership (ACTIVE) + one PENDING invite for a complete team UI.
  const ownerMember = await c.query(
    'SELECT id FROM workspace_members WHERE "workspaceId" = $1 AND "userId" = $2',
    [wsId, ownerId],
  );
  if (ownerMember.rows.length === 0) {
    await c.query(
      `INSERT INTO workspace_members ("workspaceId", "userId", role, status)
       VALUES ($1, $2, 'OWNER', 'ACTIVE')`,
      [wsId, ownerId],
    );
  }
  const invite = await c.query(
    'SELECT id FROM workspace_members WHERE "workspaceId" = $1 AND "inviteEmail" = $2',
    [wsId, ws.inviteEmail],
  );
  if (invite.rows.length === 0) {
    await c.query(
      `INSERT INTO workspace_members ("workspaceId", "inviteEmail", role, status)
       VALUES ($1, $2, 'MEMBER', 'PENDING')`,
      [wsId, ws.inviteEmail],
    );
  }
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    if (WIPE) {
      await wipe(c);
      return;
    }
    const now = new Date();
    await c.query('BEGIN');
    for (const acc of ACCOUNTS) {
      const userId = await upsertUser(c, acc);
      await upsertBilling(c, userId, acc, now);
      await replaceSubs(c, userId, acc.subs, now);
      if (acc.workspace) await ensureWorkspace(c, userId, acc.workspace);
      console.log(
        `✓ ${acc.email.padEnd(22)} plan=${acc.plan.padEnd(12)} subs=${acc.subs.length}` +
          (acc.workspace ? ' +workspace' : ''),
      );
    }
    await c.query('COMMIT');
    console.log(
      `\nSeeded ${ACCOUNTS.length} demo accounts. OTP = 000000 ` +
        '(login requires ENABLE_DEMO_ACCOUNTS=true).',
    );
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
