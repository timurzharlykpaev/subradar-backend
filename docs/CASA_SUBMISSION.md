# CASA Tier 2 Self-Assessment — Submission Package

Owner: Security
Status: Draft (v1, ready to fill once Gmail integration ships)
Reviewed: 2026-05-08

This is the operator's runbook for submitting SubRadar to Google's
OAuth verification programme with Gmail restricted-scope access. It
collates the artefacts CASA reviewers expect, the exact commands to
generate them, and the language that should land in customer-facing
docs.

The implementation work is finished as of Batches 1A → 4. What's left
is paperwork + tooling. Allow ~1 week of focused work plus the
inevitable 4-8 weeks Google reviewer cadence.

## Step 0 — Final Pre-Submission Checklist

Block submission until every box is ticked.

- [ ] All four `Security` CI jobs are green on `main`
      (npm-audit / Semgrep / CodeQL / gitleaks).
- [ ] Production `npm audit --omit=dev --audit-level=high` is clean.
- [ ] `Security` workflow has run at least one full Mondaycron cycle
      so SARIF history exists for the reviewer.
- [ ] `scripts/encrypt-legacy-pii.ts` has been run on production and
      the output shows `migratedProviderId > 0` (or `=0` if no
      legacy plaintext exists, in which case migration is a no-op).
- [ ] `users.tokenVersion` migration (`AddUserTokenVersion`) has run
      on production.
- [ ] `users.gmail*` migration (`AddGmailIntegration`) has run.
- [ ] All four GitHub Actions secrets exist:
      `APPLE_CLIENT_ID`, `DATA_ENCRYPTION_KEY`,
      `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`.
- [ ] Privacy Policy + Terms updates from this document are PUBLISHED
      at `subradar.ai/privacy` and `subradar.ai/terms`.
- [ ] Domain ownership of `subradar.ai` is verified in Google Search
      Console under the project's owner account.
- [ ] An end-to-end Gmail connect → parse → disconnect → delete-account
      flow has been smoke-tested by a real human against production.

## Step 1 — Evidence Files

Create a folder `casa-2026-q2/` locally; everything below goes in it.

### SAST — Semgrep

```bash
docker run --rm -v "$(pwd):/src" returntocorp/semgrep \
  semgrep \
    --config p/owasp-top-ten \
    --config p/typescript \
    --config p/nodejs \
    --json --output casa-2026-q2/sast-semgrep.json \
    --sarif --output casa-2026-q2/sast-semgrep.sarif \
    src/
```

### SAST — CodeQL

CodeQL runs in CI; download the latest scan from
`Security` tab → Code scanning → CodeQL → Download SARIF and save as
`casa-2026-q2/sast-codeql.sarif`.

### DAST — OWASP ZAP

Run against a fresh local instance of the API:

```bash
# In one shell, boot the API:
NODE_ENV=production npm run start:prod
# In another:
docker run --rm -v "$(pwd)/casa-2026-q2:/zap/wrk" \
  owasp/zap2docker-stable \
  zap-baseline.py \
    -t http://host.docker.internal:3000/api/v1 \
    -r dast-zap-report.html \
    -J dast-zap.json \
    -I  # don't fail on warnings, we curate the report manually
```

### SCA — npm + Snyk (optional)

```bash
npm audit --json > casa-2026-q2/sca-npm-audit.json
# If you have a Snyk account:
npx snyk test --json > casa-2026-q2/sca-snyk.json
```

### Secrets scanning — gitleaks

```bash
gitleaks detect --source . --report-format json \
  --report-path casa-2026-q2/secrets-gitleaks.json \
  --no-banner
```

### SBOM (optional but expected for higher-tier reviewers)

```bash
docker run --rm -v "$(pwd):/src" \
  anchore/syft:latest packages dir:/src \
  -o cyclonedx-json > casa-2026-q2/sbom.cdx.json
```

## Step 2 — Letter of Assessment (LoA)

Google publishes a Tier 2 LoA template (PDF, ~50 pages). Download from
the OAuth consent screen → "Prepare for verification" page.

Fill the answers using these references, which point at the existing
codebase + this repo's docs:

