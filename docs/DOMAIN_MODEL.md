<!-- SHARED: subradar-backend, subradar-web, subradar-mobile -->
<!-- Canonical: subradar-backend/docs/DOMAIN_MODEL.md -->
<!-- Synced: 2026-03-07 -->

# SubRadar AI — Domain Model

## Enums (UPPERCASE, synced with backend)

```typescript
type BillingCycle = 'MONTHLY' | 'YEARLY' | 'WEEKLY' | 'QUARTERLY' | 'LIFETIME' | 'ONE_TIME'

type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'ARCHIVED'

type Category =
  | 'STREAMING' | 'AI_SERVICES' | 'INFRASTRUCTURE' | 'PRODUCTIVITY'
  | 'MUSIC' | 'GAMING' | 'NEWS' | 'HEALTH' | 'OTHER'

type SourceType = 'MANUAL' | 'AI_TEXT' | 'AI_PHOTO' | 'IMPORTED'

type CardBrand = 'VISA' | 'MASTERCARD' | 'AMEX' | 'MIR' | 'UNIONPAY' | 'OTHER'
```

## Subscription

```typescript
{
  id: uuid
  userId: uuid
  workspaceId?: uuid                  // optional, for team subscriptions

  // Core fields
  name: string                        // "Netflix", "DigitalOcean"
  normalizedServiceId?: string        // optional, links to known service DB
  category: Category
  amount: decimal
  currency: string                    // USD, EUR, RUB, KZT
  billingPeriod: BillingCycle
  nextBillingDate?: string            // ISO date
  startDate?: string                  // ISO date

  // Status
  status: SubscriptionStatus
  currentPlan?: string                // "Basic", "Pro", "Family"

  // Trial
  trialEndDate?: string               // ISO date, if status = TRIAL

  // Links
  serviceUrl?: string                 // Service website
  cancelUrl?: string                  // Direct cancel link
  manageUrl?: string                  // Manage plan link
  iconUrl?: string                    // Service icon URL

  // Notes & tags
  notes?: string
  tags?: string[]
  isBusinessExpense: boolean

  // Reminders
  reminderEnabled: boolean
  reminderOffsets?: number[]           // [1, 3, 7] days before billing

  // Payment card
  paymentCardId?: uuid

  // AI metadata
  sourceType: SourceType               // how subscription was added
  aiConfidence?: number                // 0-1, AI parsing confidence
  aiRawResult?: json                   // raw AI response for debugging

  // Timestamps
  createdAt: timestamp
  updatedAt: timestamp
}
```

## PaymentCard

```typescript
{
  id: uuid
  userId: uuid
  nickname: string                     // "My Kaspi", "Work Visa"
  last4: string                        // "4242"
  brand: CardBrand
  color?: string                       // hex color for UI
  isDefault: boolean
  createdAt: timestamp
}
```

**Security:** Only safe metadata is stored. No full PAN, CVC, or sensitive expiry data.

## User

```typescript
{
  id: uuid
  email: string
  name?: string
  avatarUrl?: string
  googleId?: string
  appleId?: string

  // Preferences
  defaultCurrency: string              // USD
  country?: string
  timezone?: string
  locale?: string                      // en, ru, es, etc.
  dateFormat?: string

  // Onboarding
  onboardingCompleted: boolean
  usageType?: 'PERSONAL' | 'TEAM'

  // Notifications
  pushToken?: string
  notificationsEnabled: boolean

  createdAt: timestamp
  updatedAt: timestamp
}
```

## Workspace (Team)

```typescript
{
  id: uuid
  ownerId: uuid
  name: string
  createdAt: timestamp
}
```

## WorkspaceMember

```typescript
{
  id: uuid
  workspaceId: uuid
  userId: uuid
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  invitedAt: timestamp
  joinedAt?: timestamp
}
```

## Receipt

```typescript
{
  id: uuid
  subscriptionId: uuid
  userId: uuid
  fileUrl: string                      // DO Spaces URL
  uploadedAt: timestamp
  aiExtracted?: json                   // AI-extracted data from receipt
}
```

## Report

```typescript
{
  id: uuid
  userId: uuid
  type: 'SUMMARY' | 'DETAILED' | 'AUDIT' | 'TAX'
  period: string                       // "2026-02", "2026-Q1"
  status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED'
  fileUrl?: string                     // PDF URL when ready
  createdAt: timestamp
}
```

## Subscription Status Lifecycle

```
TRIAL ──(trial expires)──> ACTIVE
TRIAL ──(user cancels)───> CANCELLED
ACTIVE ─(user pauses)────> PAUSED
ACTIVE ─(user cancels)───> CANCELLED
PAUSED ─(user resumes)───> ACTIVE
CANCELLED ─(user archives)─> ARCHIVED
```

Rules:
1. **TRIAL** has `trialEndDate` — system tracks countdown
2. **ACTIVE** has `nextBillingDate` — included in forecasts
3. **PAUSED** — no billing reminders sent
4. **CANCELLED** — excluded from forecast by default
5. **ARCHIVED** — hidden from main list, kept in history
