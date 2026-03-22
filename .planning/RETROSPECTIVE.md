# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-22
**Phases:** 3 | **Plans:** 9 | **Sessions:** 1 (all phases completed same day)

### What Was Built

- Reports page rebuilt on server-side SQL aggregations — category breakdown, open/closed trend overlay, print-to-PDF via `window.print()`
- KB full-text search via SQLite FTS5 with highlighted snippets and HTML-stripped indexing, replacing LIKE queries
- KB article type classification (how-to / solution) with badge, filter, and form selector
- Linked Tickets reverse-lookup panel in KB article detail (`GET /api/kb/articles/:id/tickets`)
- Archive date range filter on `closed_at` with URL persistence and composite DB index

### What Worked

- **Audit-first discipline**: Running `/gsd:audit-milestone` before completion surfaced the missing `initializeDatabase()` wiring (commit `e238b08`) and confirmed 11/11 requirements satisfied — caught a real deployment correctness issue
- **Small, atomic commits per task**: Each plan's tasks committed separately made it trivial to trace which commit introduced each feature
- **Contentless FTS5 mode**: The `content=''` pattern with `db.transaction()` sync kept the FTS table small and the code clear — no surprise maintenance burden
- **Pattern reuse**: The `allowedDateFields` whitelist in the tickets route made Archive date filtering a single-line backend change

### What Was Inefficient

- **Missing `initializeDatabase()` wiring discovered post-checkpoint**: The FTS5 migration and `article_type` column were built correctly but not called at server startup. Would have silently failed on fresh container deploy. Caught only by the post-checkpoint verification step.
- **SUMMARY.md frontmatter gaps**: Plans 02-01 and 02-03 had empty `requirements_completed` arrays despite completing KB-01, KB-02, KB-05. Required manual cross-referencing in audit report.
- **9 human-verification items deferred**: Live-browser confirmations (print quality, search highlights, type badge, date filter, linked tickets with real data) were consistently deferred. These should be run as a batch after the next Docker rebuild with seeded data.

### Patterns Established

- **SQL GROUP BY endpoint pattern**: Dedicated `/api/reports/summary` returning full-dataset aggregations, never client-side on paginated raw data
- **FTS sync pattern**: POST/PUT use `db.transaction()` to write both `kb_articles` and `kb_articles_fts` atomically; DELETE uses a trigger
- **Date filter pattern**: Read from `searchParams` → spread into `useTickets()` options conditionally → labeled date inputs → clear via `updateFilters(undefined)` — reusable for any date-filtered list view
- **`allowedDateFields` whitelist**: Extensible pattern in tickets route for adding timestamp columns safely
- **Migration wiring**: Idempotent schema additions belong in `initializeDatabase()`, not as standalone scripts requiring manual execution

### Key Lessons

1. **Wire migrations into `initializeDatabase()` immediately** — standalone migration scripts that aren't called at startup will be missing on every fresh deploy. The correct default is always: idempotent `CREATE TABLE/INDEX/COLUMN IF NOT EXISTS` inside `initializeDatabase()`.
2. **Run a batch browser-verification session after each Docker rebuild** — 9 visual/live-data checks accumulated across 3 phases. One focused session with seeded data would close them all in under an hour.
3. **Audit before milestone close** — the `/gsd:audit-milestone` step caught a real gap (missing wiring) that automated tests wouldn't have caught because the project has no test suite. For a no-test-suite project, the audit is the safety net.

### Cost Observations

- Model mix: 100% Sonnet (claude-sonnet-4-6)
- Sessions: 1 day, all 3 phases
- Notable: High velocity for 9 plans — clean phased structure with tight scope kept execution focused

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 1 day | 3 | Initial GSD workflow adoption |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|--------------------|
| v1.0 | 0 | 0% | 0 (window.print() over @react-pdf/renderer) |

### Top Lessons (Verified Across Milestones)

1. Wire all schema migrations into `initializeDatabase()` — standalone scripts silently skip on fresh deploys
2. Batch human-verification items after each Docker rebuild, not per-plan