| Section | Answer / evidence |
|---|---|
| App information | App name: SubRadar AI. OAuth client IDs: see Cloud Console. Scopes requested: `email`, `profile`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/userinfo.email`. |
| Authentication | "JWT HS256 with ≥256-bit secret, 7d access (target 15m post-stabilisation), 30d rotated refresh stored bcrypt-hashed, OIDC for Google/Apple with audience pinned, magic-link sha256 + 15min single-use, OTP CSPRNG + sha256 + per-email lockout." → `docs/SECURITY_ARCHITECTURE.md#authentication` |
| Cryptography | "bcrypt cost 12 for passwords, AES-256-GCM column-level for identity-linking PII (providerId, lemonSqueezyCustomerId, gmailRefreshToken), SSE-S3 for receipt blobs, TLS 1.2+ everywhere." → `docs/SECURITY_ARCHITECTURE.md#cryptography` |
| Data Storage | "DigitalOcean managed Postgres (TLS, encrypted at rest, CA pinnable), Redis on private network for ephemeral data, DO Spaces with SSE-S3 for receipts." → `docs/DATA_RETENTION.md` |
| Logging | "Structured JSON via `JsonLogger` to stdout, ingested by DigitalOcean Logs. Token / JWT / Bearer redaction in `AllExceptionsFilter`. Audit table `audit_logs` with append-only writes for every auth event." → `docs/SECURITY_ARCHITECTURE.md#logging--off-host-shipping` |
| Vulnerability Management | "Dependabot weekly + immediate security alerts; Semgrep + CodeQL + gitleaks + npm audit gate on every push; security@subradar.ai with 3-day acknowledge / 7-day triage / 90-day disclosure window." → `SECURITY.md`, `.github/workflows/security.yml` |
| Access Control | "JwtAuthGuard global; per-resource userId filtering on every read/write; admin endpoints gated behind ADMIN_EMAILS env list with audit_logs row per access." → `docs/SECURITY_ARCHITECTURE.md#access-control` |
| Incident Response | "SEV-graded escalation, four named playbooks for JWT/encryption-key/webhook-secret/DB-compromise, GDPR Art 33 within 72h, customer notification within Art 34 risk window." → `docs/INCIDENT_RESPONSE.md` |
| Data Deletion | "DELETE /users/me cascades all user-FK tables, manually deletes the few non-FK-linked tables (analysis_*, workspace_members), revokes Google Gmail grant before deletion, snapshots a masked audit_logs row, retains audit log for 3-year forensics window." → `docs/DATA_RETENTION.md#user-triggered-deletion` |
| Data Export (GDPR Art 20) | "GET /users/me/export returns single JSON with profile / billing / subscriptions / payment_cards / receipts / reports." → `users.controller.ts → exportMe` |
| Threat Model | → `docs/THREAT_MODEL.md` |

## Step 3 — Demo Video (≤10 min, YouTube unlisted)

Required by Google. Cover every Gmail-touching code path the LoA
mentions. Suggested storyboard:

| Time | Show |
|---|---|
| 0:00–1:00 | App overview. Why Gmail integration exists ("automatic subscription detection from Gmail receipts"). |
| 1:00–2:30 | OAuth grant flow. Show consent screen with `gmail.readonly` listed. User approves. App returns to settings showing "Connected as user@gmail.com". |
| 2:30–5:00 | Feature in action. Show one detected subscription appearing in the dashboard with "Found via Gmail" attribution. Open the source receipt to demonstrate parsing accuracy. |
| 5:00–6:30 | Settings → "Disconnect Gmail". Show network tab: `POST /gmail/disconnect`, then `POST oauth2.googleapis.com/revoke`. Refresh settings page; "Connect Gmail" button is back. |
| 6:30–8:00 | Settings → "Delete account". Confirmation. Show user data is gone (try logging back in → no account). |
| 8:00–10:00 | Privacy policy walkthrough — highlight the "Limited Use" verbatim clause and the third-party list (OpenAI for parsing, Resend for email). |

## Step 4 — Privacy Policy Update

Add the following clause verbatim to `subradar.ai/privacy` BEFORE
submission. Google reviewers reject submissions missing this exact
language.

