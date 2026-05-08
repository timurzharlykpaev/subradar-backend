# Security Policy

SubRadar takes security issues seriously. This document is the canonical
entry point for reporting vulnerabilities, the support windows we honour,
and the scope of our public bug-bounty stance.

## Reporting a Vulnerability

**Email**: `security@subradar.ai`

For sensitive reports, please encrypt with our PGP key (fetch from
[https://subradar.ai/.well-known/security.pgp](https://subradar.ai/.well-known/security.pgp)
once published; otherwise plain TLS email is acceptable for first contact
and we can establish a secure channel from there).

When reporting please include:

- A clear description of the issue
- Reproduction steps (PoC code/curl welcome)
- Affected component(s) and version(s)
- Expected vs actual behaviour
- Your assessment of impact (confidentiality / integrity / availability)
- How you'd like to be credited (or whether to remain anonymous)

We commit to:

- Acknowledging receipt within **3 business days**
- Triage decision within **7 business days**
- Status updates at least **every 14 days** until resolution
- Coordinated disclosure once a fix is shipped — typically **within 90
  days** of the initial report; longer windows possible for systemic
  issues, with explicit agreement

## In-Scope Targets

- `*.subradar.ai` (production web + API)
- iOS app (App Store: SubRadar AI)
- Android app (Google Play: SubRadar AI)
- Backend: <https://github.com/timurzharlykpaev/subradar-backend>

## Out of Scope

- Anything we don't operate (e.g. vendor surfaces — Lemon Squeezy,
  RevenueCat, Resend, Firebase, OpenAI). Report directly to the vendor.
- Volumetric DDoS / brute-force without a novel amplification angle
- Self-XSS / clickjacking on pages without sensitive actions
- Outdated browser issues without an exploitable consequence
- Findings from automated scanners without a working PoC
- Social engineering, physical access, mailbox compromise
- Issues only reproducible against compromised endpoints

## Safe Harbour

We will not pursue legal action against researchers who:

- Make a good-faith effort to follow this policy
- Avoid privacy violations, data destruction, and service disruption
- Do not disclose details publicly until we've coordinated a fix
- Test only against accounts they own or have explicit permission to use

## Bounty

We do not currently run a paid bounty programme. Notable, well-documented
reports are recognised on the SubRadar security page (`subradar.ai/security`)
and via product credit on request.

## Security Practices

For an overview of how we protect user data, see
[`docs/SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md). For our
threat model see [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).
