# GitHub Environment Setup — prod approval gate

The `deploy.yml` workflow pins the job to the `environment` named after the
computed deploy target (`dev` or `prod`). When the target is `prod`, GitHub
Actions consults the `prod` environment's protection rules before running any
step — including the `docker build/push` and the SSH deploy.

Without the `prod` environment configured, the workflow still runs; it just
doesn't get the approval gate. **Only a repo admin can configure this.**

## One-time setup (repo admin)

1. Navigate to: **GitHub → Settings → Environments → New environment**.
2. Name: `prod`.
3. **Required reviewers**: add at least one team member who must approve every
   production deploy.
4. **Wait timer**: `5` minutes — a last-chance window to cancel an approved
   deploy before it actually runs.
5. **Deployment branches**: restrict to `main` only. This prevents accidental
   prod deploys from feature branches triggered via `workflow_dispatch`.
6. *(Optional)* Also create a `dev` environment with no reviewers / no wait
   timer so the `environment:` key in the workflow resolves cleanly for dev
   deploys (GitHub auto-creates it on first use, but explicit is better).

## How the gate works

- Push to `main` → workflow computes `target=prod` → job targets `environment:
  prod` → **GitHub blocks execution** until a reviewer clicks "Approve and
  deploy" in the Actions UI.
- Push to `dev` → `target=dev` → `environment: dev` → no reviewers → job
  proceeds immediately.
- Manual `workflow_dispatch` with `environment=prod` → same `prod` gate applies.

## Secrets scoping (optional hardening)

Move production-only secrets (e.g. `DATABASE_URL`, `REVENUECAT_WEBHOOK_SECRET`
with prod values) from repo-level secrets into **environment secrets** on the
`prod` environment. That way a workflow run targeting `dev` physically cannot
read prod credentials, even if someone tampers with the YAML.

## Verifying the gate

After configuration, trigger a run via `workflow_dispatch` with
`environment=prod`. The Actions UI should show the job as **"Waiting"** with
a "Review deployments" button. Approving resumes the job.
