# IT Ticket System

## What This Is

An internal IT ticket system for single-user use. Tickets are submitted, tracked, and resolved through a web interface. A knowledge base stores how-to guides and ticket solutions, with full-text search, article type classification, and two-way ticket links. Reports provide focused analytics over the full ticket dataset. An archive gives period-based visibility into closed work with full filter parity. Recurring tickets auto-create on schedule. The dashboard surfaces aging tickets, today's activity, upcoming reminders, and user-defined queue cards. A Cmd+K command palette provides instant search across tickets and KB articles with navigation and quick actions. The UI supports light/dark mode across multiple themes, is fully responsive on mobile with bottom tab navigation, and uses skeleton loading states and Framer Motion animations throughout.

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
- ✓ Unified filter bar across Alla ärenden and Arkiv with filter views — v1.1
- ✓ Arkiv parity: same filters, bulk operations, CSV export as Alla ärenden — v1.1
- ✓ Recurring ticket templates with CRUD API and cron scheduler — v1.1
- ✓ Recurring tickets frontend: manage templates, toggle, view history — v1.1
- ✓ Dashboard queue cards: user-defined queues from saved filter views with live counts — v1.1
- ✓ Reports cleanup: removed Activity Heatmap, Radial Progress Rings, and module customization UI — v1.1
- ✓ Tag analytics bug fix: all tags from tickets now appear in Tag Cloud and Distribution Chart — v1.1
- ✓ KB article tags (fristående från ticket-taggar) with filter — v1.2
- ✓ KB draft/published status with list filtering — v1.2
- ✓ KB table of contents with anchor links on article detail — v1.2
- ✓ KB article templates (Solution, How-to, Troubleshooting) — v1.2
- ✓ KB staleness detection with last_reviewed_at and stale filter — v1.2
- ✓ KB "Se även" cross-references with bidirectional display and link picker — v1.2
- ✓ KB `/` keyboard shortcut to focus search — v1.2
- ✓ Ticket-to-KB article creation with pre-filled title and type — v1.2
- ✓ Dead KB features removed (view counter, recently updated, popular articles, unused templates) — v1.3
- ✓ Silent token refresh with rolling refresh tokens and 15m access tokens — v1.3
- ✓ Collapsible form sections with progressive disclosure — v1.3
- ✓ Searchable combobox dropdowns (category, template) — v1.3
- ✓ Quick capture FAB (title-only ticket creation) — v1.3
- ✓ Public form auth detection (skip name/email when logged in) — v1.3
- ✓ Ticket cloning with pre-filled fields — v1.3
- ✓ Per-theme light/dark mode with FOUC prevention and nav toggle — v1.4
- ✓ Dashboard aging tickets panel sorted by staleness — v1.4
- ✓ Dashboard today summary KPIs (created/resolved/closed today) — v1.4
- ✓ Dashboard upcoming reminders widget — v1.4
- ✓ Command palette (Cmd+K) with ticket/KB search, navigation, quick actions, recently-viewed — v1.4
- ✓ Mobile bottom tab bar with responsive navigation — v1.4
- ✓ Responsive card reflow for tickets and single-column KB on mobile — v1.4
- ✓ Collapsible filter bar on mobile — v1.4
- ✓ Skeleton loading states on all data-fetching pages — v1.4
- ✓ Framer Motion page transitions, staggered list reveals, and KPI entrance — v1.4
- ✓ prefers-reduced-motion accessibility guard on all animations — v1.4

### Active

#### Current Milestone: v1.5 Productivity & Insights

**Goal:** Ge insikt i tidsåtgång, proaktiva notifieringar, datasäkerhet via backup, och snabbare kunskapsåtkomst under ärendearbete.

**Target features:**
- Tidsloggning — enkel tidsspårning per ärende med rapportöversikt
- PWA push-notiser — webbnotiser för påminnelser och aging-ärenden
- Backup & export — ladda ner databas + filer som zip via UI
- KB från ärendevyn — sök och länka KB-artiklar direkt från ärendedetalj

### Out of Scope

