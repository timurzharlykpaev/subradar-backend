# Billing Unified Mutations — Phase 1 (Facade) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing billing state machine the only path that writes the 10 billing fields on the `users` row. Phase 1 introduces a `UserBillingRepository` facade and migrates 9 direct-write callsites to `applyTransition`. No DB schema change — Phase 2 (the physical table split + CHECK constraints) is a separate plan.

**Architecture:** New `UserBillingRepository` owns reads/writes of the 10 billing fields on `users`. It internally calls the pure `transition()` reducer and writes the resulting snapshot through the existing `applySnapshot` helper plus an audit row. All 9 callsites currently writing billing fields directly via `usersService.update` / `userRepo.update` / direct entity mutation are refactored to call `applyTransition(userId, event, opts)`. Two new state-machine events are added: `TRIAL_EXPIRED` and `ADMIN_GRANT_PRO`. After all callsites are migrated, the 10 billing keys are removed from `UsersService.update` whitelist so the compiler/runtime forbids any remaining direct write.

**Tech Stack:** TypeScript strict, NestJS, TypeORM, Jest, existing state-machine reducer (`src/billing/state-machine/transitions.ts`), existing `applySnapshot` helper (will be moved into the new repository).

**Key reference docs:**
- Design spec: `docs/superpowers/specs/2026-04-29-billing-unified-mutations-design.md`
- State machine reducer: `src/billing/state-machine/transitions.ts`
- Types: `src/billing/state-machine/types.ts`

---

## File Structure

**New files (Phase 1):**

| Path | Responsibility |
|---|---|
| `src/billing/user-billing.repository.ts` | The facade. `read()`, `applyTransition()`. Owns all writes to the 10 billing fields. |
| `src/billing/user-billing.repository.spec.ts` | Unit tests for the facade (applied / idempotent_noop / invalid_transition / FOR UPDATE / audit). |
| `src/billing/state-machine/infer-rc-event.ts` | Pure helper: `RCSubscriberSnapshot + UserBillingSnapshot → BillingEvent \| null`. Lives in state-machine because it's pure. |
| `src/billing/state-machine/__tests__/infer-rc-event.spec.ts` | Decision-table tests for `inferEventFromRcSnapshot`. |

**Modified files (Phase 1):**

| Path | Change |
|---|---|
| `src/billing/state-machine/types.ts` | Add `TRIAL_EXPIRED`, `ADMIN_GRANT_PRO` to `BillingEvent` union. |
| `src/billing/state-machine/transitions.ts` | Add transition cases for the two new events. |
| `src/billing/state-machine/__tests__/transitions.spec.ts` | Add tests for the two new transitions. |
| `src/billing/billing.module.ts` | Provide & export `UserBillingRepository`. |
| `src/billing/billing.service.ts` | `processRevenueCatEvent`, `processLemonSqueezyEvent`, `handleTeamOwnerExpiration`, `syncRevenueCat`, `reconcileRevenueCat`, `cancelSubscription`, `activateProInvite`, `removeProInvite` — switch to `userBilling.applyTransition`. Remove the now-unused private `applySnapshot` and `snapshotFromUser` (their bodies move into the repo). |
| `src/billing/grace-period.cron.ts` | Switch `resetExpiredGrace` to `applyTransition({ type: 'GRACE_EXPIRED' })`. |
| `src/reminders/reminders.service.ts` | `expireTrialsImpl` switches to `applyTransition({ type: 'TRIAL_EXPIRED' })`. |
| `src/reminders/reminders.module.ts` | Import `BillingModule` so `UserBillingRepository` is injectable. |
| `src/users/users.service.ts` | Remove 10 billing keys from `ALLOWED_KEYS`: `plan`, `billingSource`, `billingPeriod`, `billingStatus`, `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `gracePeriodEnd`, `gracePeriodReason`, `billingIssueAt`. |

---

## Sequencing (mergeable safety)

Each task ends with a green test run + a commit. The order keeps existing webhooks working at every step:

1. **Tasks 1–2:** Add `TRIAL_EXPIRED` and `ADMIN_GRANT_PRO` events + transitions + transition tests. No callers yet — additive change.
2. **Task 3:** Create `inferEventFromRcSnapshot` helper + tests. Pure, no callers yet.
3. **Tasks 4–7:** Build `UserBillingRepository` (skeleton → `read` → `applyTransition` happy path → invalid/idempotent/FOR UPDATE/audit). No callers yet.
4. **Task 8:** Wire repo into `BillingModule`. No behaviour change.
5. **Task 9:** Migrate webhook handlers (`processRevenueCatEvent`, `processLemonSqueezyEvent`, `handleTeamOwnerExpiration`) — they already used `applySnapshot`, so this is a 1-line swap. Existing webhook tests must keep passing.
6. **Tasks 10–14:** Migrate the five direct-write callers (`syncRevenueCat`, `reconcileRevenueCat`, `cancelSubscription`, `activateProInvite`+`removeProInvite`, `expireTrialsImpl`, `GracePeriodCron`).
7. **Task 15:** Remove the 10 billing keys from `UsersService.update` whitelist. Compiler/runtime now forbid direct writes.
8. **Task 16:** Delete the now-unused `applySnapshot` and `snapshotFromUser` private methods on `BillingService`.

---

## Task 1: Add `TRIAL_EXPIRED` event to the state machine

**Files:**
- Modify: `src/billing/state-machine/types.ts`
- Modify: `src/billing/state-machine/transitions.ts`
- Test: `src/billing/state-machine/__tests__/transitions.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `transitions.spec.ts` (inside the existing `describe('transition', ...)` block):

```ts
describe('TRIAL_EXPIRED', () => {
  it('drops paid trial state to free', () => {
    const trialing: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'active',
      billingSource: null,
      billingPeriod: 'monthly',
      currentPeriodEnd: new Date('2099-01-01'),
    };
    const next = transition(trialing, { type: 'TRIAL_EXPIRED' });
    expect(next.plan).toBe('free');
    expect(next.state).toBe('free');
    expect(next.billingSource).toBeNull();
    expect(next.billingPeriod).toBeNull();
    expect(next.currentPeriodStart).toBeNull();
    expect(next.currentPeriodEnd).toBeNull();
    expect(next.cancelAtPeriodEnd).toBe(false);
  });

  it('is a no-op on free', () => {
    const free = freeSnapshot();
    expect(transition(free, { type: 'TRIAL_EXPIRED' })).toEqual(free);
  });

  it('is a no-op on active RC subscription (trial superseded by real purchase)', () => {
    const rcActive: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodEnd: new Date('2099-01-01'),
    };
    expect(transition(rcActive, { type: 'TRIAL_EXPIRED' })).toEqual(rcActive);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/state-machine/__tests__/transitions.spec.ts -t "TRIAL_EXPIRED"`
