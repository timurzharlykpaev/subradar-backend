/**
 * Seed test users covering every billing/subscription state the v1.4.0 QA
 * checklist exercises. Safe to run multiple times — upserts by email and
 * replaces each seeded user's subscriptions.
 *
 * Usage:
 *   npm run seed:test-users
 *
 * Cleanup:
 *   npm run seed:test-users -- --wipe
 *
 * Users seeded (all password-less, magic-link login via OTP `000000` bypass
 * for local/sandbox — see auth.service for the bypass gate):
 *
 *   qa-free-empty@subradar.test      — Free, 0 subscriptions
 *   qa-free-atlimit@subradar.test    — Free, 3 subs (hits lock-modal on 4th)
 *   qa-free-degraded@subradar.test   — Free, 5 subs (shows degraded LockedSubscriptionCards)
 *   qa-pro-active@subradar.test      — Pro monthly active, 8 subs across categories
 *   qa-pro-trialing@subradar.test    — Pro on free trial, 2 subs
 *   qa-pro-cancel-at-period-end@…    — Pro with cancelAtPeriodEnd, shows ExpirationBanner
 *   qa-pro-grace@subradar.test       — In grace period (billing_issue), shows GraceBanner
 *   qa-pro-billing-issue@…           — billing_issue active, shows BillingIssueBanner
 *   qa-team-owner@subradar.test      — Team Owner, workspace + 2 members invited
 *   qa-team-member@subradar.test     — Team member, no own Pro
 *   qa-double-pay@subradar.test      — Team member with own active Pro (DoublePayBanner)
 *   qa-suppressed@subradar.test      — Email on suppression list (complaint)
 */
