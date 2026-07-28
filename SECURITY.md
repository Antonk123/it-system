# Security Policy

IT-Ticket handles authentication, customer data, billing, and email
integration. We take security reports seriously and appreciate responsible
disclosure.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, use GitHub's private channel:

1. Go to the repo's **Security** tab → **Report a vulnerability**
   ([private security advisories](https://github.com/Antonk123/it-system/security/advisories/new)).
2. Describe the vulnerability, its impact, and reproduction steps.

If you can't use the GitHub flow, contact the maintainer via the
[@Antonk123](https://github.com/Antonk123) profile.

### What to expect

| Step | Target |
|------|--------|
| Acknowledgement of receipt | within 3 business days |
| Initial assessment (severity, scope) | within 7 business days |
| Fix / remediation | depends on severity; CRITICAL/HIGH are prioritized |

We're happy to credit reporters in the release notes if desired.

## Scope

**In scope:** authentication/sessions (JWT, refresh tokens), CSRF, API key
handling, webhook signing, authorization checks (IDOR), SQL injection, XSS,
SSRF, exposure of secrets or customer data, and the public deflection portal
and email-to-ticket flow.

**Out of scope:** vulnerabilities requiring physical access to the server,
social engineering, or issues in third-party dependencies without a
demonstrable, exploitable path through IT-Ticket (report those upstream; we
track them via Dependabot + a CI audit gate).

## Security model (summary)

- **Auth:** JWT access tokens (15 min) + rotating refresh tokens.
- **API keys:** SHA-256 hashed with prefix lookup — the raw key is never
  stored.
- **Webhooks:** HMAC-signed events.
- **CSRF:** double-submit via `csrf-csrf`, `X-CSRF-Token` header on mutating
  requests.
- **Secrets:** the backend refuses to start (`process.exit(1)`) if
  `JWT_SECRET` or `CSRF_SECRET` is missing or shorter than 32 characters
  (fail-closed; the weak-secret opt-in only works in dev/test behind a
  double gate).
- **SQL:** parameterized queries; dynamic column names are allow-listed.
- **Dependencies:** a CI gate (`scripts/audit-check.mjs`) blocks the build on
  high/critical `npm audit` advisories, with a narrow, justified allowlist
  for advisories confirmed unreachable in this app; Dependabot runs weekly.

## Supported versions

IT-Ticket is deployed as **one instance per deployment** (no multi-tenancy)
and shipped on a rolling basis from `main`. Security fixes land on `main` —
run the latest `main` to stay protected. There is no separate LTS branch.