- Multi-user support — single user system, no team features needed
- OAuth / SSO — email + password is sufficient
- Mobile native app — web (PWA) is sufficient
- Real-time collaboration — single user, not needed
- PDF download button — print dialog via `window.print()` is sufficient; avoids `@react-pdf/renderer` dependency
- Aktivitetstidslinje — hög komplexitet, lågt värde för single-user
- Swipe-gester — over-engineering för intern tool
- Smart priority-förslag — AI/heuristik inte motiverat vid nuvarande volym
- E-postintegration — kräver separat mailbox, vill inte att alla mail blir ärenden
- SLA/deadline-hantering — inte motiverat för single-user system

## Context

- **Stack**: React 18 + Vite (frontend), Express 4 + SQLite via better-sqlite3 (backend), Docker deployment
- **UI**: shadcn/Radix UI, Tailwind CSS, Framer Motion, recharts
- **Auth**: JWT + Passport local strategy, single admin user, silent token refresh with rolling refresh tokens
- **Deployment**: Two Docker containers (nginx frontend, Node backend) with persistent volume for DB and uploads
- **Reports**: Focused analytics via SQL GROUP BY endpoint (`/api/reports/summary`). 4-tab layout: Overview, Trend, People, Tags.
- **Knowledge Base**: FTS5 virtual table (`kb_articles_fts`) in contentless mode with HTML stripping. Article type field (`how-to` / `solution`). Linked Tickets reverse-lookup panel. Tags, draft/published status, staleness detection. Table of contents, article templates, "Se även" cross-references, `/` search shortcut, ticket-to-KB creation.
- **Archive**: Closed-only view with full filter parity (UnifiedFilterBar, bulk operations, CSV export). Composite index on `(status, closed_at DESC)`.
- **Recurring Tickets**: `recurring_templates` + `recurring_ticket_history` tables, CRUD API at `/api/recurring`, node-cron scheduler running every minute.
- **Dashboard**: Aging tickets panel, today summary KPIs with sub-labels, upcoming reminders panel, user-defined queue cards from saved filter views with `countOnly` API.
- **Command Palette**: Cmd+K modal with debounced search across tickets and KB articles, navigation shortcuts, quick actions (create ticket, toggle theme), recently-viewed history via localStorage.
- **Filtering**: UnifiedFilterBar shared across tickets and archive. Collapsible on mobile. Saved filter views (`useFilterViews`). Active filter chips.
- **Responsive**: Bottom tab bar on mobile (md:hidden), card reflow for ticket lists, single-column KB grid, Kanban hidden on mobile.
- **Animations**: Framer Motion AnimatePresence for page transitions, staggered list reveals, skeleton-to-content crossfade, prefers-reduced-motion guard.
- **Theming**: 4 color themes (Slate, Midnight, Graphite, Stone) with light/dark mode. FOUC-blocking script in index.html. Recharts remount on mode toggle.
- **Shipped**: v1.0 → v1.4, 16 phases, 36 plans across 4 milestones.

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
| KB tags separate from ticket tags | Freeform join table, no shared vocabulary — different domains | ✓ Good |
| kb_article_links directional with UNION read | Stores one direction, reads/deletes bidirectionally via UNION/OR | ✓ Good |
| Rolling refresh tokens | Each refresh generates new token, prevents reuse of leaked tokens | ✓ Good |
| Dedicated dashboard SQL endpoints | Separate `/dashboard-overview` and `/upcoming-reminders` routes avoid overloading paginated ticket queries | ✓ Good |
| cmdk for command palette | Lightweight, accessible, keyboard-native — fits shadcn pattern | ✓ Good |
| AnimatePresence in App.tsx for route transitions | Single wrapper instead of per-page PageTransition components — simpler, less code | ✓ Good |
| Bottom tab bar over hamburger menu | Direct navigation without hidden menus — better mobile UX for 4-tab app | ✓ Good |
| Collapsible filter bar on mobile | Filters rarely used on phone — search stays visible, rest behind toggle | ✓ Good |

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
*Last updated: 2026-04-05 after v1.5 milestone start*
