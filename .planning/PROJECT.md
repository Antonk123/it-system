# IT Ticket System

## What This Is

An internal IT ticket system for single-user use. Tickets are submitted, tracked, and resolved through a web interface. A knowledge base stores how-to guides and ticket solutions, with full-text search, article type classification, and two-way ticket links. Reports provide focused analytics over the full ticket dataset. An archive gives period-based visibility into closed work with full filter parity. Recurring tickets auto-create on schedule, and the dashboard shows user-defined queue cards with live counts from saved filter views.

## Core Value

Every ticket gets tracked, resolved, and documented — nothing falls through the cracks and solutions are reusable.

## Requirements

### Validated

- ✓ Ticket CRUD (create, update, close) with status, priority, categories, tags — existing
- ✓ Ticket list with multi-field filtering, pagination, search — existing
- ✓ Kanban and list view modes — existing
- ✓ File attachments on tickets — existing
- ✓ Comments on tickets — existing
- ✓ Custom fields per ticket — existing
- ✓ Knowledge base articles (rich text editor, Tiptap) — existing
- ✓ Public ticket submission form (unauthenticated) — existing
- ✓ Email notifications via SMTP — existing
- ✓ Auto-close scheduler (resolved → closed after X days) — existing
- ✓ Reminder scheduler — existing
- ✓ JWT authentication with refresh tokens — existing
- ✓ Contacts/requesters management — existing
- ✓ Filter presets (save/apply complex filters) — existing
- ✓ Reports analytics on full ticket dataset via dedicated SQL GROUP BY endpoint — v1.0
- ✓ Category breakdown chart and open/closed trend overlay on Reports page — v1.0
- ✓ Print-to-PDF: `@media print` CSS with `window.print()` button — v1.0
- ✓ KB full-text search via FTS5 with highlighted `<mark>` snippets — v1.0
- ✓ FTS5 strips HTML before indexing (no false matches on markup) — v1.0
- ✓ KB article type classification (how-to / solution) with badge and filter — v1.0
- ✓ Linked Tickets reverse-lookup panel in KB article detail — v1.0
- ✓ `GET /api/kb/articles/:id/tickets` endpoint — v1.0
- ✓ Archive date range filter on `closed_at` with URL persistence — v1.0
- ✓ Composite index on `(status, closed_at)` for fast archive queries — v1.0
- ✓ Unified filter bar across Alla ärenden and Arkiv with filter views — Phase 4
- ✓ Arkiv parity: same filters, bulk operations, CSV export as Alla ärenden — Phase 4
- ✓ Recurring ticket templates with CRUD API and cron scheduler — Phase 5
- ✓ Recurring tickets frontend: manage templates, toggle, view history — Phase 5
- ✓ Dashboard queue cards: user-defined queues from saved filter views with live counts — Phase 5
- ✓ Reports cleanup: removed Activity Heatmap, Radial Progress Rings, and module customization UI — Phase 6
- ✓ Tag analytics bug fix: all tags from tickets now appear in Tag Cloud and Distribution Chart — Phase 6
- ✓ KB article tags (fristående från ticket-taggar) with filter — Phase 7
- ✓ KB draft/published status with list filtering — Phase 7
- ✓ ~~KB view counter~~ — Added Phase 7, removed Phase 10 (dead feature)
- ✓ ~~KB "Senast uppdaterade" section~~ — Added Phase 7, removed Phase 10 (dead feature). Print button retained.
- ✓ KB table of contents with anchor links on article detail — Phase 8
- ✓ KB article templates (Solution, How-to, Troubleshooting) — Phase 8
- ✓ KB staleness detection with last_reviewed_at and stale filter — Phase 8
- ✓ ~~KB "Populära artiklar" section~~ — Added Phase 9, removed Phase 10 (dead feature)
- ✓ KB "Se även" cross-references with bidirectional display and link picker — Phase 9
- ✓ KB `/` keyboard shortcut to focus search — Phase 9
- ✓ Ticket-to-KB article creation with pre-filled title and type — Phase 9
- ✓ Dead KB features removed (view counter, recently updated, popular articles, unused templates) — Phase 10
- ✓ Silent token refresh with rolling refresh tokens and 15m access tokens — Phase 10
- ✓ Collapsible form sections with progressive disclosure — Phase 11
- ✓ Searchable combobox dropdowns (category, template) — Phase 11
- ✓ Quick capture FAB (title-only ticket creation) — Phase 12
- ✓ Public form auth detection (skip name/email when logged in) — Phase 12
- ✓ Ticket cloning with pre-filled fields — Phase 12
- ✓ Per-theme light/dark mode with FOUC prevention and nav toggle — Phase 13

### Active

## Current Milestone: v1.4 Dashboard, Search & Polish

**Goal:** Ge systemet en komplett översiktsvy, snabb global sökning med navigation, och en polerad upplevelse med dark mode, responsiv design och micro-interactions.

**Target features:**
- Dashboard-översikt — åldrande tickets, påminnelser, "vad hände idag"-sammanfattning
- Global sökning (Cmd+K) — sök tickets, KB-artiklar, kontakter + navigera till sidor och köra actions
- UI-polish — dark mode, responsiv design (mobil/tablet), loading states och micro-interactions