Expected: FAIL with TypeScript error about unknown event type.

- [ ] **Step 3: Add the event to the union type**

In `src/billing/state-machine/types.ts`, add to the `BillingEvent` union (above `LS_SUBSCRIPTION_CREATED`):

```ts
  | { type: 'TRIAL_EXPIRED' }
```

- [ ] **Step 4: Add the transition case**

In `src/billing/state-machine/transitions.ts`, add this case immediately above the `LS_SUBSCRIPTION_CREATED` case:

```ts
    case 'TRIAL_EXPIRED':
      // Backend-only trial timer ran out. Skip if the user already moved
      // off trial (RC purchase superseded it, or already on free).
      if (s.state === 'free') return s;
      if (s.billingSource === 'revenuecat' || s.billingSource === 'lemon_squeezy') return s;
      return {
        ...s,
        plan: 'free',
        state: 'free',
        billingSource: null,
        billingPeriod: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        graceExpiresAt: null,
        graceReason: null,
        billingIssueAt: null,
      };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/state-machine/__tests__/transitions.spec.ts -t "TRIAL_EXPIRED"`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full state-machine suite to confirm no regression**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/state-machine`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend
git add src/billing/state-machine/types.ts src/billing/state-machine/transitions.ts src/billing/state-machine/__tests__/transitions.spec.ts
git commit -m "feat(billing): add TRIAL_EXPIRED state-machine event"
```

---

## Task 2: Add `ADMIN_GRANT_PRO` event to the state machine

