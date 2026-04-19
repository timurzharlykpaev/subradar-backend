import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { EffectiveAccessResolver } from '../effective-access.service';
import { User } from '../../../users/entities/user.entity';
import { UserTrial } from '../../trials/entities/user-trial.entity';
import { Workspace } from '../../../workspace/entities/workspace.entity';
import { WorkspaceMember } from '../../../workspace/entities/workspace-member.entity';
import { Subscription } from '../../../subscriptions/entities/subscription.entity';

/**
 * Minimal mock repo — only the methods EffectiveAccessResolver calls.
 * `count` defaults to 0 so individual tests only override what they
 * care about.
 */
function mockRepo() {
  return {
    findOne: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };
}

/**
 * Build a User-ish object with sane "free user" defaults. Tests spread
 * this and override specific fields so the intent of each scenario
 * stays obvious.
 */
function userFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    plan: 'free',
    billingStatus: 'free',
    billingSource: null,
    billingPeriod: null,
    cancelAtPeriodEnd: false,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    gracePeriodEnd: null,
    gracePeriodReason: null,
    billingIssueAt: null,
    downgradedAt: null,
    aiRequestsUsed: 0,
    proInviteeEmail: null,
    ...overrides,
  };
}

describe('EffectiveAccessResolver.resolve', () => {
  let svc: EffectiveAccessResolver;
  let users: ReturnType<typeof mockRepo>;
  let trials: ReturnType<typeof mockRepo>;
  let workspaces: ReturnType<typeof mockRepo>;
  let members: ReturnType<typeof mockRepo>;
  let subs: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    users = mockRepo();
    trials = mockRepo();
    workspaces = mockRepo();
    members = mockRepo();
    subs = mockRepo();

    const mod = await Test.createTestingModule({
      providers: [
        EffectiveAccessResolver,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(UserTrial), useValue: trials },
        { provide: getRepositoryToken(Workspace), useValue: workspaces },
        { provide: getRepositoryToken(WorkspaceMember), useValue: members },
        { provide: getRepositoryToken(Subscription), useValue: subs },
      ],
    }).compile();

    svc = mod.get(EffectiveAccessResolver);
  });

  it('throws NotFoundException when user does not exist', async () => {
    users.findOne.mockResolvedValue(null);
    await expect(svc.resolve('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('free user → free effective plan, trial eligible', async () => {
    users.findOne.mockResolvedValue(userFixture());
    trials.findOne.mockResolvedValue(null);
    workspaces.findOne.mockResolvedValue(null);
    members.findOne.mockResolvedValue(null);

    const r = await svc.resolve('u1');

    expect(r.effective.plan).toBe('free');
    expect(r.effective.source).toBe('free');
    expect(r.effective.state).toBe('free');
    expect(r.flags.trialEligible).toBe(true);
    expect(r.actions.canStartTrial).toBe(true);
    expect(r.actions.canCancel).toBe(false);
    expect(r.banner.priority).toBe('none');
    expect(r.limits.subscriptions.limit).toBe(3);
    expect(r.ownership.hasOwnPaidPlan).toBe(false);
  });

  it('active pro own plan (monthly) → own + annual_upgrade banner', async () => {
    users.findOne.mockResolvedValue(
      userFixture({
        plan: 'pro',
        billingStatus: 'active',
        billingSource: 'revenuecat',
        billingPeriod: 'monthly',
        currentPeriodStart: new Date('2026-04-01'),
        currentPeriodEnd: new Date('2026-05-01'),
      }),
    );
    trials.findOne.mockResolvedValue(null);
    workspaces.findOne.mockResolvedValue(null);
    members.findOne.mockResolvedValue(null);
    subs.count.mockResolvedValue(12);

    const r = await svc.resolve('u1');

    expect(r.effective.plan).toBe('pro');
    expect(r.effective.source).toBe('own');
    expect(r.effective.billingPeriod).toBe('monthly');
    expect(r.ownership.hasOwnPaidPlan).toBe(true);
    expect(r.banner.priority).toBe('annual_upgrade');
    expect(r.limits.subscriptions.limit).toBeNull();
    expect(r.limits.subscriptions.used).toBe(12);
    expect(r.actions.canCancel).toBe(true);
    expect(r.actions.canUpgradeToYearly).toBe(true);
    expect(r.dates.currentPeriodEnd).toBe(
      new Date('2026-05-01').toISOString(),
    );
    expect(r.dates.nextPaymentDate).toBe(
      new Date('2026-05-01').toISOString(),
    );
  });

  it('grace_pro → pro via grace with daysLeft populated', async () => {
    const graceExpiresAt = new Date(Date.now() + 3 * 86_400_000);
    users.findOne.mockResolvedValue(
      userFixture({
        plan: 'free',
        billingStatus: 'grace_pro',
        gracePeriodEnd: graceExpiresAt,
        gracePeriodReason: 'pro_expired',
      }),
    );
    trials.findOne.mockResolvedValue(null);
    workspaces.findOne.mockResolvedValue(null);
    members.findOne.mockResolvedValue(null);

    const r = await svc.resolve('u1');

    expect(r.effective.plan).toBe('pro');
    expect(r.effective.source).toBe('grace_pro');
    expect(r.effective.state).toBe('grace_pro');
    expect(r.dates.graceDaysLeft).toBe(3);
    expect(r.banner.priority).toBe('grace');
    expect(r.banner.payload).toMatchObject({
      daysLeft: 3,
      reason: 'pro_expired',
    });
    expect(r.flags.graceReason).toBe('pro_expired');
  });

  it('team member with active owner → organization / team source', async () => {
    users.findOne.mockImplementation(({ where }: any) => {
      if (where.id === 'u1') {
        return Promise.resolve(userFixture({ id: 'u1' }));
      }
      if (where.id === 'owner-1') {
        return Promise.resolve(
          userFixture({
            id: 'owner-1',
            plan: 'organization',
            billingStatus: 'active',
            billingSource: 'revenuecat',
          }),
        );
      }
      return Promise.resolve(null);
    });
    workspaces.findOne.mockResolvedValue(null);
    members.findOne.mockResolvedValue({
      id: 'm1',
      workspaceId: 'ws-1',
      userId: 'u1',
      status: 'ACTIVE',
      workspace: { id: 'ws-1', ownerId: 'owner-1' },
    });

    const r = await svc.resolve('u1');

    expect(r.effective.plan).toBe('organization');
    expect(r.effective.source).toBe('team');
    expect(r.ownership.isTeamMember).toBe(true);
    expect(r.ownership.teamOwnerId).toBe('owner-1');
    expect(r.ownership.workspaceId).toBe('ws-1');
  });

  it('cancel_at_period_end within 7 days → expiration banner', async () => {
    const end = new Date(Date.now() + 5 * 86_400_000);
    users.findOne.mockResolvedValue(
      userFixture({
        plan: 'pro',
        billingStatus: 'cancel_at_period_end',
        billingSource: 'revenuecat',
        billingPeriod: 'monthly',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: end,
      }),
    );

    const r = await svc.resolve('u1');

    expect(r.banner.priority).toBe('expiration');
    expect(r.banner.payload).toMatchObject({ daysLeft: 5 });
    expect(r.dates.nextPaymentDate).toBeNull();
    expect(r.actions.canCancel).toBe(false);
  });

  it('win_back: free user who previously paid (downgradedAt set)', async () => {
    users.findOne.mockResolvedValue(
      userFixture({
        downgradedAt: new Date('2026-03-01'),
      }),
    );
    trials.findOne.mockResolvedValue({
      userId: 'u1',
      endsAt: new Date('2026-02-10'), // expired
      plan: 'pro',
    });

    const r = await svc.resolve('u1');

    expect(r.effective.plan).toBe('free');
    expect(r.banner.priority).toBe('win_back');
    expect(r.flags.trialEligible).toBe(false);
  });

  it('degradedMode: free user whose subscription count exceeds limit', async () => {
    users.findOne.mockResolvedValue(userFixture());
    subs.count.mockResolvedValue(5);

    const r = await svc.resolve('u1');

    expect(r.flags.degradedMode).toBe(true);
    expect(r.flags.hiddenSubscriptionsCount).toBe(2);
    expect(r.limits.subscriptions.used).toBe(5);
    expect(r.limits.subscriptions.limit).toBe(3);
  });
});
