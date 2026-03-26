# IT Ticket System

## What This Is

An internal IT ticket system for single-user use. Tickets are submitted, tracked, and resolved through a web interface. A knowledge base stores how-to guides and ticket solutions, with full-text search, article type classification, and two-way ticket links. Reports provide analytics over the full ticket dataset. An archive gives period-based visibility into closed work with date range filtering.

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

### Active

## Current Milestone: v1.1 Quality & Automation

**Goal:** Rensa upp filtreringsröran, ge Arkiv samma verktyg som ärendelistan, lägg till återkommande ärenden, smarta dashboard-köer, och polera Reports.

**Target features:**
- Konsolidera filterupplevelsen på Alla ärenden (ta bort redundanta lager, slå ihop)
- Ge Arkiv-sidan paritet med Alla ärenden (filtervyer, checklistefilter, bulk-operationer)
- Återkommande ärenden — auto-skapa ärenden på schema
- Dashboard-köer — sparade snabbvyer på Dashboard
- Reports-rensning — ta bort överlappande moduler, fixa tagg-analytics-bugg, strama upp design

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
- **Codebase**: ~496K LOC TypeScript across 40+ files modified in v1.0
- **Reports**: Full-dataset analytics via SQL GROUP BY endpoint (`/api/reports/summary`). Category breakdown, open/closed trend overlay, print-to-PDF.
- **Knowledge Base**: FTS5 virtual table (`kb_articles_fts`) in contentless mode with HTML stripping. Article type field (`how-to` / `solution`). Linked Tickets reverse-lookup panel. Migration wired into `initializeDatabase()`.
- **Archive**: Closed-only view with date range filter on `closed_at`. Composite index `idx_tickets_closed_at ON tickets(status, closed_at DESC)`. URL-persisted filter params.
- **Tech debt (non-blocking)**: 9 human-verification items pending live-browser confirmation (print quality, search highlights, linked tickets panel, type badge/filter, date filter correctness). All code is present and wired.

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
*Last updated: 2026-03-26 after v1.1 milestone start*
