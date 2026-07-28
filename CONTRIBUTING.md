# Contributing to IT-Ticket

Thanks for wanting to contribute! This document describes how to set up a
development environment, what quality gates apply, and how to submit changes.

## Prerequisites

- **Node 22** (see [`.nvmrc`](.nvmrc))
- Docker + Docker Compose (for running the full stack)
- The repo has **two** `package.json` files — the root (frontend) and
  [`server/`](server/) (backend) — with separate dependencies and test suites.

## Getting started

```sh
git clone https://github.com/Antonk123/it-system.git
cd it-system

# Frontend dependencies
npm ci
# Backend dependencies
cd server && npm ci && cd ..

cp .env.example .env   # fill in at least JWT_SECRET and CSRF_SECRET (>=32 chars)
```

Run the whole stack locally:

```sh
docker compose -f docker-compose.local.yml up --build
# Frontend: http://localhost:8082 · Backend: http://localhost:3002/api
```

Or develop against hot-reload (two terminals):

```sh
npm run dev              # Vite (frontend)
cd server && npm run dev # tsx watch (backend)
```

## Quality gates

All of these must pass locally **and** in CI before a change is merged. Run
them before opening a PR:

| Where | Command | What |
|-------|---------|------|
| root | `npm run lint` | ESLint across the whole repo (frontend + backend) |
| root | `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p tsconfig.node.json` | Frontend typecheck |
| root | `npm test` | Frontend tests (vitest) |
| root | `npm run build` | Production build |
| root | `npm run openapi:lint` | Validates `docs/openapi.yaml` |
| `server/` | `cd server && npx tsc --noEmit` | Backend typecheck |
| `server/` | `cd server && npm test` | Backend tests (vitest) |

CI additionally builds Docker images for both services and runs
`node scripts/audit-check.mjs` (root and `server/`) — a stricter gate than
plain `npm audit --audit-level=high`: it fails the build on every high/critical
advisory except ones explicitly listed in `audit-allowlist.json` with a
justification and an expiry date. The backend suite also runs with
`--coverage` in CI, enforced against ratchet thresholds in
`server/vitest.config.ts` (a regression floor set just under current coverage,
not a fixed target).

> **Husky:** a pre-commit hook runs `lint-staged` automatically. **Never**
> bypass it with `git commit --no-verify`.

## Code conventions

- **API calls:** mutating calls go through `api.request()` in
  `src/lib/api.ts` (handles the CSRF token, auth header, and 401 refresh).
  Raw `fetch('/api/...')` is **blocked by ESLint**
  (`no-restricted-syntax`).
- **DB migrations:** add them to the `migrations` array in
  `server/src/db/migrations.ts` (run by `runMigrations()` at server startup).
  Standalone `tsx` scripts do **not** run at startup and are never applied in
  production. Migrations should be idempotent (guard with `columnExists`/
  `tableExists`) and `schema.sql` kept in sync where relevant.
- **SQL:** always parameterized. Dynamic column names must be allow-listed,
  never interpolated from client input.
- **Tests:** new functionality and bug fixes should come with tests. The
  project favors a test-first workflow where practical.

## Commits & PRs

- **Commit messages:** [Conventional Commits](https://www.conventionalcommits.org/)
  — e.g. `feat(tickets): ...`, `fix(billing): ...`, `test(db): ...`,
  `chore(deps): ...`, `ci: ...`, `docs: ...`. Use a trailing `!` (e.g.
  `chore(deps)!: ...`) for breaking changes.
- **Pull requests:** branch off `main`, keep the PR focused, describe *what*
  and *why*. Link the relevant issue. Make sure all gates above are green.
- A maintainer reviews and merges. Larger or security-sensitive changes may
  require extra review.

## Reporting bugs & security issues

- **Bugs / feature requests:** open a GitHub issue with reproduction steps.
- **Security vulnerabilities:** do **not** open a public issue — follow
  [`SECURITY.md`](SECURITY.md).
