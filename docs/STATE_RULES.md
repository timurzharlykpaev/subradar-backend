<!-- SHARED: subradar-backend, subradar-web, subradar-mobile -->
<!-- Canonical: subradar-backend/docs/STATE_RULES.md -->
<!-- Synced: 2026-03-07 -->

# SubRadar AI — State Rules

## Subscription Status Lifecycle

```
        ┌──────────────────────────────────────┐
        │                                      v
    TRIAL ──(trial expires)──> ACTIVE ──(pause)──> PAUSED
        │                        │                   │
        │                        │                   │
        v                        v                   v
    CANCELLED <──(cancel)──── ACTIVE <──(resume)── PAUSED
        │
        v
    ARCHIVED
```

### Status Rules

| Status | nextBillingDate | In forecast | Reminders | In main list | Notes |
|--------|----------------|-------------|-----------|-------------|-------|
| TRIAL | No (uses trialEndDate) | Yes (after trial) | Trial expiry | Yes | Has trialEndDate |
| ACTIVE | Yes | Yes | Billing reminders | Yes | Main working state |
| PAUSED | Frozen | No | No | Yes | User temporarily paused |
| CANCELLED | No | No | No | Yes | User cancelled |
| ARCHIVED | No | No | No | No (history only) | Soft-deleted from view |

### Transitions

- **TRIAL -> ACTIVE**: When trial period expires and user doesn't cancel
- **TRIAL -> CANCELLED**: User cancels during trial
- **ACTIVE -> PAUSED**: User pauses subscription
- **ACTIVE -> CANCELLED**: User cancels subscription
- **PAUSED -> ACTIVE**: User resumes subscription
- **Any -> ARCHIVED**: User archives (removes from main list, keeps in history)

## Screen States

Every screen in the app must handle these states:

### 1. Loading
- Show skeleton/shimmer, not blank screen
- Keep navigation accessible

### 2. Empty
- **Never show a "dead" empty screen**
- Empty state must sell the next action:
  - Add a subscription
  - Enable notifications
  - Try AI
  - Upgrade to Pro

### 3. Error
- Show retry button
- Show fallback action (e.g., "Continue to sign in")
- Don't hide quick actions on error

### 4. Success
- Confirmation feedback (toast, animation)
- Clear next step

### 5. Partial data
- If only 1-2 subscriptions: show simplified cards, don't overload with charts
- Encourage adding more data

## Empty State Philosophy

If there's no data, the screen should not be "dead." It must lead the user forward:

| Screen | Empty state action |
|--------|-------------------|
| Home | "Add your first subscription" with 3 CTAs (manual, AI, photo) |
| Subscriptions | "No subscriptions yet" + Add button |
| Analytics | "Add subscriptions to see analytics" |
| Reports | "Generate your first report" |
| Cards | "Add a payment card" |
| Trials | "No active trials" + explain trial tracking |

## Error Handling Principles

1. AI errors must never break the add subscription flow
2. Network errors show retry + offline cache fallback
3. Backend errors show user-friendly message, not raw error
4. Failed PDF generation shows retry option
5. Failed AI parsing offers manual entry