### Out of Scope

- Multi-user support — single user system, no team features needed
- OAuth / SSO — email + password is sufficient
- Mobile native app — web (PWA) is sufficient
- Real-time collaboration — single user, not needed
- PDF download button — print dialog via `window.print()` is sufficient; avoids `@react-pdf/renderer` dependency

## Context

- **Stack**: React 18 + Vite (frontend), Express 4 + SQLite via better-sqlite3 (backend), Docker deployment
- **UI**: shadcn/Radix UI, Tailwind CSS, Framer Motion, recharts
- **Auth**: JWT + Passport local strategy, single admin user
- **Deployment**: Two Docker containers (nginx frontend, Node backend) with persistent volume for DB and uploads
- **Codebase**: ~496K LOC TypeScript across 40+ files modified in v1.0, expanded in v1.1
- **Reports**: Focused analytics via SQL GROUP BY endpoint (`/api/reports/summary`). 4-tab layout: Overview, Trend, People, Tags. No redundant modules.
- **Knowledge Base**: FTS5 virtual table (`kb_articles_fts`) in contentless mode with HTML stripping. Article type field (`how-to` / `solution`). Linked Tickets reverse-lookup panel. Tags, draft/published status, staleness detection. Table of contents, article templates, "Se även" cross-references, `/` search shortcut, ticket-to-KB creation.
- **Archive**: Closed-only view with full filter parity (UnifiedFilterBar, bulk operations, CSV export). Composite index on `(status, closed_at DESC)`.
- **Recurring Tickets**: `recurring_templates` + `recurring_ticket_history` tables, CRUD API at `/api/recurring`, node-cron scheduler running every minute. Management UI at `/recurring`.
- **Dashboard Queues**: User-defined queue cards from saved filter views with `countOnly` API for live counts. localStorage-backed config.
- **Filtering**: UnifiedFilterBar shared across tickets and archive. Saved filter views (`useFilterViews`). Active filter chips.
- **Tech debt (non-blocking)**: Human-verification items pending live-browser testing from v1.0-v1.2 (dashboard queue counts, scheduler fire, template toggle, Reports layout, KB features visual checks).

## Constraints

- **Tech stack**: Keep existing stack — React, Express, SQLite, Docker. No new databases or runtimes.
- **Single user**: No multi-tenancy, no team permissions, no invite flows.
- **Deployment**: Changes must rebuild via Docker. Backend runs tsx directly (no compile step).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SQLite over Postgres | Simpler ops for single-user internal tool | ✓ Good |
| JWT stateless auth | No session store needed | ✓ Good |
| recharts for reports | Already installed, fits the React stack | ✓ Good |
| Tiptap for KB editor | Rich text with image support | ✓ Good |
| Reports via SQL GROUP BY endpoint | Client-side aggregation on paginated data produced silently wrong charts | ✓ Good |
| Print-to-PDF via `window.print()` | Avoids `@react-pdf/renderer` dependency entirely | ✓ Good |
| FTS5 contentless mode (`content=''`) | Avoids data duplication; sync via `db.transaction()` in Node.js | ✓ Good |
| KB migrations wired into `initializeDatabase()` | Ensures FTS5 table and `article_type` column exist on every fresh container start | ✓ Good |
| Archive = closed tickets only (not resolved) | User confirmed resolved stays in main list; archive = closed only | ✓ Good |
| Composite index `(status, closed_at DESC)` | Archive queries filter status first for maximum selectivity | ✓ Good |
| node-cron for recurring scheduler | Lightweight, runs in-process, no external job queue needed for single-user | ✓ Good |
| localStorage for dashboard queues | No backend storage needed for personal queue config; persists across sessions | ✓ Good |
| countOnly API parameter | Avoids fetching full ticket data when only count is needed for queue cards | ✓ Good |
| UnifiedFilterBar shared component | Single filter bar for tickets + archive, stateless with onChange delegation | ✓ Good |
| Dashboard queue edit = remove + re-add | Queues are lightweight filterViewId refs, no edit-in-place needed | ✓ Good |
| Tag analytics from ticket data | Build tag lists from ticket.tags, not tags table — handles deleted tags | ✓ Good |
| KB tags separate from ticket tags | Freeform join table, no shared vocabulary — different domains | ✓ Good |
| COALESCE(last_reviewed_at, created_at) for staleness | Never-reviewed articles fall back to created_at | ✓ Good |
| slugify for ToC anchor IDs | Normalizes Swedish chars for DOMPurify-safe IDs, set post-render via setAttribute | ✓ Good |
| Hard-coded article templates | 3 templates (Solution, How-to, Troubleshooting) — no CRUD needed for single user | ✓ Good |
| kb_article_links directional with UNION read | Stores one direction, reads/deletes bidirectionally via UNION/OR | ✓ Good |
| Link picker excludes self and already-linked | Prevents duplicates and self-references in Se även panel | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-31 after Phase 13 completion*
