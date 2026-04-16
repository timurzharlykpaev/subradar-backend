# Feature Flags

## Current approach — environment variables

SubRadar currently uses plain env-var boolean flags, read once at bootstrap and cached on the `ConfigService`. This keeps the surface simple and works for coarse-grained rollouts (whole-service toggles per environment).

### How it works

1. Flag declared in `.env.example` with default value and short description.
2. Loaded via `ConfigService.get('FLAG_NAME')` at module init.
3. Checked at the boundary — usually in a guard, service constructor, or controller — and short-circuits or falls back.

Toggling a flag requires a redeploy (or `docker compose up -d --force-recreate`). We accept this because the flags change rarely.

### Current flags

| Flag | Default | Purpose |
|------|---------|---------|
| `ENABLE_REVIEW_ACCOUNT` | `false` | Allow the `review@subradar.ai` demo login with fixed OTP (App Store / Play reviewers). Must be `true` in prod only. |
| `ENABLE_VOICE_AI` | `true` | Gate the `/ai/voice-to-subscription` endpoint. Turn off if OpenAI Whisper costs spike. |
| `ENABLE_SCREENSHOT_AI` | `true` | Gate `/ai/parse-screenshot`. |
| `ENABLE_TEAM_PLAN` | `true` | Expose Team pricing & workspace endpoints. |
| `ENABLE_WEEKLY_DIGEST` | `true` | Controls the Monday weekly-digest BullMQ cron. |
| `ENABLE_LEMON_SQUEEZY` | `true` | Accept LS webhooks / show LS checkout. |
| `ENABLE_REVENUECAT_SYNC` | `true` | Nightly reconcile with RevenueCat. |
| `MAINTENANCE_MODE` | `false` | Returns 503 with retry-after on all non-health endpoints. |

New flags: add to `.env.example`, document here, and reference the gating location (file + line) in the same PR.

### Naming convention

- `ENABLE_*` — feature toggles (on/off)
- `MAX_*` / `LIMIT_*` — tunable numeric limits
- Avoid negations (`DISABLE_*`) — always `ENABLE_*` with sensible default.

### Testing flags

Flags default to `true` in tests unless the test explicitly overrides the `ConfigService` mock. Tests that assert disabled-state behaviour must set the flag to `false` via `Test.createTestingModule({ providers: [...] })` override.

## Limitations of the current approach

- No per-user rollouts — we can't enable AI voice for 10 % of users.
- No instant kill switch — requires redeploy.
- No targeting by plan / country / cohort without code changes.
- No audit trail of who changed what.

These limitations are acceptable today because we have < 5 k users and our feature gates are coarse.

## Roadmap — when to adopt a flag service

Move to a dedicated flag platform (LaunchDarkly, Unleash, PostHog Feature Flags) when any of the following is true:

1. We need **per-user / cohort rollouts** for experiments (A/B tests on paywall, onboarding, AI thresholds).
2. We need a **kill switch** that takes effect in < 60 s without redeploy (e.g., disable a broken paid feature during an incident).
3. We need **non-engineers** (product, growth) to toggle flags safely.
4. We have **> 20** env-var flags and their combinations become untestable.

### Preferred provider: LaunchDarkly

- Mature SDKs for NestJS (`@launchdarkly/node-server-sdk`) and React Native (`@launchdarkly/react-native-client-sdk`).
- Server-side evaluation + streaming updates.
- Native targeting rules (plan, country, user id).
- Free tier up to 1 000 MAU.

Alternative if cost-sensitive: **Unleash** (self-hostable, OSS) on our existing droplet.

### Migration plan (when we pull the trigger)

1. Sign up for LaunchDarkly, create `prod` and `dev` environments.
2. Add `@launchdarkly/node-server-sdk` to backend, initialise in `AppModule`.
3. Create a thin wrapper `FeatureFlagService` with two methods: `isEnabled(key, user?)` and `variation(key, user, default)`.
4. Migrate flags one at a time:
   - Create the flag in LaunchDarkly mirroring the current env-var default.
   - Replace `ConfigService.get('FLAG')` with `featureFlags.isEnabled('flag-name', user)`.
   - Keep the env var as a safety fallback for 2 weeks, then remove.
5. Mobile: add the React Native SDK, evaluate flags in `app/_layout.tsx` and stash in a Zustand store.
6. Document any flag used in the mobile client **here** and in the mobile README.

### What NOT to do

- Don't roll our own flag service — not worth the maintenance.
- Don't use flags as permanent config. If a flag hasn't changed in 6 months, remove it and bake the behaviour into the code.