**Files:**
- Modify: `src/billing/state-machine/types.ts`
- Modify: `src/billing/state-machine/transitions.ts`
- Test: `src/billing/state-machine/__tests__/transitions.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `transitions.spec.ts`:

```ts
describe('ADMIN_GRANT_PRO', () => {
  it('grants pro to a free user', () => {
    const free = freeSnapshot();
    const next = transition(free, {
      type: 'ADMIN_GRANT_PRO',
      plan: 'pro',
      invitedByUserId: 'owner-1',
    });
    expect(next.plan).toBe('pro');
    expect(next.state).toBe('active');
    expect(next.billingSource).toBeNull();
    expect(next.billingPeriod).toBeNull();
    expect(next.currentPeriodEnd).toBeNull();
    expect(next.cancelAtPeriodEnd).toBe(false);
  });

  it('throws when the user already has a paid plan', () => {
    const active: UserBillingSnapshot = {
      ...freeSnapshot(),
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
    };
    expect(() =>
      transition(active, { type: 'ADMIN_GRANT_PRO', plan: 'pro', invitedByUserId: 'x' }),
    ).toThrow(InvalidTransitionError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/state-machine/__tests__/transitions.spec.ts -t "ADMIN_GRANT_PRO"`
Expected: FAIL.

- [ ] **Step 3: Add the event to the union type**

In `src/billing/state-machine/types.ts`, add to `BillingEvent`:

```ts
  | { type: 'ADMIN_GRANT_PRO'; plan: Exclude<Plan, 'free'>; invitedByUserId: string }
```

- [ ] **Step 4: Add the transition case**

In `src/billing/state-machine/transitions.ts`, add above the `LS_SUBSCRIPTION_CREATED` case:

```ts
    case 'ADMIN_GRANT_PRO':
      // Owner-invitee grant — the invited user gets a paid plan attached
      // to no billing source. Only allowed from `free` so we never clobber
      // a real RC/LS subscription.
      if (s.state !== 'free') {
        throw new InvalidTransitionError(s.state, e.type);
      }
      return {
        ...s,
        plan: e.plan,
        state: 'active',
        billingSource: null,
        billingPeriod: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        graceExpiresAt: null,
        graceReason: null,
        billingIssueAt: null,
      };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/state-machine/__tests__/transitions.spec.ts -t "ADMIN_GRANT_PRO"`
Expected: PASS (2 tests).

- [ ] **Step 6: Run full state-machine suite**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/state-machine`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/billing/state-machine/types.ts src/billing/state-machine/transitions.ts src/billing/state-machine/__tests__/transitions.spec.ts
git commit -m "feat(billing): add ADMIN_GRANT_PRO state-machine event"
```

---

## Task 3: `inferEventFromRcSnapshot` helper

**Files:**
- Create: `src/billing/state-machine/infer-rc-event.ts`
- Test: `src/billing/state-machine/__tests__/infer-rc-event.spec.ts`

- [ ] **Step 1: Write the failing test (full decision table)**

Create `src/billing/state-machine/__tests__/infer-rc-event.spec.ts`:

```ts
import { inferEventFromRcSnapshot } from '../infer-rc-event';
import { UserBillingSnapshot, RCSubscriberSnapshot } from '../types';

const baseSnap: UserBillingSnapshot = {
  userId: 'u',
  plan: 'free',
  state: 'free',
  billingSource: null,
  billingPeriod: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  graceExpiresAt: null,
  graceReason: null,
  billingIssueAt: null,
};

const emptyRc: RCSubscriberSnapshot = {
  entitlements: {},
  latestExpirationMs: null,
  cancelAtPeriodEnd: false,
  billingIssueDetectedAt: null,
};

describe('inferEventFromRcSnapshot', () => {
  it('returns null when current=free and rc empty', () => {
    expect(inferEventFromRcSnapshot(emptyRc, baseSnap)).toBeNull();
  });

  it('emits RC_EXPIRATION when rc empty and period elapsed', () => {
    const past = new Date(Date.now() - 1000);
    const result = inferEventFromRcSnapshot(emptyRc, {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      currentPeriodEnd: past,
    });
    expect(result).toEqual({ type: 'RC_EXPIRATION' });
  });

  it('emits RC_CANCELLATION when rc empty but period still active', () => {
    const future = new Date(Date.now() + 86400_000);
    const result = inferEventFromRcSnapshot(emptyRc, {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      currentPeriodEnd: future,
    });
    expect(result).toEqual({ type: 'RC_CANCELLATION', periodEnd: future });
  });

  it('emits RC_CANCELLATION when rc.cancelAtPeriodEnd=true on otherwise active sub', () => {
    const future = new Date(Date.now() + 86400_000);
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: future, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: future.getTime(),
      cancelAtPeriodEnd: true,
      billingIssueDetectedAt: null,
    };
    const current: UserBillingSnapshot = {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      currentPeriodEnd: future,
    };
    expect(inferEventFromRcSnapshot(rc, current)).toEqual({
      type: 'RC_CANCELLATION',
      periodEnd: future,
    });
  });

  it('emits RC_BILLING_ISSUE when rc reports billing issue on active sub', () => {
    const future = new Date(Date.now() + 86400_000);
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: future, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: future.getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: new Date(),
    };
    const current: UserBillingSnapshot = {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      currentPeriodEnd: future,
    };
    expect(inferEventFromRcSnapshot(rc, current)).toEqual({ type: 'RC_BILLING_ISSUE' });
  });

  it('emits RC_INITIAL_PURCHASE when current=free and rc has active pro', () => {
    const future = new Date(Date.now() + 86400_000);
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: future, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: future.getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: null,
    };
    const result = inferEventFromRcSnapshot(rc, baseSnap, 'io.subradar.mobile.pro.monthly');
    expect(result).toMatchObject({
      type: 'RC_INITIAL_PURCHASE',
      plan: 'pro',
      period: 'monthly',
      periodEnd: future,
    });
  });

  it('emits RC_PRODUCT_CHANGE when current plan differs from rc', () => {
    const future = new Date(Date.now() + 86400_000);
    const rc: RCSubscriberSnapshot = {
      entitlements: { team: { expiresAt: future, productId: 'io.subradar.mobile.team.yearly' } },
      latestExpirationMs: future.getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: null,
    };
    const current: UserBillingSnapshot = {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodEnd: future,
    };
    const result = inferEventFromRcSnapshot(rc, current, 'io.subradar.mobile.team.yearly');
    expect(result).toMatchObject({
      type: 'RC_PRODUCT_CHANGE',
      newPlan: 'organization',
      period: 'yearly',
      periodEnd: future,
    });
  });

  it('returns null when rc and current already match (no-op)', () => {
    const future = new Date(Date.now() + 86400_000);
    const rc: RCSubscriberSnapshot = {
      entitlements: { pro: { expiresAt: future, productId: 'io.subradar.mobile.pro.monthly' } },
      latestExpirationMs: future.getTime(),
      cancelAtPeriodEnd: false,
      billingIssueDetectedAt: null,
    };
    const current: UserBillingSnapshot = {
      ...baseSnap,
      plan: 'pro',
      state: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodEnd: future,
    };
    expect(inferEventFromRcSnapshot(rc, current)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/state-machine/__tests__/infer-rc-event.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper**

Create `src/billing/state-machine/infer-rc-event.ts`:

```ts
import { BillingEvent, BillingPeriod, Plan, RCSubscriberSnapshot, UserBillingSnapshot } from './types';

function planFromProductId(productId: string | undefined): Exclude<Plan, 'free'> | null {
  if (!productId) return null;
  const lc = productId.toLowerCase();
  if (lc.includes('team') || lc.includes('org')) return 'organization';
  if (lc.includes('pro') || lc.includes('premium')) return 'pro';
  return null;
}

function periodFromProductId(productId: string | undefined): BillingPeriod {
  if (!productId) return 'monthly';
  return productId.toLowerCase().includes('yearly') ? 'yearly' : 'monthly';
}

function pickActiveEntitlement(
  rc: RCSubscriberSnapshot,
  hint?: string,
): { plan: Exclude<Plan, 'free'>; period: BillingPeriod; expiresAt: Date; productId: string } | null {
  if (hint && rc.entitlements) {
    for (const [, ent] of Object.entries(rc.entitlements)) {
      if (ent.productId === hint && (ent.expiresAt == null || ent.expiresAt.getTime() > Date.now())) {
        const plan = planFromProductId(ent.productId);
        if (plan) {
          return { plan, period: periodFromProductId(ent.productId), expiresAt: ent.expiresAt!, productId: ent.productId };
        }
      }
    }
  }
  // Pick longest-active entitlement, prefer team over pro.
  const active = Object.values(rc.entitlements).filter(
    (e) => e.expiresAt == null || e.expiresAt.getTime() > Date.now(),
  );
  const team = active.find((e) => planFromProductId(e.productId) === 'organization');
  const pro = active.find((e) => planFromProductId(e.productId) === 'pro');
  const pick = team ?? pro;
  if (!pick) return null;
  const plan = planFromProductId(pick.productId);
  if (!plan) return null;
  return { plan, period: periodFromProductId(pick.productId), expiresAt: pick.expiresAt!, productId: pick.productId };
}

/**
 * Map a RevenueCat subscriber snapshot + the user's current billing state
 * onto a single BillingEvent — the same event the webhook would produce
 * for the equivalent transition. Returns null when nothing changed.
 *
 * The state machine itself stays oblivious to RC; this helper is the
 * only RC-aware piece outside the webhook event mapper.
 */
export function inferEventFromRcSnapshot(
  rc: RCSubscriberSnapshot,
  current: UserBillingSnapshot,
  productIdHint?: string,
): BillingEvent | null {
  const active = pickActiveEntitlement(rc, productIdHint);

  if (!active) {
    if (current.state === 'free') return null;
    const periodEnd = current.currentPeriodEnd;
    if (periodEnd && periodEnd.getTime() > Date.now()) {
      return { type: 'RC_CANCELLATION', periodEnd };
    }
    return { type: 'RC_EXPIRATION' };
  }

  if (rc.billingIssueDetectedAt && (current.state === 'active' || current.state === 'cancel_at_period_end')) {
    return { type: 'RC_BILLING_ISSUE' };
  }

  if (rc.cancelAtPeriodEnd) {
    return { type: 'RC_CANCELLATION', periodEnd: active.expiresAt };
  }

  if (current.state === 'free') {
    return {
      type: 'RC_INITIAL_PURCHASE',
      plan: active.plan,
      period: active.period,
      periodStart: current.currentPeriodStart ?? new Date(),
      periodEnd: active.expiresAt,
    };
  }

  if (current.plan !== active.plan) {
    return {
      type: 'RC_PRODUCT_CHANGE',
      newPlan: active.plan,
      period: active.period,
      periodStart: current.currentPeriodStart ?? new Date(),
      periodEnd: active.expiresAt,
    };
  }

  // Plan matches; nothing to do — webhook will refresh period via RENEWAL.
  return null;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/state-machine/__tests__/infer-rc-event.spec.ts`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/billing/state-machine/infer-rc-event.ts src/billing/state-machine/__tests__/infer-rc-event.spec.ts
git commit -m "feat(billing): inferEventFromRcSnapshot helper"
```

---

## Task 4: `UserBillingRepository` skeleton

**Files:**
- Create: `src/billing/user-billing.repository.ts`
- Test: `src/billing/user-billing.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/billing/user-billing.repository.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { UserBillingRepository } from './user-billing.repository';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../common/audit/audit.service';
import { DataSource } from 'typeorm';

describe('UserBillingRepository', () => {
  let repo: UserBillingRepository;

  beforeEach(async () => {
    const userRepoMock = {
      findOne: jest.fn(),
    };
    const dataSourceMock = {
      transaction: jest.fn(async (cb) => cb({ findOne: jest.fn(), update: jest.fn() })),
    };
    const auditMock = { log: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        UserBillingRepository,
        { provide: getRepositoryToken(User), useValue: userRepoMock },
        { provide: getDataSourceToken(), useValue: dataSourceMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    repo = module.get(UserBillingRepository);
  });

  it('is instantiable', () => {
    expect(repo).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/user-billing.repository.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the skeleton**

Create `src/billing/user-billing.repository.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../common/audit/audit.service';
import { transition } from './state-machine/transitions';
import {
  BillingEvent,
  BillingPeriod,
  BillingSource,
  BillingState,
  GraceReason,
  InvalidTransitionError,
  Plan,
  UserBillingSnapshot,
} from './state-machine/types';

export type BillingActor =
  | 'webhook_rc'
  | 'webhook_ls'
  | 'user_cancel'
  | 'sync'
  | 'reconcile'
  | 'cron_trial'
  | 'cron_grace'
  | 'admin_grant';

export type TransitionResult =
  | { applied: true; from: BillingState; to: BillingState; snapshot: UserBillingSnapshot }
  | { applied: false; reason: 'invalid_transition' | 'idempotent_noop'; from: BillingState; eventType: string };

/**
 * Single source of truth for the 10 billing fields on the `users` row:
 * plan, billingStatus, billingSource, billingPeriod, currentPeriodStart,
 * currentPeriodEnd, cancelAtPeriodEnd, gracePeriodEnd, gracePeriodReason,
 * billingIssueAt.
 *
 * Every mutation funnels through `applyTransition`, which runs the pure
 * state-machine reducer and writes both the snapshot and an audit row in
 * one transaction. Direct writes via `usersService.update` are forbidden
 * (the whitelist no longer accepts these keys after Phase 1).
 */
@Injectable()
export class UserBillingRepository {
  private readonly logger = new Logger(UserBillingRepository.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async read(userId: string): Promise<UserBillingSnapshot> {
    const u = await this.userRepo.findOne({ where: { id: userId } });
    if (!u) throw new Error(`UserBillingRepository.read: user ${userId} not found`);
    return this.snapshotFromUser(u);
  }

  async applyTransition(
    _userId: string,
    _event: BillingEvent,
    _opts: { actor: BillingActor; manager?: EntityManager },
  ): Promise<TransitionResult> {
    throw new Error('not implemented');
  }

  private snapshotFromUser(u: User): UserBillingSnapshot {
    return {
      userId: u.id,
      plan: (u.plan as Plan) ?? 'free',
      state: (u.billingStatus as BillingState) ?? 'free',
      billingSource: (u.billingSource as BillingSource) ?? null,
      billingPeriod: (u.billingPeriod as BillingPeriod | null) ?? null,
      currentPeriodStart: u.currentPeriodStart ?? null,
      currentPeriodEnd: u.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: !!u.cancelAtPeriodEnd,
      graceExpiresAt: u.gracePeriodEnd ?? null,
      graceReason: (u.gracePeriodReason as GraceReason) ?? null,
      billingIssueAt: u.billingIssueAt ?? null,
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/user-billing.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/billing/user-billing.repository.ts src/billing/user-billing.repository.spec.ts
git commit -m "feat(billing): UserBillingRepository skeleton + read"
```

---

## Task 5: Implement `applyTransition` happy path

**Files:**
- Modify: `src/billing/user-billing.repository.ts`
- Modify: `src/billing/user-billing.repository.spec.ts`

- [ ] **Step 1: Add tests for happy path**

Append to `user-billing.repository.spec.ts`:

```ts
describe('applyTransition (in-memory state machine)', () => {
  it('applies RC_INITIAL_PURCHASE: persists snapshot + writes audit row', async () => {
    // Arrange: a free user
    const userId = 'user-1';
    const fakeUser: any = {
      id: userId,
      plan: 'free',
      billingStatus: 'free',
      billingSource: null,
      billingPeriod: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      gracePeriodEnd: null,
      gracePeriodReason: null,
      billingIssueAt: null,
    };
    const update = jest.fn();
    const txManager: any = {
      findOne: jest.fn().mockResolvedValue(fakeUser),
      update,
    };
    const userRepoMock: any = {
      findOne: jest.fn().mockResolvedValue(fakeUser),
    };
    const auditMock: any = { log: jest.fn().mockResolvedValue(undefined) };
    const ds: any = {
      transaction: jest.fn(async (cb) => cb(txManager)),
    };
    const repo = new UserBillingRepository(userRepoMock, ds, auditMock);

    // Act
    const periodEnd = new Date('2099-01-01');
    const result = await repo.applyTransition(
      userId,
      {
        type: 'RC_INITIAL_PURCHASE',
        plan: 'pro',
        period: 'monthly',
        periodStart: new Date('2099-01-01'),
        periodEnd,
      },
      { actor: 'sync' },
    );

    // Assert
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.from).toBe('free');
      expect(result.to).toBe('active');
      expect(result.snapshot.plan).toBe('pro');
    }
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      expect.objectContaining({ plan: 'pro', billingStatus: 'active' }),
    );
    expect(auditMock.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        action: 'billing.transition',
        metadata: expect.objectContaining({ from: 'free', to: 'active' }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests, expect failure ("not implemented")**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/user-billing.repository.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement applyTransition (happy path only — no FOR UPDATE yet, no idempotency)**

Replace the placeholder body in `user-billing.repository.ts`:

```ts
  async applyTransition(
    userId: string,
    event: BillingEvent,
    opts: { actor: BillingActor; manager?: EntityManager },
  ): Promise<TransitionResult> {
    const run = async (m: EntityManager): Promise<TransitionResult> => {
      const user = await m.findOne(User, { where: { id: userId } });
      if (!user) {
        throw new Error(`UserBillingRepository.applyTransition: user ${userId} not found`);
      }
      const current = this.snapshotFromUser(user);
      let next: UserBillingSnapshot;
      try {
        next = transition(current, event);
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          await this.audit
            .log({
              userId,
              action: 'billing.transition.invalid',
              resourceType: 'user',
              resourceId: userId,
              metadata: {
                from: current.state,
                eventType: event.type,
                actor: opts.actor,
                error: err.message,
              },
            })
            .catch(() => undefined);
          return {
            applied: false,
            reason: 'invalid_transition',
            from: current.state,
            eventType: event.type,
          };
        }
        throw err;
      }

      // Apply.
      const updates = {
        plan: next.plan,
        billingStatus: next.state,
        billingSource: next.billingSource as any,
        billingPeriod: next.billingPeriod,
        currentPeriodStart: next.currentPeriodStart,
        currentPeriodEnd: next.currentPeriodEnd,
        cancelAtPeriodEnd: next.cancelAtPeriodEnd,
        gracePeriodEnd: next.graceExpiresAt,
        gracePeriodReason: next.graceReason,
        billingIssueAt: next.billingIssueAt,
      };
      await m.update(User, userId, updates);

      await this.audit.log({
        userId,
        action: 'billing.transition',
        resourceType: 'user',
        resourceId: userId,
        metadata: {
          from: current.state,
          to: next.state,
          eventType: event.type,
          actor: opts.actor,
          payload: event,
        },
      });

      return { applied: true, from: current.state, to: next.state, snapshot: next };
    };

    if (opts.manager) return run(opts.manager);
    return this.dataSource.transaction(run);
  }
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/user-billing.repository.spec.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/billing/user-billing.repository.ts src/billing/user-billing.repository.spec.ts
git commit -m "feat(billing): UserBillingRepository.applyTransition happy path"
```

---

## Task 6: Idempotent no-op + invalid_transition behaviour

**Files:**
- Modify: `src/billing/user-billing.repository.ts`
- Modify: `src/billing/user-billing.repository.spec.ts`

- [ ] **Step 1: Add tests**

Append to `user-billing.repository.spec.ts` inside the `describe('applyTransition...')`:

```ts
  it('returns idempotent_noop when transition produces an unchanged snapshot', async () => {
    const userId = 'user-2';
    const fakeUser: any = {
      id: userId,
      plan: 'free',
      billingStatus: 'free',
      billingSource: null,
      billingPeriod: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      gracePeriodEnd: null,
      gracePeriodReason: null,
      billingIssueAt: null,
    };
    const update = jest.fn();
    const txManager: any = {
      findOne: jest.fn().mockResolvedValue(fakeUser),
      update,
    };
    const userRepoMock: any = { findOne: jest.fn().mockResolvedValue(fakeUser) };
    const auditMock: any = { log: jest.fn().mockResolvedValue(undefined) };
    const ds: any = { transaction: jest.fn(async (cb) => cb(txManager)) };
    const repo = new UserBillingRepository(userRepoMock, ds, auditMock);

    // RC_EXPIRATION on a `free` user is a no-op per the reducer.
    const result = await repo.applyTransition(userId, { type: 'RC_EXPIRATION' }, { actor: 'reconcile' });

    expect(result.applied).toBe(false);
    if (!result.applied) expect(result.reason).toBe('idempotent_noop');
    expect(update).not.toHaveBeenCalled();
    expect(auditMock.log).not.toHaveBeenCalled();
  });

  it('returns invalid_transition when reducer throws (and writes audit row)', async () => {
    const userId = 'user-3';
    const fakeUser: any = {
      id: userId,
      plan: 'pro',
      billingStatus: 'active',
      billingSource: 'revenuecat',
      billingPeriod: 'monthly',
      currentPeriodStart: null,
      currentPeriodEnd: new Date('2099-01-01'),
      cancelAtPeriodEnd: false,
      gracePeriodEnd: null,
      gracePeriodReason: null,
      billingIssueAt: null,
    };
    const update = jest.fn();
    const txManager: any = { findOne: jest.fn().mockResolvedValue(fakeUser), update };
    const userRepoMock: any = { findOne: jest.fn().mockResolvedValue(fakeUser) };
    const auditMock: any = { log: jest.fn().mockResolvedValue(undefined) };
    const ds: any = { transaction: jest.fn(async (cb) => cb(txManager)) };
    const repo = new UserBillingRepository(userRepoMock, ds, auditMock);

    // RC_UNCANCELLATION on an active sub is invalid (reducer throws).
    const result = await repo.applyTransition(userId, { type: 'RC_UNCANCELLATION' }, { actor: 'webhook_rc' });

    expect(result.applied).toBe(false);
    if (!result.applied) expect(result.reason).toBe('invalid_transition');
    expect(update).not.toHaveBeenCalled();
    expect(auditMock.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.transition.invalid' }),
    );
  });
```

- [ ] **Step 2: Run tests, expect first new test fails**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/user-billing.repository.spec.ts`
Expected: idempotent test FAIL (currently writes/audits even on no-op), invalid test PASSES (already implemented).

- [ ] **Step 3: Add idempotency check**

In `user-billing.repository.ts`, replace the post-transition section with:

```ts
      // Idempotent: skip writes when nothing changed.
      if (this.snapshotsEqual(current, next)) {
        return {
          applied: false,
          reason: 'idempotent_noop',
          from: current.state,
          eventType: event.type,
        };
      }

      const updates = {
        plan: next.plan,
        billingStatus: next.state,
        billingSource: next.billingSource as any,
        billingPeriod: next.billingPeriod,
        currentPeriodStart: next.currentPeriodStart,
        currentPeriodEnd: next.currentPeriodEnd,
        cancelAtPeriodEnd: next.cancelAtPeriodEnd,
        gracePeriodEnd: next.graceExpiresAt,
        gracePeriodReason: next.graceReason,
        billingIssueAt: next.billingIssueAt,
      };
      await m.update(User, userId, updates);
```

And add the helper:

```ts
  private snapshotsEqual(a: UserBillingSnapshot, b: UserBillingSnapshot): boolean {
    const fields: (keyof UserBillingSnapshot)[] = [
      'plan',
      'state',
      'billingSource',
      'billingPeriod',
      'currentPeriodStart',
      'currentPeriodEnd',
      'cancelAtPeriodEnd',
      'graceExpiresAt',
      'graceReason',
      'billingIssueAt',
    ];
    for (const f of fields) {
      const av = a[f];
      const bv = b[f];
      if (av instanceof Date && bv instanceof Date) {
        if (av.getTime() !== bv.getTime()) return false;
      } else if (av !== bv) {
        return false;
      }
    }
    return true;
  }
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/user-billing.repository.spec.ts`
Expected: all 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/billing/user-billing.repository.ts src/billing/user-billing.repository.spec.ts
git commit -m "feat(billing): idempotent + invalid_transition handling in UserBillingRepository"
```

---

## Task 7: `SELECT … FOR UPDATE` row lock

**Files:**
- Modify: `src/billing/user-billing.repository.ts`

- [ ] **Step 1: Update implementation**

In `user-billing.repository.ts`, change the `findOne` inside `run()` to acquire a pessimistic lock:

```ts
      const user = await m.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
```

- [ ] **Step 2: Run all repo tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/user-billing.repository.spec.ts`
Expected: 4 PASS (mocks don't care about lock options).

- [ ] **Step 3: Commit**

```bash
git add src/billing/user-billing.repository.ts
git commit -m "feat(billing): pessimistic_write lock on UserBillingRepository.applyTransition"
```

---

## Task 8: Wire `UserBillingRepository` into `BillingModule`

**Files:**
- Modify: `src/billing/billing.module.ts`

- [ ] **Step 1: Read current module**

Run: `cat src/billing/billing.module.ts`

- [ ] **Step 2: Add the provider + export**

In `src/billing/billing.module.ts`, add the import and provide/export entries:

```ts
import { UserBillingRepository } from './user-billing.repository';

// ...

@Module({
  // ...
  providers: [
    BillingService,
    GracePeriodCron,
    TelegramAlertService,
    UserBillingRepository,
  ],
  exports: [BillingService, UserBillingRepository],
})
```

- [ ] **Step 3: Compile-check**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Boot smoke test**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing/billing.service.spec.ts -t "should be defined" 2>/dev/null || echo skipped`
Expected: pass or skipped (service-level smoke).

- [ ] **Step 5: Commit**

```bash
git add src/billing/billing.module.ts
git commit -m "chore(billing): provide UserBillingRepository in BillingModule"
```

---

## Task 9: Migrate webhook handlers to `applyTransition`

**Files:**
- Modify: `src/billing/billing.service.ts`

The three webhook callsites (`processRevenueCatEvent`, `processLemonSqueezyEvent`, `handleTeamOwnerExpiration`) currently use the private `applySnapshot` helper. Switch them to call `userBilling.applyTransition` with the existing `manager` (so they stay inside the webhook transaction).

- [ ] **Step 1: Inject the repository**

In `billing.service.ts` constructor, add the parameter:

```ts
    private readonly userBilling: UserBillingRepository,
```

And add the import at top:

```ts
import { UserBillingRepository } from './user-billing.repository';
```

- [ ] **Step 2: Migrate `handleTeamOwnerExpiration` (line ~244)**

Replace:

```ts
      const next = transition(current, {
        type: 'TEAM_OWNER_EXPIRED',
        memberHasOwnSub,
      });
      await this.applySnapshot(m, u, next);
```

With:

```ts
      await this.userBilling.applyTransition(
        u.id,
        { type: 'TEAM_OWNER_EXPIRED', memberHasOwnSub },
        { actor: 'webhook_rc', manager: m },
      );
```

(The local `current` variable that was only fed to `transition()` can be removed.)

- [ ] **Step 3: Migrate `processRevenueCatEvent` (around line 791)**

Replace the post-`transition()` section (the `await this.applySnapshot(...)` call near line 568 — and the matching one near line 831 in `processRevenueCatEvent`) with:

```ts
      const result = await this.userBilling.applyTransition(
        user.id,
        billingEvent,
        { actor: 'webhook_rc', manager: m },
      );
      if (!result.applied) return;
      // Re-read user object for downstream code that needs the new state.
      Object.assign(user, await m.findOne(User, { where: { id: user.id } }));
```

(Replace the explicit `transition()` + `applySnapshot()` block. The `result.applied=false` early return matches today's "invalid_transition swallow" behaviour.)

- [ ] **Step 4: Migrate `processLemonSqueezyEvent`**

Same pattern as Step 3 — find the `applySnapshot` call inside the LS webhook handler (around line 568) and replace with `userBilling.applyTransition` (`actor: 'webhook_ls'`).

- [ ] **Step 5: Run the existing webhook tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing`
Expected: all green. Pay particular attention to webhook-handler specs and `processRevenueCatEvent` integration tests.

- [ ] **Step 6: Commit**

```bash
git add src/billing/billing.service.ts
git commit -m "refactor(billing): webhook handlers use UserBillingRepository.applyTransition"
```

---

## Task 10: Migrate `syncRevenueCat` (decompose into `inferEventFromRcSnapshot`)

**Files:**
- Modify: `src/billing/billing.service.ts`

- [ ] **Step 1: Extract the RC fetch into a helper**

Above `syncRevenueCat` in `billing.service.ts`, add a private helper that returns an `RCSubscriberSnapshot`:

```ts
  private async fetchRcSubscriberSnapshot(userId: string): Promise<RCSubscriberSnapshot> {
    const apiKey =
      this.cfg.get<string>('REVENUECAT_API_KEY_SECRET', '') ||
      this.cfg.get<string>('REVENUECAT_API_KEY', '');
    if (!apiKey) throw new ServiceUnavailableException('Billing verification temporarily unavailable.');
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } },
    );
    if (!res.ok) throw new ServiceUnavailableException('Billing verification temporarily unavailable.');
    const data = await res.json();
    const ents = data?.subscriber?.entitlements ?? {};
    const subs = data?.subscriber?.subscriptions ?? {};
    const now = Date.now();
    const entitlements: Record<string, { expiresAt: Date | null; productId: string }> = {};
    let latestExpirationMs: number | null = null;
    for (const [name, value] of Object.entries(ents) as [string, any][]) {
      const expRaw = value?.expires_date;
      const expMs = typeof expRaw === 'number' ? expRaw : expRaw ? Date.parse(String(expRaw)) : NaN;
      if (!isNaN(expMs) && expMs > now) {
        entitlements[name] = {
          expiresAt: new Date(expMs),
          productId: String(value?.product_identifier ?? ''),
        };
        if (latestExpirationMs == null || expMs > latestExpirationMs) latestExpirationMs = expMs;
      }
    }
    const cancelAtPeriodEnd = Object.values(subs).some((s: any) => s && s.unsubscribe_detected_at);
    const billingIssueDetectedAt = Object.values(subs)
      .map((s: any) => s?.billing_issues_detected_at)
      .filter(Boolean)
      .map((v) => new Date(String(v)))
      .reduce<Date | null>((acc, d) => (!acc || d > acc ? d : acc), null);
    return { entitlements, latestExpirationMs, cancelAtPeriodEnd, billingIssueDetectedAt };
  }
```

Add the imports at top of file:

```ts
import { RCSubscriberSnapshot } from './state-machine/types';
import { inferEventFromRcSnapshot } from './state-machine/infer-rc-event';
```

- [ ] **Step 2: Replace the body of `syncRevenueCat`**

Replace the entire current `syncRevenueCat` body with:

```ts
  async syncRevenueCat(userId: string, productId: string): Promise<void> {
    const rc = await this.fetchRcSubscriberSnapshot(userId);

    const matchingActive = Object.values(rc.entitlements).some(
      (e) => e.productId === productId,
    );
    const tierMatches = Object.entries(rc.entitlements).some(([name, e]) => {
      const lc = name.toLowerCase();
      const lcProduct = productId.toLowerCase();
      if (lcProduct.includes('team') || lcProduct.includes('org')) return lc.includes('team') || lc.includes('org');
      return lc.includes('pro') || lc.includes('premium');
    });
    if (!matchingActive && !tierMatches) {
      this.logger.warn(
        `syncRevenueCat: user ${userId} has no active entitlement matching product=${productId}`,
      );
      throw new ForbiddenException('No active RevenueCat entitlement found for this account.');
    }

    const current = await this.userBilling.read(userId);
    const event = inferEventFromRcSnapshot(rc, current, productId);
    if (!event) {
      this.logger.log(`syncRevenueCat: user ${userId} already in sync`);
      return;
    }
    await this.userBilling.applyTransition(userId, event, { actor: 'sync' });
    this.logger.log(`syncRevenueCat: user ${userId} → ${event.type}`);
  }
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/billing/billing.service.ts
git commit -m "refactor(billing): syncRevenueCat routes through state machine"
```

---

## Task 11: Migrate `reconcileRevenueCat`

**Files:**
- Modify: `src/billing/billing.service.ts`

- [ ] **Step 1: Replace the body**

Replace the entire `reconcileRevenueCat` body with:

```ts
  async reconcileRevenueCat(userId: string): Promise<{
    action: 'noop' | 'cancel_at_period_end' | 'downgraded';
    reason: string;
  }> {
    const current = await this.userBilling.read(userId);
    if (current.billingSource !== 'revenuecat') return { action: 'noop', reason: `billingSource=${current.billingSource ?? 'null'}` };
    if (current.state === 'free') return { action: 'noop', reason: 'already free' };

    let rc: RCSubscriberSnapshot;
    try {
      rc = await this.fetchRcSubscriberSnapshot(userId);
    } catch (e: any) {
      this.logger.warn(`reconcileRevenueCat: RC fetch failed for ${userId}: ${e?.message}`);
      return { action: 'noop', reason: 'rc_fetch_failed' };
    }

    const event = inferEventFromRcSnapshot(rc, current);
    if (!event) return { action: 'noop', reason: 'rc_in_sync' };

    const result = await this.userBilling.applyTransition(userId, event, { actor: 'reconcile' });
    if (!result.applied) return { action: 'noop', reason: result.reason };

    if (event.type === 'RC_CANCELLATION') return { action: 'cancel_at_period_end', reason: event.type };
    if (event.type === 'RC_EXPIRATION') return { action: 'downgraded', reason: event.type };
    return { action: 'noop', reason: event.type };
  }
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/billing/billing.service.ts
git commit -m "refactor(billing): reconcileRevenueCat routes through state machine"
```

---

## Task 12: Migrate `cancelSubscription`

**Files:**
- Modify: `src/billing/billing.service.ts`

- [ ] **Step 1: Replace the body**

Replace the entire `cancelSubscription` body with:

```ts
  async cancelSubscription(userId: string): Promise<void> {
    const current = await this.userBilling.read(userId);
    this.logger.log(`cancelSubscription: user ${userId} state=${current.state} plan=${current.plan} source=${current.billingSource ?? 'null'}`);

    if (current.state === 'free') {
      this.logger.warn(`cancelSubscription: user ${userId} already on free plan`);
      return;
    }

    const u = await this.usersService.findById(userId);
    const isOnBackendTrial =
      u.trialEndDate &&
      new Date(u.trialEndDate) > new Date() &&
      current.billingSource !== 'revenuecat' &&
      current.billingSource !== 'lemon_squeezy';
    if (isOnBackendTrial) {
      await this.userBilling.applyTransition(userId, { type: 'TRIAL_EXPIRED' }, { actor: 'user_cancel' });
      // Trial-specific bookkeeping (clearing trialEndDate) still goes through usersService.
      await this.usersService.update(userId, { trialEndDate: undefined as any });
      this.logger.log(`cancelSubscription: trial cancelled for user ${userId}`);
      return;
    }

    if (current.billingSource === 'revenuecat') {
      await this.userBilling.applyTransition(
        userId,
        { type: 'RC_CANCELLATION', periodEnd: current.currentPeriodEnd ?? new Date() },
        { actor: 'user_cancel' },
      );
      this.logger.log(`cancelSubscription: RC cancel-at-period-end for user ${userId}`);
      return;
    }

    if (current.billingSource === 'lemon_squeezy') {
      await this.userBilling.applyTransition(userId, { type: 'LS_SUBSCRIPTION_CANCELLED' }, { actor: 'user_cancel' });
      return;
    }

    // No billing source but plan != free (legacy admin grant).
    await this.userBilling.applyTransition(userId, { type: 'TRIAL_EXPIRED' }, { actor: 'user_cancel' });
  }
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/billing/billing.service.ts
git commit -m "refactor(billing): cancelSubscription routes through state machine"
```

---

## Task 13: Migrate `activateProInvite` and `removeProInvite`

**Files:**
- Modify: `src/billing/billing.service.ts`

- [ ] **Step 1: Replace billing-field mutation in `activateProInvite`**

Inside the `dataSource.transaction` block of `activateProInvite`, replace:

```ts
      invitee.plan = 'pro';
      invitee.billingSource = null as any;
      invitee.invitedByUserId = owner.id;
      owner.proInviteeEmail = email;
      await m.save([owner, invitee]);
```

With:

```ts
      // billing fields go through the state machine; non-billing fields
      // (proInviteeEmail / invitedByUserId) stay on the row.
      invitee.invitedByUserId = owner.id;
      owner.proInviteeEmail = email;
      await m.save([owner, invitee]);

      await this.userBilling.applyTransition(
        invitee.id,
        { type: 'ADMIN_GRANT_PRO', plan: 'pro', invitedByUserId: owner.id },
        { actor: 'admin_grant', manager: m },
      );
```

- [ ] **Step 2: Replace billing-field mutation in `downgradeInviteeIfEligible`** (line ~1084)

Replace this block (currently around lines 1097-1102):

```ts
      const previousPlan = invitee.plan;
      const inviterId = invitee.invitedByUserId;
      invitee.plan = 'free';
      invitee.billingSource = null as any;
      invitee.invitedByUserId = null;
      await m.save(invitee);
```

With:

```ts
      const previousPlan = invitee.plan;
      const inviterId = invitee.invitedByUserId;
      invitee.invitedByUserId = null;
      await m.save(invitee);

      // billing fields owned by the state machine — TRIAL_EXPIRED resets to
      // free + clears billingSource + period in one transition.
      await this.userBilling.applyTransition(
        invitee.id,
        { type: 'TRIAL_EXPIRED' },
        { actor: 'admin_grant', manager: m },
      );
```

The audit + outbox calls below the replaced block stay unchanged — they reference `previousPlan` which is captured before the transition.

- [ ] **Step 3: Run tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/billing/billing.service.ts
git commit -m "refactor(billing): pro-invite grants/revokes route through state machine"
```

---

## Task 14: Migrate `expireTrials` cron

**Files:**
- Modify: `src/reminders/reminders.service.ts`
- Modify: `src/reminders/reminders.module.ts`

- [ ] **Step 1: Inject `UserBillingRepository`**

In `reminders.service.ts`:

```ts
import { UserBillingRepository } from '../billing/user-billing.repository';
```

Add to the constructor:

```ts
    private readonly userBilling: UserBillingRepository,
```

In `reminders.module.ts`, add `BillingModule` to imports:

```ts
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [/* existing */, BillingModule],
  // ...
})
```

- [ ] **Step 2: Replace the body of `expireTrialsImpl`**

Replace:

```ts
      await this.userRepo.update(user.id, {
        plan: 'free',
        billingStatus: 'free' as any,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null as any,
        trialEndDate: null as any,
      });
```

With:

```ts
      await this.userBilling.applyTransition(user.id, { type: 'TRIAL_EXPIRED' }, { actor: 'cron_trial' });
      await this.userRepo.update(user.id, { trialEndDate: null as any });
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/reminders`
Expected: all green (existing `expireTrials` spec at `reminders.service.spec.ts:170` should still pass — the resolved snapshot is identical).

- [ ] **Step 4: Commit**

```bash
git add src/reminders/reminders.service.ts src/reminders/reminders.module.ts
git commit -m "refactor(billing): expireTrials cron routes through state machine"
```

---

## Task 15: Migrate `GracePeriodCron`

**Files:**
- Modify: `src/billing/grace-period.cron.ts`

- [ ] **Step 1: Inject `UserBillingRepository`**

```ts
import { UserBillingRepository } from './user-billing.repository';
```

In the constructor:

```ts
    private readonly userBilling: UserBillingRepository,
```

- [ ] **Step 2: Replace the body of `resetExpiredGrace`**

Replace the per-user `userRepo.save(u)` block with:

```ts
      for (const u of users) {
        await this.userBilling.applyTransition(u.id, { type: 'GRACE_EXPIRED' }, { actor: 'cron_grace' });
        count++;
      }
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest src/billing`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/billing/grace-period.cron.ts
git commit -m "refactor(billing): GracePeriodCron routes through state machine"
```

---

## Task 16: Lock the door — remove billing keys from `UsersService.update` whitelist

**Files:**
- Modify: `src/users/users.service.ts`

- [ ] **Step 1: Confirm no remaining callers**

Run:

```bash
cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend
grep -rn "usersService\.update\|userRepo\.update\|userRepo\.save" src --include="*.ts" \
  | grep -v "user-billing.repository\|users.service.ts\|reminders.service.ts" \
  | head -50
```

Expected: no remaining hit writes any of the 10 billing keys (`plan`, `billingStatus`, `billingSource`, `billingPeriod`, `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `gracePeriodEnd`, `gracePeriodReason`, `billingIssueAt`). If any remain, migrate them before proceeding.

- [ ] **Step 2: Remove the keys from `ALLOWED_KEYS`**

In `src/users/users.service.ts`, remove these from the `ALLOWED_KEYS` set:

- `'plan'`
- `'billingSource'`
- `'billingPeriod'`
- `'billingStatus'`
- `'currentPeriodStart'`
- `'currentPeriodEnd'`
- `'cancelAtPeriodEnd'`
- `'gracePeriodEnd'`
- `'gracePeriodReason'`
- `'billingIssueAt'`

Replace the comment block above with:

```ts
    // The 10 billing fields (plan, billingStatus, billingSource, billingPeriod,
    // currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, gracePeriodEnd,
    // gracePeriodReason, billingIssueAt) are owned by UserBillingRepository.
    // They are intentionally NOT listed here — any caller that needs to mutate
    // them must go through `userBilling.applyTransition`.
```

- [ ] **Step 3: Run the full test suite**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest`
Expected: all green. Any failure here means a caller still uses the whitelist for billing fields and must be migrated.

- [ ] **Step 4: Type-check**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/users/users.service.ts
git commit -m "feat(billing): remove billing fields from UsersService.update whitelist"
```

---

## Task 17: Delete the now-unused `applySnapshot` and `snapshotFromUser` from `BillingService`

**Files:**
- Modify: `src/billing/billing.service.ts`

- [ ] **Step 1: Confirm dead**

Run:

```bash
grep -n "applySnapshot\|snapshotFromUser" src/billing/billing.service.ts
```

Expected: only the definitions themselves (no callers).

- [ ] **Step 2: Delete the two private methods**

Remove the `applySnapshot` and `snapshotFromUser` private methods from `billing.service.ts`. Their behaviour is now covered by `UserBillingRepository`.

- [ ] **Step 3: Run tests**

Run: `cd /Users/timurzharlykpaev/Desktop/repositories/subradar-backend && npx jest`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/billing/billing.service.ts
git commit -m "refactor(billing): drop obsolete applySnapshot/snapshotFromUser"
```

---

## Self-review checklist (run before handoff)

- [ ] Each new event (`TRIAL_EXPIRED`, `ADMIN_GRANT_PRO`) has at least 2 reducer tests.
- [ ] `inferEventFromRcSnapshot` covers each row of the decision table in §3.1 of the spec.
- [ ] Every old `usersService.update` / `userRepo.update` callsite that touched a billing field has been migrated to `userBilling.applyTransition`.
- [ ] No new billing field reads/writes outside `UserBillingRepository`.
- [ ] Webhook tests (`processRevenueCatEvent`, `processLemonSqueezyEvent`) still green.
- [ ] `git log --oneline` shows one commit per task — easy to revert any single step.

---

## Out of scope for Phase 1 (separate plan later)

- Physical split of the 10 billing fields into a `user_billing` table.
- DB CHECK constraints (`billing_state_plan_consistent`, etc.).
- Healing migration that normalises any existing drifted rows on prod.
- Mobile-side changes (already shipped via E.1 quick-fix).
