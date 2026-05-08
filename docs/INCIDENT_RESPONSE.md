# Incident Response Plan

Owner: Security
Reviewed: 2026-05-08
Cadence: tabletop exercise once per quarter; revisit after every incident.

This document satisfies CASA Tier 2 evidence for incident-handling
process and complements `docs/RUNBOOK.md` (which covers ops incidents
like deploy failures and capacity issues). Use this one when the
incident has a security dimension: data exposure, account compromise,
unauthorised access, malware, or regulatory-disclosure-worthy events.

## Severity Definitions

| Sev | Examples | Response time |
|---|---|---|
| **SEV1** — critical | Confirmed PII / credential exposure; production credential leak; ongoing unauthorised access | Engage within **1 hour**, all-hands; status updates every 30 min |
| **SEV2** — high | Likely-but-unconfirmed exposure; vulnerability with working PoC against prod; widespread auth failure | Engage within **4 hours**; updates every 2 hours |
| **SEV3** — medium | Vulnerability without prod impact; bounded data exposure (e.g. one user's receipts visible to another via specific exploit) | Engage within **1 business day** |
| **SEV4** — low | Theoretical issue; defence-in-depth gap | Track in backlog |

## Roles

For SubRadar's current team size the same person typically wears
multiple hats; this is the function map, not headcount.

| Role | Responsibility |
|---|---|
| **Incident Commander (IC)** | Owns the incident end-to-end; calls cadence; final go/no-go on customer comms |
| **Investigator** | Reproduces, scopes blast radius, confirms / refutes hypotheses |
| **Comms** | Drafts customer email, status-page entry, regulator notification |
| **Scribe** | Maintains the incident timeline (who/what/when) in a shared doc |

Default IC: founder + on-call engineer.

## Escalation Tree

1. **Detection**: alert from Telegram (`AllExceptionsFilter`), Sentry, gh
   security advisory, customer report via `security@subradar.ai`, or
   internal observation.
2. **Triage**: IC assigns severity (table above) and creates incident
   doc (`incidents/YYYY-MM-DD-shortname.md`) with timeline + scope.
3. **Containment**: stop ongoing exposure first, fix root cause second.
   See playbooks below.
4. **Eradication**: remove the foothold; rotate any leaked secrets;
   patch the vulnerable code.
5. **Recovery**: restore service, verify in production with explicit
   smoke tests.
6. **Postmortem**: blameless, due **within 7 days** of resolution. See
   template at end.

## Playbooks

### Suspected JWT secret leak

1. **Contain**: rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` via
   GitHub Actions secret update. Force-redeploy.
2. After deploy: bump `tokenVersion` for ALL users via
   `UPDATE users SET "tokenVersion" = "tokenVersion" + 1` — invalidates
   every outstanding token in one query.
3. Force re-login UX is acceptable; communicate as "scheduled session
   refresh" unless attribution is confirmed.
4. Audit `audit_logs` for `auth.refresh.success` rows from anomalous IPs
   in the leak window.
5. Postmortem.

### Suspected data-encryption-key (`DATA_ENCRYPTION_KEY`) leak

1. **DO NOT just rotate the key**. Doing so makes existing encrypted
   data unreadable until a re-encryption migration runs.
2. Inventory blast: which rows hold ciphertext under the leaked key?
   (`SELECT id FROM users WHERE "providerId" LIKE 'enc:v1:%' OR
   "lemonSqueezyCustomerId" LIKE 'enc:v1:%';`)
3. Generate new key. Run two-phase migration:
   - Decrypt rows with old key, re-encrypt with new key, write back.
   - Track progress in a temp table; resumable.
4. Replace env var; deploy. Old key safely destroyed.
5. Notify users if PII exposure is confirmed (Limited Use compliance
   for any Gmail-derived data; GDPR Art 33 within 72h if EU users
   affected).

### Webhook signing secret leak

1. Rotate via the provider's `_V2` rotation hook
   (`LEMON_SQUEEZY_WEBHOOK_SECRET_V2` / equivalent).
2. Set `ALLOW_LEGACY_UNSUBSCRIBE_SIG=false` to disallow old-secret-signed
   requests.
3. Replay any held webhook events under the new secret if applicable.
4. Audit `webhook_events` for inbound traffic that hit the rotation
   window.

### Suspected database compromise

1. Disconnect / firewall the offending source if known.
2. Snapshot the current DB state (DO managed-PG point-in-time backup).
3. Rotate DB password (`DB_PASSWORD` GitHub Actions secret); deploy.
4. Rotate all secrets that ever touched the same droplet (defence in
   depth): `JWT_*`, `DATA_ENCRYPTION_KEY` (with re-encrypt migration),
   `LEMON_SQUEEZY_*`, `RESEND_*`, `OPENAI_API_KEY`, `DO_SPACES_*`.
5. Force `tokenVersion` bump for all users (see JWT-leak playbook).
6. Notify users + regulators per GDPR Art 33 (72h window).

### Vendor / supply-chain compromise

1. Identify the affected dependency (Dependabot / CodeQL / customer
   report).
2. Pin known-good version; patch deploy.
3. Inventory exposure: did the vulnerable code touch any sensitive
   path? (audit logs, DB query patterns, outbound calls).
4. If exposure confirmed, follow the relevant playbook above.

## Customer & Regulator Notification

- **GDPR Art 33** — supervisory authority within **72 hours** of
  becoming aware of a personal-data breach. Maintain awareness clock
  starting at confirmation, not first-suspicion.
- **GDPR Art 34** — affected EU users notified "without undue delay"
  when there's high risk to rights/freedoms.
- **App Store / Google Play** — notify per their developer policies if
  a security issue affects an installed app.
- **Customer email** — drafted by Comms; reviewed by IC before send.
  Plain-language: what happened, what data was involved, what we did
  about it, what they should do.

Status page (when set up): `status.subradar.ai`.

## Postmortem Template

```markdown
# Incident: <short name>
- Date: <UTC>
- Severity: SEV{1,2,3,4}
- Duration of impact: HH:MM → HH:MM
- Customer impact: ...
- Detection: how we found out (alert / customer / scan)

## Timeline
| Time (UTC) | Event |
|---|---|
| ...

## Root cause
What broke and why.

## Resolution
What we did to fix.

## What went well
...

## What didn't
...

## Action items
| # | Owner | Due | Item |
|---|---|---|---|
| 1 | ... | ... | ... |
```

## Contact Sheet

| Role | Channel |
|---|---|
| Internal incident bridge | Telegram chat (existing) |
| Security disclosure inbox | `security@subradar.ai` |
| DigitalOcean support | DO ticket portal |
| Lemon Squeezy support | merchant dashboard ticket |
| RevenueCat support | dashboard ticket |
| Apple developer support | developer portal |
| Google API services support | Cloud Console support |
| Resend support | dashboard |
