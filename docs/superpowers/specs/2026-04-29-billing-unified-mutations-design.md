# Billing — Unified Mutations Design

**Date:** 2026-04-29
**Author:** Timur + Claude
**Status:** approved (pending user spec review)

## 1. Problem

Billing-related fields on the `users` row are written from at least 8 places:

- `processRevenueCatEvent` (RC webhook) — uses `applySnapshot` ✅
- `processLemonSqueezyEvent` (LS webhook) — uses `applySnapshot` ✅
- `expireTrials` cron — uses `applySnapshot` ✅
- `syncRevenueCat` (mobile Restore / post-purchase) — direct `usersService.update` ❌
- `reconcileRevenueCat` (drift healing) — direct ❌
- `cancelSubscription` (mobile cancel) — direct ❌
- `activateProInvite` (admin grant) — direct ❌
- `GracePeriodCron.resetExpiredGrace` — direct ❌

Each direct path writes a slightly different subset of columns; missed columns silently desync the user row from the state machine, producing user-visible bugs:

- Apple-Settings cancel + Restore re-stamps the row to `active` because Restore's `productId` selection picks the cancelled-but-active entitlement and `syncRevenueCat` writes `cancelAtPeriodEnd=false` on top.
- `cancelSubscription` initially forgot to set `billingStatus='cancel_at_period_end'` (only set the boolean flag), so `/billing/me` kept reporting `state: 'active'`.
- `GracePeriodCron` was leaving `billingStatus='grace_pro'` forever after grace lapsed, so `EffectiveAccessResolver` never downgraded the user.
- `UsersService.update` whitelist silently drops unlisted keys — every "missing column" bug above lived undetected because the call returned successfully.

Short-term patches (commits `737d074`, `3f6eb91`, `f39ed8b`, `9145e3a`) fixed the visible symptoms. They did not fix the structural problem: there is no single point of mutation that the state machine controls.

## 2. Goal

Make billing-field mutations physically impossible outside the state machine.

Three layers of enforcement:

1. **Compile-time** — billing fields are removed from the `User` entity type. Direct assignment (`user.plan = 'pro'`) does not compile.
2. **Code structure** — `UsersService.update` whitelist no longer accepts billing keys. The only repository that owns these columns is `UserBillingRepository`.
3. **Database** — `CHECK` constraints on the dedicated `user_billing` table reject physically inconsistent combinations (`state='free'` + `plan='pro'`, `state='cancel_at_period_end'` + `cancelAtPeriodEnd=false`, etc.).

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Callers                                                         │
│  - processRevenueCatEvent (webhook)                              │
│  - processLemonSqueezyEvent (webhook)                            │
│  - syncRevenueCat                ─┐                              │
│  - reconcileRevenueCat           ─┼─ inferEventFromRcSnapshot()  │
│  - cancelSubscription            ─┘                              │
│  - expireTrials cron                                             │
│  - GracePeriodCron                                               │
│  - activateProInvite                                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │  applyTransition(userId, event, opts)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  UserBillingRepository                                           │
│  ─────────────────────────────────────────────────────────       │
│  +applyTransition(userId, event, opts): TransitionResult         │
│  +read(userId): UserBillingSnapshot                              │
│                                                                  │
│  Internals: SELECT FOR UPDATE → snapshotFromRow                  │
│           → transition(s, e) [pure]                              │
│           → applySnapshot → audit-log                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: 10 billing fields stay on `users` table                 │
│          (facade hides this from callers)                        │
│  Step 2: physically split into `user_billing` table              │
│          + CHECK constraints                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Components

#### `UserBillingRepository`

```ts
type Actor =
  | 'webhook_rc' | 'webhook_ls'
  | 'user_cancel' | 'sync' | 'reconcile'
  | 'cron_trial' | 'cron_grace'
  | 'admin_grant';

type TransitionResult =
  | { applied: true;  from: BillingState; to: BillingState; snapshot: UserBillingSnapshot }
  | { applied: false; reason: 'invalid_transition' | 'idempotent_noop'; from: BillingState; eventType: string };

@Injectable()
export class UserBillingRepository {
  async read(userId: string): Promise<UserBillingSnapshot>;
  async applyTransition(
    userId: string,
    event: BillingEvent,
    opts: { actor: Actor; manager?: EntityManager },
  ): Promise<TransitionResult>;
}
```

Behaviour:

- If `manager` is passed, writes use that EntityManager (caller's transaction).
  Otherwise, opens its own transaction.
- `SELECT … FOR UPDATE` on the row before reading the snapshot, to serialise
  concurrent webhooks/reconciles for the same user. In Phase 1 the lock is on
  the `users` row; in Phase 2 it moves to the `user_billing` row.
- `transition()` throwing `InvalidTransitionError` is caught and converted
  to `{ applied: false, reason: 'invalid_transition' }` plus an audit row.
  We do **not** propagate — duplicate webhook deliveries must not retry.
- `transition()` returning the same snapshot (deep-equal) → `idempotent_noop`,
  no DB write, no audit row.
- Each successful transition writes one `audit_log` row with
  `action='billing.transition'` and `metadata = { from, to, eventType, actor, payload }`.

#### `inferEventFromRcSnapshot()`

```ts
// src/billing/state-machine/infer-rc-event.ts
export function inferEventFromRcSnapshot(
  rc: RCSubscriberSnapshot,
  current: UserBillingSnapshot,
  productIdHint?: string,
): BillingEvent | null;
```

Decision table:

| `rc` snapshot                                      | `current.state`             | Emitted event             |
|----------------------------------------------------|-----------------------------|---------------------------|
| no active entitlements + period elapsed            | any except `free`           | `RC_EXPIRATION`           |
| no active entitlements + period still active       | any except `free`           | `RC_CANCELLATION`         |
| active entitlement + `unsubscribe_detected_at`     | `active`                    | `RC_CANCELLATION`         |
| active entitlement + `billing_issues_detected_at`  | `active` / `cancel_at_period_end` | `RC_BILLING_ISSUE`  |
| active entitlement + plan/period changed           | `free` or different `plan`  | `RC_INITIAL_PURCHASE` or `RC_PRODUCT_CHANGE` |
| active entitlement, all fields match `current`     | any                         | `null` (no-op)            |

The state machine itself stays oblivious to RC — `inferEventFromRcSnapshot`
is the only RC-aware piece outside the webhook event mapper.

#### Refactored callers (skeletons)

```ts
async syncRevenueCat(userId: string, productId: string) {
  const rc = await this.fetchRcSnapshot(userId);
  this.assertEntitlementMatches(rc, productId); // 403 if RC doesn't see it
  const current = await this.userBilling.read(userId);
  const event = inferEventFromRcSnapshot(rc, current, productId);
  if (event) await this.userBilling.applyTransition(userId, event, { actor: 'sync' });
}

async reconcileRevenueCat(userId: string) {
  const rc = await this.fetchRcSnapshot(userId);
  const current = await this.userBilling.read(userId);
  const event = inferEventFromRcSnapshot(rc, current);
  if (!event) return { action: 'noop' };
  return this.userBilling.applyTransition(userId, event, { actor: 'reconcile' });
}

async cancelSubscription(userId: string) {
  const u = await this.userBilling.read(userId);
  if (u.state === 'free') return;
  if (this.isOnBackendTrial(u)) {
    return this.userBilling.applyTransition(userId, { type: 'RC_REFUND' }, { actor: 'user_cancel' });
  }
  return this.userBilling.applyTransition(userId, {
    type: 'RC_CANCELLATION',
    periodEnd: u.currentPeriodEnd ?? new Date(),
  }, { actor: 'user_cancel' });
}
```

### 3.2 Migration steps

| Phase | Change | Reversible? |
|-------|--------|-------------|
| **1. Facade**         | Add `UserBillingRepository`. Migrate 8 callers to `applyTransition`. Remove 10 keys from `UsersService.update` whitelist. Mark fields `@deprecated` on `User`. | Yes — `git revert`. No DB change. |
| **2a. Dual-write**    | TypeORM migration: `CREATE TABLE user_billing` with same shape, `INSERT INTO user_billing SELECT … FROM users`. `UserBillingRepository` reads/writes `user_billing`. Columns on `users` remain (read-only, not used). | Yes — drop new table, revert code. |
| **2b. CHECK + drop**  | Add `CHECK` constraints on `user_billing`. After 24h soak: `ALTER TABLE users DROP COLUMN …` (10 columns). | Down migration kept on disk; copy data back if needed. |

**Pre-flight check (in 2a):** before `INSERT`, run `SELECT count(*) FROM users WHERE <constraint_violated>` for each future constraint. Heal violators in the same transaction (`UPDATE … SET state='free', plan='free', …` for unrecoverable rows).

### 3.3 CHECK constraints (Phase 2b)

```sql
ALTER TABLE user_billing ADD CONSTRAINT billing_state_plan_consistent CHECK (
  (state = 'free' AND plan = 'free')
  OR (state != 'free' AND plan != 'free')
);

ALTER TABLE user_billing ADD CONSTRAINT billing_cancel_flag_matches_state CHECK (
  state = 'billing_issue'
  OR (state = 'cancel_at_period_end' AND cancel_at_period_end = true)
  OR (state != 'cancel_at_period_end' AND cancel_at_period_end = false)
);

ALTER TABLE user_billing ADD CONSTRAINT billing_grace_state_has_end CHECK (
  (state IN ('grace_pro','grace_team') AND grace_period_end IS NOT NULL)
  OR (state NOT IN ('grace_pro','grace_team') AND grace_period_end IS NULL)
);

ALTER TABLE user_billing ADD CONSTRAINT billing_paid_state_has_period CHECK (
  state IN ('free','grace_pro','grace_team','billing_issue')
  OR current_period_end IS NOT NULL
);

ALTER TABLE user_billing ADD CONSTRAINT billing_source_required_for_paid CHECK (
  state = 'free' OR billing_source IS NOT NULL
);
```

## 4. Transactional boundaries

| Caller | Transaction owner | `manager` passed? |
|---|---|---|
| RC webhook (`processRevenueCatEvent`) | outer `dataSource.transaction()` | yes |
| LS webhook | outer | yes |
| `syncRevenueCat`     | inner (in repo) | no |
| `reconcileRevenueCat`| inner | no |
| `cancelSubscription` | inner | no |
| `expireTrials` cron  | per-user outer (one fail doesn't block others) | yes |
| `GracePeriodCron`    | inner per user | no |
| `activateProInvite`  | inner | no |

`SELECT … FOR UPDATE` on the user_billing row is acquired inside `applyTransition`,
preventing webhook + reconcile races on the same user.

## 5. Error handling

| Situation | Behaviour |
|---|---|
| `transition()` throws `InvalidTransitionError` | Caught in `applyTransition` → `{ applied: false, reason: 'invalid_transition' }` + audit row. No exception. |
| `transition()` returns identical snapshot (no-op) | `{ applied: false, reason: 'idempotent_noop' }`. No DB write, no audit row. |
| RC API down (`syncRevenueCat`) | 503 to client, nothing written. Not a drift, just outage. |
| CHECK-constraint violation (Phase 2b+) | Application crash with clear message. Means a `transition()` bug, not a valid case. |
| Concurrent webhook + reconcile | `SELECT FOR UPDATE` serialises; second one re-reads snapshot. Likely yields `idempotent_noop`. |

## 6. Testing

| Layer | New tests |
|---|---|
| `state-machine/transitions.spec.ts` | unchanged |
| `infer-rc-event.spec.ts` (new) | ~25 cases covering the decision table |
| `user-billing.repository.spec.ts` (new) | applied / idempotent_noop / invalid_transition; transaction rollback when audit fails; FOR UPDATE serialisation |
| `billing.service.integration.spec.ts` (new) | end-to-end: cancel → reconcile → repurchase scenario currently breaking prod. Real Postgres via testcontainers, CHECK constraints active. |
| Existing webhook specs | Repackaged to call `applyTransition`, behaviour unchanged. |

## 7. Rollback plan

### Phase 1
- `git revert`. Zero DB change. ~10 callsites refactored.
- Risk: zero on DB layer, medium on code (focused refactor).

### Phase 2a (dual-write)
- Drop `user_billing` table, revert code. Data on `users` stays the source of truth during 2a.

### Phase 2b (CHECK + DROP COLUMN)
- 24h soak between 2a and 2b. If 2a is healthy, drop columns.
- Down migration kept on disk: re-add columns, `INSERT INTO users SELECT … FROM user_billing`, drop the new table.
- Risk: medium — `ALTER TABLE users DROP COLUMN` blocks the table for the duration of the lock. On Postgres this is fast (metadata-only) but still requires the AccessExclusive lock.

## 8. Out of scope

- Full event-sourcing (`user_billing_events` table) — kept as `audit_log` rows.
- Trial / AI usage fields — stay on `users`.
- Changes to `EffectiveAccessResolver` — it already reads only the snapshot.
- Mobile-side changes (handled by E.1–E.4 quick-fixes).

## 9. Estimated effort

- Phase 1 (facade + caller refactor + tests): ~3 days
- Phase 2a (dual-write migration + repo switch): ~1 day
- Phase 2b (CHECK constraints + drop columns): ~1 day
- **Total: ~5 days**

## 10. Open questions

None at design time. All Q1–Q5 from the brainstorming session resolved:
- Q1 → C: full overhaul
- Q2 → A: 10 state-machine fields only
- Q3 → B: TypeScript + repository + DB CHECK constraints
- Q4 → B: decompose into existing events via `inferEventFromRcSnapshot`
- Q5 → B: strangler fig (facade first, table split second)
