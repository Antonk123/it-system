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

## Milestone: v1.1 — Quality & Automation

**Shipped:** 2026-03-29
**Phases:** 3 | **Plans:** 7 | **Sessions:** ~3 days

### What Was Built

- Unified filter bar (UnifiedFilterBar) shared across tickets and archive with saved filter views and active filter chips
- Archive parity — bulk operations (reopen, priority, CSV export, permanent delete), full filter support
- Recurring ticket templates with CRUD API, node-cron scheduler, and full management UI at /recurring
- Dashboard queue cards with live ticket counts from saved filter views, localStorage-backed config
- Reports cleanup — removed Activity Heatmap, Radial Progress Rings, and module customization system
- Tag analytics bug fix — tags now built from ticket data, not tags table (handles deleted tags)

### What Worked

- **Parallel execution via worktrees**: Wave 1 of Phase 5 ran 05-01 and 05-03 in parallel worktrees — both completed successfully with only merge conflicts in planning docs (expected and trivially resolved)
- **Verifier catching real bugs**: Phase 5 verifier caught `api.get()` (nonexistent method) → `api.request()` fix. Phase 6 verifier caught `tags.length > 0` gate blocking analytics when tags table empty. Both were 1-line fixes that would have been runtime crashes.
- **Small cleanup phase**: Phase 6 (Reports Cleanup) was 2 plans, 1 wave, pure deletion/fix — fast execution, minimal risk
- **Integration checker thoroughness**: Milestone audit's integration checker verified all 16 requirement wiring paths end-to-end, including API routes, imports, and component rendering

### What Was Inefficient

- **Phase 04 missing VERIFICATION.md**: Phase 4 was executed before the GSD verification workflow was fully wired for this project. 5 FILT requirements are code-complete per integration checker but lack formal verification evidence.
- **SUMMARY frontmatter gaps persist**: Plans 05-01, 05-02, 06-01, 06-02 have empty `requirements_completed` fields. Same issue as v1.0 — executors don't consistently fill frontmatter.
- **REQUIREMENTS.md traceability drift**: RPT-01/03/04 showed "Pending" in traceability table even after verification passed 4/4. Required manual fix during audit. The `phase complete` CLI didn't sync these.
- **ROADMAP.md progress table stale**: Showed Phase 4 as "1/2 In Progress" and Phase 5 as "Not started" when both were complete. Parallel worktree agents updated their own copies, but merges didn't reconcile the progress table.

### Patterns Established

- **Worktree-based parallel execution**: Wave plans that don't share files can safely run in parallel worktrees. Merge conflicts are limited to planning docs and trivially resolvable.
- **`countOnly` API pattern**: Short-circuit ticket fetch with `?countOnly=true` for live counts — full WHERE clause runs but skips row serialization
- **localStorage for personal config**: Dashboard queues don't need backend storage for a single-user system
- **Ticket-first tag aggregation**: Build tag lists from `ticket.tags` first, then enrich with canonical metadata. Never filter tag table → ticket intersection.

### Key Lessons

1. **Verifiers catch real runtime bugs that TypeScript misses** — permissive tsconfig (`noImplicitAny: false`) means undefined method calls compile clean. The verifier's code inspection caught 2 bugs that would only surface in the browser.
2. **SUMMARY frontmatter must be enforced** — executor agents consistently skip `requirements_completed`. This causes audit cross-reference gaps. The executor workflow should validate frontmatter before creating SUMMARY.md.
3. **Traceability table needs post-execution sync** — the `phase complete` CLI marks phases done in ROADMAP but doesn't update REQUIREMENTS.md traceability rows from "Pending" to "Complete". Manual fix required.
4. **Run verification on all phases** — Phase 04's missing VERIFICATION.md was only caught at milestone audit. Every phase should have verification, even if scope seems trivial.

### Cost Observations

- Model mix: Opus orchestrator, Sonnet executors/verifiers/checker
- Sessions: ~3 days (2026-03-26 → 2026-03-29)
- Notable: 7 plans across 3 phases with parallel execution. Integration checker saved significant manual review time.

---

## Milestone: v1.2 — Knowledge Base Expansion

**Shipped:** 2026-03-29
**Phases:** 3 | **Plans:** 6 | **Sessions:** Same day as v1.1 completion

### What Was Built

- KB article tags (freeform, separate from ticket tags), draft/published status, view counter, tag-based filtering
- Staleness detection with `last_reviewed_at`, stale filter, amber badge, review button
- Table of contents with IntersectionObserver scroll-spy and anchor links
- Article templates (Solution, How-to, Troubleshooting) with Swedish-language picker
- "Se även" bidirectional cross-references with link picker and REST API
- Popular articles section on KB home, `/` keyboard shortcut for search focus
- Ticket-to-KB article creation with query param pre-fill

### What Worked

- **Incremental schema strategy**: Phase 7 laid all schema foundations (tags, status, view_count) that Phase 8-9 built on. No migration conflicts across phases.
- **Directional links with bidirectional reads**: `kb_article_links` stores one direction but UNION queries make it bidirectional. Simple storage, full UX.
- **Post-render DOM mutation for ToC**: DOMPurify strips custom IDs, so setAttribute after render works cleanly with scroll-spy.
- **Query param pre-fill pattern**: Ticket-to-KB creation passes title and type via URL params, template picker auto-dismisses when params present.

### What Was Inefficient

- **SUMMARY frontmatter extraction still broken**: Plans 08-01, 08-02, 09-01, 09-02 had `One-liner:` prefix in frontmatter that the CLI couldn't parse. Same issue as v1.0 and v1.1.
- **Conversation cleared before phase-9 verification**: User accidentally cleared conversation before confirming phase-9 changes were working.

### Patterns Established

- **Freeform tag join table**: `kb_article_tags` with text column, no canonical tag table — simpler for single-user
- **Bidirectional link pattern**: Store directional, read with UNION, delete with OR
- **Template picker UX**: Show on new article, auto-dismiss when query params present, skip on edit
- **IntersectionObserver scroll-spy**: For ToC active heading tracking on long articles

### Key Lessons

1. **SUMMARY frontmatter extraction is a recurring pain point** — three milestones in a row with broken one-liner extraction. The format or the extractor needs fixing.
2. **Phase dependencies within a milestone work well** — 7→8→9 dependency chain was clean because schema was laid in Phase 7.
3. **Don't clear conversation before verification** — always confirm changes before clearing context.

### Cost Observations

- Model mix: Opus orchestrator, Sonnet executors
- Sessions: Same day as v1.1, rapid execution
- Notable: 6 plans across 3 phases with clean dependency chain. 17/17 requirements delivered.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 1 day | 3 | Initial GSD workflow adoption |
| v1.1 | 3 days | 3 | Parallel worktree execution, verifier-caught runtime bugs |
| v1.2 | 1 day | 3 | Incremental schema dependencies, bidirectional link pattern |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|--------------------|
| v1.0 | 0 | 0% | 0 (window.print() over @react-pdf/renderer) |
| v1.1 | 0 | 0% | 1 (node-cron for scheduler, localStorage for queues) |
| v1.2 | 0 | 0% | 0 (all features built on existing stack) |

### Top Lessons (Verified Across Milestones)

1. Wire all schema migrations into `initializeDatabase()` — standalone scripts silently skip on fresh deploys
2. Batch human-verification items after each Docker rebuild, not per-plan
3. Verifiers catch runtime bugs that TypeScript misses with permissive tsconfig — always run verification
4. SUMMARY frontmatter `requirements_completed` must be enforced — causes audit gaps in every milestone
5. SUMMARY one-liner extraction broken across all 3 milestones — needs format or tooling fix
