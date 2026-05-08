# Data Retention & Deletion Policy

Owner: Security
Reviewed: 2026-05-08
Cadence: revisit at every schema-changing migration; minimum annually.

This document satisfies ASVS V8.3.4 and is part of the CASA Tier 2
Self-Assessment evidence pack. Each table is annotated with its
retention window, deletion mechanism, and encryption posture so a
reviewer (or our own future self) can verify the property end-to-end.

## Per-Table Inventory

### Identity / Auth

| Table | Sensitivity | Retention | Delete trigger | Encryption at rest |
|---|---|---|---|---|
| `users` | High | Until account deletion or 12 months inactive | `DELETE /users/me`, soft-delete cron (TODO) | password: bcrypt; refreshToken: bcrypt; magicLinkToken: sha256; **providerId: AES-GCM**; **lemonSqueezyCustomerId: AES-GCM**; rest: DB-level encryption (DO managed) |
| `audit_logs` | High integrity | **3 years** (regulatory hold for billing-adjacent events; security forensics) | Never deleted via `DELETE /users/me` — retained per legal-hold policy. After 3 years, archived to cold storage and pruned. | DB-level only |
| `webhook_events` | Medium | **6 months** | Pruned by `webhook-events-prune` cron | DB-level only |
| `refresh_tokens` (legacy table) | Critical | Lifetime of session | NULL'd on logout / password change | bcrypt cost 12 |

### Subscription Data

| Table | Sensitivity | Retention | Delete trigger |
|---|---|---|---|
| `subscriptions` | Medium-high | Until account deletion | CASCADE on user delete |
| `payment_cards` | Medium (last4 only — PCI exempt) | Until account deletion | CASCADE on user delete |
| `receipts` | Medium | Until account deletion | CASCADE on user delete |
| `reports` | Medium | Until account deletion | CASCADE on user delete |
| `subscription_events` | Medium | Until account deletion | CASCADE |
| `analysis_jobs` / `analysis_results` / `analysis_usage` | Medium | Until account deletion | Manual cleanup in `UsersService.deleteAccount` |
| `invite_codes` | Low | 7 days from creation, or first use | TTL on `expiresAt`; cleaned up in workspace deletion |
| `workspace_members` | Medium | Until workspace deletion | CASCADE on workspace delete |

### Billing

| Table | Sensitivity | Retention | Delete trigger |
|---|---|---|---|
| `user_billing` | High | Until account deletion | CASCADE on user delete |
| `outbox_events` | Medium | **30 days** (after dispatch) | Pruned by outbox cron |
| `billing_dead_letter` | High | **1 year** for forensics | Manual ops review + archive |

### Object Storage (DO Spaces)

| Bucket / prefix | Sensitivity | Retention | Delete trigger | Encryption |
|---|---|---|---|---|
| `receipts/{userId}/...` | Medium | Until account deletion | Manual delete by `UsersService.deleteAccount` (TODO: verify cascade) | SSE-S3 (`AES256`) |
| Receipt CDN URLs | Medium | private ACL | n/a | n/a |

### Cache / Ephemeral (Redis)

| Key prefix | Sensitivity | Retention | Notes |
|---|---|---|---|
| `otp:{email}` | Critical | 15 min TTL, single-use | sha256(code) only — never plaintext |
| `auth:lockout:*` | Low | 1h TTL | counter only, no PII |
| `idempotency:{key}` | Low | 10 min default | per-spec |

## User-Triggered Deletion (`DELETE /users/me`)

Cascades:

```text
users
  └─ subscriptions             FK CASCADE
  └─ payment_cards             FK CASCADE
  └─ receipts                  FK CASCADE
  └─ reports                   FK CASCADE
  └─ refresh_tokens (legacy)   FK CASCADE
  └─ user_billing              FK CASCADE
  └─ user_trial                FK CASCADE
manual deletes (UsersService.deleteAccount):
  - analysis_jobs / analysis_results / analysis_usage
  - workspace_members (and any owned workspace)
  - invite_codes issued by this user
  - push_tokens
  - DO Spaces receipt blobs (TODO: verify)
preserved (intentional):
  - audit_logs row + new `account.delete` event with masked email
```

The deletion is irreversible after a 0-second grace window — there is
currently no soft-delete / restoration UI. CASA accepts this; GDPR Art
17 (right to erasure) is satisfied by the immediate cascade.

## Data Export (`GET /users/me/export`)

GDPR Article 20 portability. Returns a single JSON document with:

- Profile (sans password / refreshToken / magicLinkToken / fcmToken)
- Billing
- Subscriptions
- Payment cards (`last4` + brand only)
- Receipts (URLs + filenames)
- Reports

Excludes audit_logs (Article 20 scopes user-provided data, not the
integrity record of admin/system access).

Throttled to 3/min per IP.

## Audit-Log Hold

`audit_logs` are append-only and intentionally NOT cascade-deleted on
account deletion. Reasons:

1. Billing forensics — chargebacks / disputes can land 6+ months after
   a user deletes their account.
2. Security forensics — if an account was compromised pre-deletion, we
   need the trail to investigate.
3. Regulatory — financial and security audit records typically have a
   3-year statutory retention.

The masked `emailMasked` field in metadata means deleting the user row
removes the last clear PII pointer; what remains is anonymised event
data.

## Open Items

| Priority | Item | Tracker |
|---|---|---|
| HIGH | DO Spaces receipt blob cascade-delete on `DELETE /users/me` | Verify in code, add if missing |
| MED | Inactivity sweep (12-month dormant accounts) | Cron TODO |
| MED | `audit_logs` 3-year archive + cold-storage pruner | Cron TODO |
| LOW | Soft-delete with 30-day undo window for `DELETE /users/me` | Future |