```markdown
## Use of Google User Data

SubRadar's use and transfer to any other app of information received
from Google APIs will adhere to the [Google API Services User Data
Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

### What we access

When you connect your Gmail account, SubRadar requests the
`https://www.googleapis.com/auth/gmail.readonly` scope, which lets us
read messages in your Gmail inbox. We use this access ONLY to identify
subscription receipts and surface them in your SubRadar dashboard.

We do not:
- Read messages outside the inbox / archive context.
- Use Gmail data for advertising.
- Sell, rent, or transfer Gmail data to third parties for purposes
  unrelated to providing this feature.
- Allow human staff to read individual Gmail messages, except when
  (a) you give us explicit consent (e.g. to investigate a parsing
  bug you reported), (b) we need to investigate abuse or a security
  incident, (c) we are legally compelled, or (d) the data has been
  fully anonymised.

### How we use it

Subscription identification runs on a recurring schedule: SubRadar
fetches recent message metadata + bodies, sends the relevant subset
to OpenAI for parsing, and stores the resulting structured
subscription rows (merchant, amount, frequency, next charge date) in
your SubRadar account. Original Gmail message bodies are NOT
persisted server-side; only the parsed structured data is.

### Sharing with third parties

The only third party that ever sees Gmail data is OpenAI, which
parses receipt content into structured fields. OpenAI processes the
data per the [OpenAI API Data Usage Policy](https://openai.com/policies/api-data-usage-policies)
and does not retain or train on it.

### Retention and deletion

The OAuth refresh token used to access your Gmail is encrypted at
rest in our database with AES-256-GCM. When you disconnect Gmail
(in-app Settings → Gmail → Disconnect) or delete your SubRadar
account, we revoke the grant on Google's side and erase the stored
token immediately. Your subscription rows derived from Gmail
remain in your account until you delete them or your account.

### Contact

Questions or requests about Google user data: `privacy@subradar.ai`.
Security disclosures: `security@subradar.ai`.
```

Verify after publishing: page must load over HTTPS, must be in the
public-domain crawl (not gated behind login), and the URL must match
exactly what's listed in the OAuth consent screen.

## Step 5 — Terms Update

Add a brief Gmail clause to `subradar.ai/terms`:

```markdown
## Gmail Integration

By connecting your Gmail account, you grant SubRadar permission to
read your inbox messages solely to identify subscription receipts.
You may revoke this access at any time via in-app Settings → Gmail →
Disconnect, or directly via your Google Account security settings.
Disconnection is immediate and irreversible; you can re-connect later
to rebuild your subscription view.
```

## Step 6 — Submit

[Google Cloud Console](https://console.cloud.google.com) → APIs & Services
→ OAuth consent screen → Edit App → Submit for verification.

Attach:

- Filled LoA PDF
- Every file from `casa-2026-q2/` listed in Step 1
- Demo video URL (YouTube unlisted)
- Privacy Policy URL (verified live)
- Terms URL (verified live)
- Security contact: `security@subradar.ai`

In the submission text, justify the Gmail scope ask:

> SubRadar is a subscription-tracking app. The `gmail.readonly` scope
> lets us automatically identify subscription receipts in users'
> inboxes, parse them with OpenAI into structured fields (merchant,
> amount, billing cycle), and present a unified subscription
> dashboard. Without this scope users would have to enter every
> subscription manually — the value of the product is the automation.
> We use Gmail data exclusively for this purpose, never for
> advertising, never for human review beyond explicit user-requested
> support, and never sell to third parties.

## Step 7 — Expect

| Window | What happens |
|---|---|
| +1–2 days | Auto-receipt acknowledgement |
| +1–2 weeks | First reviewer response — almost always with edit requests on the privacy policy phrasing or the demo video coverage. Iterate. |
| +2–4 weeks | After each correction round |
| +8–12 weeks total | Realistic time to first approval, given pristine batch 1–4 prep |
| Annually | Renewal review (typically lighter if no scope changes) |

## Step 8 — After Approval

- [ ] Tighten JWT iss/aud/tv strategy verifier to REQUIRED (drop the
      grace-window code paths). Do this ~30 days after Batch 1B + 2.5
      land in production so all legacy tokens have naturally expired.
- [ ] Document the renewal process owner + due date in the team
      calendar.
- [ ] Add CASA approval badge to `subradar.ai/security`.
