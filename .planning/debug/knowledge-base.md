# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## project-health-check — Multiple health issues: missing refresh_tokens migration, VALID_TABLE_NAMES drift, CSRF_SECRET missing, vite proxy mismatch, article_type URL param bypass
- **Date:** 2026-04-12
- **Error patterns:** refresh_tokens, VALID_TABLE_NAMES, CSRF_SECRET, article_type, troubleshooting, CHECK constraint, proxy, filter_views, cleanup-refresh-tokens
- **Root cause:** Six issues fixed via stash merge (refresh_tokens table never in schema/migrations, VALID_TABLE_NAMES missing ticket_kb_links and containing dead filter_views, CSRF_SECRET absent from compose files, vite proxy hostname mismatch, cleanup-refresh-tokens querying non-existent last_used_at column). One additional: KBArticleForm article_type state initialized directly from URL param with no validation — a crafted ?article_type=troubleshooting URL would bypass the Select widget and hit the DB CHECK constraint.
- **Fix:** Added VALID_ARTICLE_TYPES whitelist to KBArticleForm.tsx; articleType state now validates URL param before using it. Deleted orphaned new-global-search prompt artifact from project root.
- **Files changed:** src/pages/KBArticleForm.tsx, new-global-search (deleted), server/src/db/migrations.ts, server/src/db/connection.ts, server/src/db/schema.sql, server/src/db/cleanup-refresh-tokens.ts, docker-compose.yml, docker-compose.local.yml, vite.config.ts
---