import 'dotenv/config';
import { AppDataSource } from '../src/data-source';
import { User, AuthProvider } from '../src/users/entities/user.entity';
import {
  Subscription,
  SubscriptionCategory,
  SubscriptionStatus,
  BillingPeriod,
  AddedVia,
} from '../src/subscriptions/entities/subscription.entity';
import { Workspace } from '../src/workspace/entities/workspace.entity';
import {
  WorkspaceMember,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from '../src/workspace/entities/workspace-member.entity';
import { InviteCode } from '../src/workspace/entities/invite-code.entity';
import { SuppressedEmail } from '../src/notifications/entities/suppressed-email.entity';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

interface SeedSub {
  name: string;
  amount: number;
  currency?: string;
  category: SubscriptionCategory;
  billingPeriod: BillingPeriod;
  status?: SubscriptionStatus;
  nextPaymentDate?: Date;
}

interface SeedUser {
  email: string;
  name: string;
  plan: string;
  billingStatus: User['billingStatus'];
  cancelAtPeriodEnd?: boolean;
  billingIssueAt?: Date | null;
  gracePeriodEnd?: Date | null;
  gracePeriodReason?: 'pro_expired' | 'team_expired' | null;
  trialUsed?: boolean;
  trialStartDate?: Date | null;
  trialEndDate?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  billingPeriod?: string | null;
  subs: SeedSub[];
}

const SEED: SeedUser[] = [
  {
    email: 'qa-free-empty@subradar.test',
    name: 'QA Free Empty',
    plan: 'free',
    billingStatus: 'free',
    subs: [],
  },
  {
    email: 'qa-free-atlimit@subradar.test',
    name: 'QA Free @Limit',
    plan: 'free',
    billingStatus: 'free',
    subs: [
      sub('Netflix', 15.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 5),
      sub('Spotify', 9.99, SubscriptionCategory.MUSIC, BillingPeriod.MONTHLY, 10),
      sub('ChatGPT Plus', 20, SubscriptionCategory.AI_SERVICES, BillingPeriod.MONTHLY, 14),
    ],
  },
  {
    email: 'qa-free-degraded@subradar.test',
    name: 'QA Free Degraded',
    plan: 'free',
    billingStatus: 'free',
    subs: [
      sub('Netflix', 15.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 1),
      sub('Disney+', 11.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 2, 'EUR'),
      sub('HBO Max', 14.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 3),
      sub('Apple Music', 10.99, SubscriptionCategory.MUSIC, BillingPeriod.MONTHLY, 4),
      sub('YouTube Premium', 13.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 5),
    ],
  },
  {
    email: 'qa-pro-active@subradar.test',
    name: 'QA Pro Active',
    plan: 'pro',
    billingStatus: 'active',
    currentPeriodStart: new Date(now - 10 * DAY),
    currentPeriodEnd: new Date(now + 20 * DAY),
    billingPeriod: 'monthly',
    subs: [
      sub('Netflix', 15.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 3),
      sub('Spotify Family', 17.99, SubscriptionCategory.MUSIC, BillingPeriod.MONTHLY, 7),
      sub('iCloud+ 2TB', 9.99, SubscriptionCategory.INFRASTRUCTURE, BillingPeriod.MONTHLY, 15),
      sub('GitHub Copilot', 10, SubscriptionCategory.DEVELOPER, BillingPeriod.MONTHLY, 22),
      sub('1Password', 2.99, SubscriptionCategory.SECURITY, BillingPeriod.MONTHLY, 11),
      sub('Notion', 10, SubscriptionCategory.PRODUCTIVITY, BillingPeriod.MONTHLY, 9),
      sub('Figma', 15, SubscriptionCategory.DESIGN, BillingPeriod.MONTHLY, 18),
      sub('Claude Pro', 20, SubscriptionCategory.AI_SERVICES, BillingPeriod.YEARLY, 60),
    ],
  },
  {
    email: 'qa-pro-trialing@subradar.test',
    name: 'QA Pro Trialing',
    plan: 'pro',
    billingStatus: 'active',
    trialUsed: true,
    trialStartDate: new Date(now - 2 * DAY),
    trialEndDate: new Date(now + 5 * DAY),
    currentPeriodStart: new Date(now - 2 * DAY),
    currentPeriodEnd: new Date(now + 5 * DAY),
    billingPeriod: 'monthly',
    subs: [
      sub('Netflix', 15.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 8),
      sub('Spotify', 9.99, SubscriptionCategory.MUSIC, BillingPeriod.MONTHLY, 12),
    ],
  },
  {
    email: 'qa-pro-cancel-at-period-end@subradar.test',
    name: 'QA Pro Cancelled',
    plan: 'pro',
    billingStatus: 'cancel_at_period_end',
    cancelAtPeriodEnd: true,
    currentPeriodStart: new Date(now - 20 * DAY),
    currentPeriodEnd: new Date(now + 10 * DAY),
    billingPeriod: 'monthly',
    subs: [
      sub('Netflix', 15.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 3),
      sub('Spotify', 9.99, SubscriptionCategory.MUSIC, BillingPeriod.MONTHLY, 7),
    ],
  },
  {
    email: 'qa-pro-grace@subradar.test',
    name: 'QA Pro Grace',
    plan: 'free',
    billingStatus: 'grace_pro',
    gracePeriodEnd: new Date(now + 4 * DAY),
    gracePeriodReason: 'pro_expired',
    subs: [
      sub('Netflix', 15.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 3),
    ],
  },
  {
    email: 'qa-pro-billing-issue@subradar.test',
    name: 'QA Pro Billing Issue',
    plan: 'pro',
    billingStatus: 'billing_issue',
    billingIssueAt: new Date(now - 2 * DAY),
    currentPeriodStart: new Date(now - 30 * DAY),
    currentPeriodEnd: new Date(now + 2 * DAY),
    billingPeriod: 'monthly',
    subs: [
      sub('Netflix', 15.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 2),
      sub('Spotify', 9.99, SubscriptionCategory.MUSIC, BillingPeriod.MONTHLY, 6),
    ],
  },
  {
    email: 'qa-team-owner@subradar.test',
    name: 'QA Team Owner',
    plan: 'team',
    billingStatus: 'active',
    currentPeriodStart: new Date(now - 15 * DAY),
    currentPeriodEnd: new Date(now + 15 * DAY),
    billingPeriod: 'yearly',
    subs: [
      sub('Netflix', 15.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 4),
      sub('iCloud+ 2TB', 9.99, SubscriptionCategory.INFRASTRUCTURE, BillingPeriod.MONTHLY, 16),
    ],
  },
  {
    email: 'qa-team-member@subradar.test',
    name: 'QA Team Member',
    plan: 'free',
    billingStatus: 'free',
    subs: [
      sub('ChatGPT Plus', 20, SubscriptionCategory.AI_SERVICES, BillingPeriod.MONTHLY, 14),
    ],
  },
  {
    email: 'qa-double-pay@subradar.test',
    name: 'QA Double Pay',
    plan: 'pro',
    billingStatus: 'active',
    currentPeriodStart: new Date(now - 10 * DAY),
    currentPeriodEnd: new Date(now + 20 * DAY),
    billingPeriod: 'monthly',
    subs: [
      sub('Netflix', 15.99, SubscriptionCategory.STREAMING, BillingPeriod.MONTHLY, 4),
    ],
  },
  {
    email: 'qa-suppressed@subradar.test',
    name: 'QA Suppressed',
    plan: 'free',
    billingStatus: 'free',
    subs: [],
  },
];

function sub(
  name: string,
  amount: number,
  category: SubscriptionCategory,
  billingPeriod: BillingPeriod,
  daysUntilNextPayment: number,
  currency = 'USD',
): SeedSub {
  return {
    name,
    amount,
    currency,
    category,
    billingPeriod,
    status: SubscriptionStatus.ACTIVE,
    nextPaymentDate: new Date(now + daysUntilNextPayment * DAY),
  };
}

async function wipe(ds = AppDataSource) {
  const userRepo = ds.getRepository(User);
  const users = await userRepo.find({
    where: SEED.map((s) => ({ email: s.email })),
  });
  if (users.length === 0) {
    console.log('Nothing to wipe — no seed users present.');
    return;
  }
  const ids = users.map((u) => u.id);

  // Delete dependent rows first (FK cascades may not be set for all links).
  await ds.getRepository(Subscription).createQueryBuilder()
    .delete().where('userId IN (:...ids)', { ids }).execute();
  await ds.getRepository(InviteCode).createQueryBuilder()
    .delete().where('"createdBy" IN (:...ids)', { ids }).execute();
  await ds.getRepository(WorkspaceMember).createQueryBuilder()
    .delete().where('userId IN (:...ids)', { ids }).execute();
  await ds.getRepository(Workspace).createQueryBuilder()
    .delete().where('ownerId IN (:...ids)', { ids }).execute();
  await ds.getRepository(SuppressedEmail).createQueryBuilder()
    .delete().where('email IN (:...emails)', { emails: SEED.map((s) => s.email) }).execute();
  await userRepo.delete(ids);
  console.log(`Wiped ${ids.length} seed users + their dependents.`);
}

async function upsertUser(ds: typeof AppDataSource, seed: SeedUser): Promise<User> {
  const repo = ds.getRepository(User);
  let user = await repo.findOne({ where: { email: seed.email } });
  const data: Partial<User> = {
    email: seed.email,
    name: seed.name,
    provider: AuthProvider.LOCAL,
    plan: seed.plan,
    billingStatus: seed.billingStatus,
    cancelAtPeriodEnd: seed.cancelAtPeriodEnd ?? false,
    billingIssueAt: seed.billingIssueAt ?? null,
    gracePeriodEnd: seed.gracePeriodEnd ?? null,
    gracePeriodReason: seed.gracePeriodReason ?? null,
    trialUsed: seed.trialUsed ?? false,
    trialStartDate: seed.trialStartDate ?? null,
    trialEndDate: seed.trialEndDate ?? null,
    currentPeriodStart: seed.currentPeriodStart ?? null,
    currentPeriodEnd: seed.currentPeriodEnd ?? null,
    billingPeriod: seed.billingPeriod ?? null,
    onboardingCompleted: true,
    isActive: true,
    locale: 'en',
    country: 'US',
    region: 'US',
    displayCurrency: 'USD',
    defaultCurrency: 'USD',
  };
  if (!user) {
    user = repo.create(data);
  } else {
    Object.assign(user, data);
  }
  return repo.save(user);
}

async function replaceSubs(ds: typeof AppDataSource, user: User, subs: SeedSub[]) {
  const repo = ds.getRepository(Subscription);
  await repo.createQueryBuilder().delete().where('userId = :id', { id: user.id }).execute();
  if (subs.length === 0) return;
  const rows = subs.map((s) =>
    repo.create({
      user,
      userId: user.id,
      name: s.name,
      amount: s.amount,
      currency: s.currency ?? 'USD',
      category: s.category,
      billingPeriod: s.billingPeriod,
      status: s.status ?? SubscriptionStatus.ACTIVE,
      nextPaymentDate: s.nextPaymentDate ?? null,
      addedVia: AddedVia.MANUAL,
    }),
  );
  await repo.save(rows);
}

async function ensureWorkspace(ds: typeof AppDataSource, owner: User, member: User) {
  const wsRepo = ds.getRepository(Workspace);
  const memberRepo = ds.getRepository(WorkspaceMember);
  let ws = await wsRepo.findOne({ where: { ownerId: owner.id } });
  if (!ws) {
    ws = wsRepo.create({
      name: 'QA Test Team',
      ownerId: owner.id,
    });
    ws = await wsRepo.save(ws);
  }
  const existingOwnerMember = await memberRepo.findOne({
    where: { workspaceId: ws.id, userId: owner.id },
  });
  if (!existingOwnerMember) {
    await memberRepo.save(
      memberRepo.create({
        workspaceId: ws.id,
        userId: owner.id,
        role: WorkspaceMemberRole.OWNER,
        status: WorkspaceMemberStatus.ACTIVE,
      }),
    );
  }
  const existingInviteeMember = await memberRepo.findOne({
    where: { workspaceId: ws.id, userId: member.id },
  });
  if (!existingInviteeMember) {
    await memberRepo.save(
      memberRepo.create({
        workspaceId: ws.id,
        userId: member.id,
        role: WorkspaceMemberRole.MEMBER,
        status: WorkspaceMemberStatus.ACTIVE,
      }),
    );
  }
}

async function ensureSuppressed(ds: typeof AppDataSource, email: string) {
  const repo = ds.getRepository(SuppressedEmail);
  const found = await repo.findOne({ where: { email } });
  if (found) return;
  await repo.save(repo.create({ email, reason: 'complaint', context: 'seed' }));
}

async function main() {
  const wipeRequested = process.argv.includes('--wipe');
  await AppDataSource.initialize();
  try {
    if (wipeRequested) {
      await wipe();
      return;
    }

    const byEmail = new Map<string, User>();
    for (const seed of SEED) {
      const user = await upsertUser(AppDataSource, seed);
      await replaceSubs(AppDataSource, user, seed.subs);
      byEmail.set(seed.email, user);
      console.log(
        `✓ ${seed.email.padEnd(42)} plan=${seed.plan.padEnd(4)} status=${seed.billingStatus}`,
      );
    }

    const owner = byEmail.get('qa-team-owner@subradar.test')!;
    const member = byEmail.get('qa-team-member@subradar.test')!;
    await ensureWorkspace(AppDataSource, owner, member);
    await ensureSuppressed(AppDataSource, 'qa-suppressed@subradar.test');

    console.log(`\nSeeded ${SEED.length} users + workspace + 1 suppressed email.`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
