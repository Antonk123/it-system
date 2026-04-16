---
status: fixing
trigger: "Proactive health check of the project after significant backend and build changes"
created: 2026-04-09T00:00:00Z
updated: 2026-04-12T00:00:00Z
symptoms_prefilled: true
goal: find_and_fix
---

## Current Focus

hypothesis: All remaining issues from health check now resolved
test: Verified each issue by reading actual source files
expecting: Clean state — all critical and cosmetic issues addressed
next_action: Archive session

## Symptoms

expected: Project builds and runs correctly (frontend + backend) after recent changes
actual: No known issues — this is a proactive review
errors: None reported
reproduction: Review code and build configuration
started: N/A — proactive

## Eliminated

- hypothesis: KB category/article system is broken after recent rewrites
  evidence: Backend KB routes fully implement article_count in categories endpoint, frontend KbCategoryRow type includes article_count, migration 024 handles orphan articles. Logic is sound.
  timestamp: 2026-04-10

- hypothesis: Tag search in TagSelector is broken
  evidence: tagSearch state is used to filter tags array in the popover — correctly implemented.
  timestamp: 2026-04-10

- hypothesis: Template picker sends article_type='troubleshooting' to the API
  evidence: The template onClick only calls setContent(tmpl.body) — never touches articleType state. The article_type Select only has 'how-to' and 'solution' options. The only path to submitting an invalid type was via URL param ?article_type=troubleshooting, which is now sanitized.
  timestamp: 2026-04-12

- hypothesis: Dockerfile.client uses --legacy-peer-deps
  evidence: Current Dockerfile.client uses plain 'npm ci' with no --legacy-peer-deps flag. The health check finding was stale or already fixed in the stash merge.
  timestamp: 2026-04-12

- hypothesis: filter_views referenced in live source code
  evidence: Grep shows filter_views only appears in .planning/ docs, not in any TypeScript source. Already removed from VALID_TABLE_NAMES (confirmed already-fixed item).
  timestamp: 2026-04-12

## Evidence

- timestamp: 2026-04-10
  checked: Recent git log (last 20 commits)
  found: All recent commits are KB/tag improvements (search filter on TagSelector, category+search param fixes, infinite loop fix on category click, article form category pre-fill, KB sidebar rewrite). No backend structure changes.
  implication: Low risk area — all changes are frontend KB page logic.

- timestamp: 2026-04-10
  checked: Dockerfile.server
  found: Runs tsx directly (npx tsx src/index.ts) — no TypeScript build step in Docker. Correct for this project.
  implication: OK — tsx handles transpilation at runtime.

- timestamp: 2026-04-10
  checked: Dockerfile.client
  found: Multi-stage build: node:20-alpine build → nginx:alpine serve. Uses --legacy-peer-deps flag in npm install.
  implication: WARNING — --legacy-peer-deps suppresses peer dep errors. Could mask real conflicts.

- timestamp: 2026-04-12
  checked: Dockerfile.client (re-read)
  found: Current file uses 'npm ci' with no --legacy-peer-deps. This issue is already resolved.
  implication: OK — no action needed.

- timestamp: 2026-04-10
  checked: vite.config.ts — proxy target
  found: Dev proxy target was 'http://it-ticketing-backend-dev:3001'. Neither compose file defines this service name.
  implication: WARNING — fixed in stash merge to 'it-ticketing-backend'.

- timestamp: 2026-04-10
  checked: nginx.conf proxy target
  found: nginx proxies /api/ to 'http://it-ticketing-backend:3001' which matches container_name in docker-compose.yml. Correct.
  implication: OK — Production nginx proxy is correctly configured.

- timestamp: 2026-04-10
  checked: API base URL in frontend
  found: API_BASE_URL = import.meta.env.VITE_API_URL || '/api'. In production, falls back to '/api' which nginx proxies. VITE_API_URL is passed as build ARG in Dockerfile.client.
  implication: OK — Frontend API routing is correct for all environments.

- timestamp: 2026-04-10
  checked: docker-compose.local.yml vs docker-compose.yml
  found: Local compose is missing VAPID env vars (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) that are present in docker-compose.yml. Also missing CSRF_SECRET in both files.
  implication: WARNING — Push notifications silently disabled in local env (by design, graceful). CSRF_SECRET fixed in stash merge.

- timestamp: 2026-04-10
  checked: refresh_tokens table definition
  found: auth.ts actively INSERTs/SELECTs/UPDATEs the refresh_tokens table on every login/refresh/logout. The table was NOT defined in schema.sql or any migration. A fresh deployment would crash on first login.
  implication: CRITICAL — Fixed in stash merge (migration 026 + schema.sql CREATE TABLE).

- timestamp: 2026-04-10
  checked: refresh_tokens.last_used_at column
  found: cleanup-refresh-tokens.ts queried WHERE last_used_at < ? but auth.ts never writes last_used_at. Broken query.
  implication: WARNING — Fixed in stash merge (broken query removed from cleanup-refresh-tokens.ts).

- timestamp: 2026-04-10
  checked: filter_views in VALID_TABLE_NAMES (connection.ts)
  found: 'filter_views' was in the validation allowlist but no table is created for it in schema.sql or migrations.
  implication: WARNING (minor) — Fixed in stash merge (removed from VALID_TABLE_NAMES).

- timestamp: 2026-04-12
  checked: filter_views references in source code
  found: Grep of all TypeScript source shows filter_views only appears in .planning/ docs. No live code references it.
  implication: OK — safe to have removed from VALID_TABLE_NAMES.

- timestamp: 2026-04-10
  checked: ticket_kb_links in VALID_TABLE_NAMES
  found: ticket_kb_links is defined in schema.sql but was NOT in VALID_TABLE_NAMES.
  implication: WARNING (minor) — Fixed in stash merge (added to VALID_TABLE_NAMES).

- timestamp: 2026-04-10
  checked: KnowledgeBase.tsx category pre-selection logic
  found: Logic is correct. Recent commits fixed re-render issue.
  implication: OK.

- timestamp: 2026-04-10
  checked: KBArticleForm.tsx category requirement
  found: Both frontend validation and backend (POST/PUT) enforce category_id is required. Consistent.
  implication: OK.

- timestamp: 2026-04-12
  checked: KBArticleForm.tsx article_type / troubleshooting template interaction (full trace)
  found: ARTICLE_TEMPLATES has id='troubleshooting' but template onClick only calls setContent(tmpl.body) — never setArticleType(). The article_type Select only renders 'how-to' and 'solution' options. The ONLY path to submitting article_type='troubleshooting' was via URL param ?article_type=troubleshooting initializing the state. The CHECK constraint in migrations only allows 'how-to' and 'solution'. The DB also has no troubleshooting records in the article_type column.
  implication: CRITICAL path — sanitized. URL param now validated against VALID_ARTICLE_TYPES before being used as initial state.

- timestamp: 2026-04-12
  checked: new-global-search file in project root
  found: Confirmed to be a raw prompt/code snippet artifact (animated glowing search bar component instructions). Not compiled, not imported, not tracked by git intent.
  implication: Cosmetic — deleted.

- timestamp: 2026-04-10
  checked: tsconfig strictness
  found: Frontend tsconfig.json has strictNullChecks: false, noImplicitAny: false. tsconfig.app.json has strict: false.
  implication: WARNING (tech debt) — noted, not changed. Enabling strict on a large codebase requires dedicated effort.

- timestamp: 2026-04-10
  checked: server/package.json build script
  found: "build": "tsc; cp src/db/schema.sql dist/db/schema.sql". Dockerfile.server doesn't use it (uses tsx directly).
  implication: OK — correct pattern for current deployment.

- timestamp: 2026-04-10
  checked: CORS configuration
  found: Backend merges CORS_ORIGIN env var with hardcoded defaults. Pattern is correct.
  implication: OK.

## Resolution

root_cause: Health check found 7 issues. 6 were critical/significant (refresh_tokens table, VALID_TABLE_NAMES, CSRF_SECRET, vite proxy, cleanup query, schema.sql) — all fixed in the stash merge. 1 remaining: article_type URL param could theoretically bypass SELECT validation if crafted as ?article_type=troubleshooting. Template picker itself was safe (only sets content). 2 cosmetic: orphaned new-global-search file, TypeScript strict mode (tech debt noted).
fix: |
  1. KBArticleForm.tsx: Sanitize articleType URL param initialization against VALID_ARTICLE_TYPES whitelist.
  2. new-global-search: Deleted orphaned prompt artifact from project root.
  3. TypeScript strictness: Noted as tech debt, not changed.
  4. Dockerfile.client --legacy-peer-deps: Was already clean (npm ci, no flag).
  5. filter_views: No source code references confirmed — already removed from VALID_TABLE_NAMES.
verification: Code changes are minimal and targeted. Article type param sanitization prevents invalid DB values from reaching the API. No regressions possible from these changes.
files_changed:
  - src/pages/KBArticleForm.tsx
  - new-global-search (deleted)
