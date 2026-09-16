# IT Ticket System

## What This Is

An internal IT support ticketing system for Prefabmästarna, used by a single support team (no multi-tenancy, one instance per deployment). Tickets are submitted (via authenticated UI or an unauthenticated public form, now also created automatically from inbound email over IMAP/M365 OAuth2), tracked through Kanban/list views, and resolved with the help of a knowledge base (full-text search, article type classification, cross-references) and Claude-powered AI assists (KB-based deflection before a ticket is even created, category suggestion, draft replies, ticket summaries). Reports provide analytics over the full ticket dataset; an archive gives period-based visibility into closed work. The dashboard surfaces aging tickets, today's activity, upcoming reminders, and user-defined queue cards, with a Cmd+K command palette for instant search. Auth supports both local JWT+refresh-token login and Microsoft 365 single sign-on (OIDC, single-tenant locked), plus API keys and HMAC-signed webhooks for integrations. An admin-only architecture map gives a visual, searchable view of the system's own routes and data flow, shared with the sibling Document Hub project; the app can also be embedded inside Prefabnavet (Document Hub) via a postMessage bridge. SLA tracking, per-customer billing, and time tracking were built for a planned multi-customer model, then deliberately removed (2026-09-08) when the product direction was confirmed as single-team internal support — those features, plus recurring ticket templates and the quick-capture FAB, no longer exist in the codebase. The UI supports light/dark mode across multiple themes, is fully responsive on mobile with bottom tab navigation, and uses skeleton loading states and Framer Motion animations throughout.

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
- ✓ KB sidebar search from ticket detail with FTS5 — v1.5
- ✓ Time tracking per ticket with duration logging and Reports "Tid" tab — v1.5
- ✓ WAL-safe database backup & export as ZIP from Settings — v1.5
- ✓ PWA push notifications for reminders and aging tickets via VAPID — v1.5
- ✓ Push notification Settings UI toggle with permission-on-action — v1.5

— post-v1.5 (2026-04 to 2026-09, no milestone tags tracked)

- ✓ AI integration via Anthropic SDK: KB-based deflection on the public portal before ticket creation, category suggestion, draft replies, ticket summarization — circuit breaker + consecutive-failure tracking, per-installation `ai_usage_log` cost tracking, configurable default/smart model via env
- ✓ Email-to-ticket: IMAP polling with OAuth2 (XOAUTH2) against Microsoft 365, auto-ticket creation, attachment handling, dead-letter for poison messages
- ✓ Two-way email threading: customer replies become ticket comments instead of new tickets; confirmation email with auto-generated public share link on ticket creation from email
- ✓ Two-way email toggle in Settings (`app_settings` table) to gate customer-facing sends per-installation
- ✓ Public ticket submission form redesigned and iterated (two-step flow tried and reverted back to single page with chips); priority selection removed from the public form (staff triages priority internally)
- ✓ OIDC-SSO for Microsoft 365: PKCE + state + nonce, single-tenant lock, account linking/unlinking by admin, Microsoft-branded login button, `returnTo` preserved through logout→login
- ✓ API keys with selectable scope (including opt-in admin scope) and audit trail of which key performed an admin action
- ✓ Webhooks: CRUD + event dispatcher, HMAC-signed payloads, retry scheduler
- ✓ Companies as a first-class entity (grouping for contacts/tickets, with stats) — kept after SLA/billing removal, now used purely for org context, not billing
- ✓ Forgot/reset password flow with anti-enumeration
- ✓ Ticket sharing links with configurable expiry and admin revoke
- ✓ Audit log with admin UI
- ✓ Downloadable backup made schedulable/editable from admin UI (pause, time, retention, run-now) plus offsite backup support
- ✓ PWA push notification for new tickets to all staff devices (iOS-safe deep link via postMessage)
- ✓ Configurable branding: logo, sidebar icon, `BRAND_NAME` env for white-label mode
- ✓ KB: public article links, bulk import of `.md`/`.txt`, image lightbox, ticket-to-KB creation flow
- ✓ Admin architecture map (`/architecture-map`): interactive graph + known-issues viewer, shared implementation with Document Hub, supports `?embed=1` for hosting inside Document Hub's Navet
- ✓ Embeddable inside Prefabnavet (Document Hub) via a dedicated postMessage bridge (`prefabnavetBridge`) and relaxed-but-scoped nginx framing
- ✓ Exports switched from CSV to XLSX
- ✓ Dependency modernization: React 18→19, Express 4→5, TypeScript 5→6, react-router-dom→react-router 8, zod 3→4, ESLint 9→10, Node 20→22 LTS
- ✓ **Removed** (2026-09-08 simplification pass, after being fully built and shipped): SLA policy engine (per-company policies, breach detection, escalation), billing (rates, real invoices with sequential numbering/VAT), time tracking (`time_entries`, Reports "Tid" tab), recurring ticket templates + scheduler, quick-capture FAB, ticket tag analytics/tag cloud UI (the underlying `tags`/`ticket_tags` tables and basic tag filtering remain, but the dedicated analytics view is gone)
- ✓ Retired the server-side dev Portainer stack (id 40) — localhost hot-reload covers the same need without an unmonitored duplicate environment

### Active

(No active milestone — use `/gsd-new-milestone` to start next)

### Out of Scope

- Multi-user support — single-team system, no team/role permission features needed (Companies exists only as a contact-grouping entity, not a path back to multi-tenancy)
- Mobile native app — web (PWA) is sufficient
- Real-time collaboration — single-team, not needed
- PDF download button — print dialog via `window.print()` is sufficient; avoids `@react-pdf/renderer` dependency
- Aktivitetstidslinje — hög komplexitet, lågt värde för intern support
- Swipe-gester — over-engineering för intern tool
- Smart priority-förslag — AI/heuristik inte motiverat vid nuvarande volym (AI *kategori*-förslag är dock skeppat — detta gäller specifikt prioritet)
- **SLA/deadline-hantering per kund** — byggt i sin helhet (policyer, brottsdetektion, eskalering) och sedan explicit borttaget 2026-09-08; falsklarm för ett internt-only-verktyg, inte motiverat utan riktiga multi-kund-avtal
- **Fakturering/billing** — byggt i sin helhet (prissatser, riktiga löpnummer-fakturor med moms) och sedan explicit borttaget 2026-09-08 tillsammans med SLA, samma motivering
- **Tidsregistrering (time tracking)** — byggt, skeppat i v1.5, sedan borttaget 2026-09-08 som del av samma avvecklingssvep
- **Återkommande ärenden (recurring tickets)** — byggt, skeppat i v1.1, sedan borttaget 2026-09-08
- **Snabbinmatning (Quick Capture FAB)** — byggt, skeppat i v1.3, sedan borttaget 2026-09-08 tillsammans med en KB-designjustering

Borttaget från Out of Scope eftersom det sedan skeppats:
- ~~E-postintegration~~ — skeppat: IMAP-polling + M365 OAuth2, två-vägs-trådning, auto-ärendeskapande
- ~~OAuth / SSO~~ — skeppat: OIDC-SSO mot Microsoft 365 (single-tenant-låst), vid sidan av lokal JWT-inloggning

## Context

- **Stack**: React 19 + Vite + TypeScript (frontend), Express 5 + TypeScript (backend, Node 22), SQLite via better-sqlite3 with FTS5 contentless full-text search, Docker deployment (two containers: nginx frontend, Node backend)
- **Two package.json**: root (frontend) and `server/` (backend), separate vitest suites
- **UI**: shadcn/ui + Radix, Tailwind CSS, Framer Motion, TipTap (KB editor), @tanstack/react-query
- **AI**: Anthropic Claude SDK — deflection (public portal pre-ticket-creation), category suggestion, draft reply, ticket summary; circuit breaker + failure tracking; per-installation cost logging in `ai_usage_log`
- **Mail**: ImapFlow (inbound polling, XOAUTH2 against M365) + @azure/msal-node (OAuth2 client credentials), two-way threading (replies→comments), SMTP outbound gated by `app_settings.two_way_email_enabled`
- **Auth**: JWT access tokens (15 min) + rolling refresh tokens; OIDC-SSO (Microsoft 365, single-tenant lock, PKCE+state+nonce, admin link/unlink); API keys (SHA-256, scoped incl. optional admin scope) with per-key audit attribution; CSRF via csrf-csrf; webhooks HMAC-signed with retry scheduler
- **Deployment**: Portainer stack on a Proxmox Docker host; Portainer's stack definition is a separate copy of `docker-compose.yml` and must be updated manually in the GUI — `git pull` on the server does not sync it. The formerly-parallel dev stack (Portainer id 40) was retired 2026-09-13
- **Reports**: SQL GROUP BY endpoints; XLSX export (replaced CSV)
- **Knowledge Base**: FTS5 contentless, article type (`how-to`/`solution`), tags, draft/published status, staleness detection, TOC, templates, "Se även" cross-refs, bulk `.md`/`.txt` import, image lightbox, public article links, ticket-to-KB creation
- **Companies**: entity for grouping contacts/tickets with stats (contact/open/total ticket counts) — survives the SLA/billing removal as a plain organizational grouping, `sla_disabled` column is now vestigial
- **Removed subsystems** (built, shipped, then deliberately deleted 2026-09-08): SLA engine, billing/invoicing, time tracking, recurring ticket templates, quick-capture FAB — routes, tables (`time_entries` dropped from `schema.sql`), and frontend components no longer exist; do not assume PROJECT.md history describing them still reflects the running app
- **Architecture Map**: admin-only viewer at `/architecture-map`, snapshot graph + known-issues JSON in `server/admin_assets/architecture-map/`, shared HTML/CSS/JS viewer with Document Hub (kept in sync via a build script in that repo), `?embed=1` for hosting inside Document Hub's Navet
- **Prefabnavet embedding**: `src/lib/prefabnavetBridge.ts` postMessage bridge + relaxed nginx framing to allow the app to run inside an iframe in the sibling Document Hub app
- **Branding**: configurable logo, sidebar icon, `BRAND_NAME` env for white-label deployments
- **Two schema install paths**: prod is upgraded via ALTER migrations since Feb 2026; CI/dev/fresh installs use current `schema.sql` directly — `schema-path-parity.test.ts` enforces both stay equivalent
- **Shipped**: v1.0 → v1.5 (20 phases, 43 plans, 6 milestones, tracked through 2026-04-06), plus ~498 untracked commits since (AI, email, OIDC-SSO, API keys/webhooks, companies, architecture map, Prefabnavet embedding, branding, and a major SLA/billing/time-tracking/recurring/quick-capture removal) — no GSD milestone tags exist for this later work

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
| parseDuration with Swedish 't' notation | Users expect "1t 30m" for 1h30m — locale-friendly input | ✓ Good |
| time_entries idempotent migration via tableExists guard | Matches existing pattern in initializeDatabase() | ✓ Good |
| Vertical BarChart for time categories | Category names on Y-axis read better with long Swedish labels | ✓ Good |
| db.backup() for WAL-safe SQLite snapshot | better-sqlite3's .backup() checkpoints WAL — no corrupt copies | ✓ Good |
| ZIP structure mirroring data/ directory | data/database.sqlite + data/uploads/ — predictable restore path | ✓ Good |
| VAPID graceful degradation | initWebPush returns false if keys not set — app runs without push | ✓ Good |
| injectManifest over generateSW | Custom service worker needed for push event + notificationclick handlers | ✓ Good |
| Permission-on-action for push | Notification.requestPermission() only on explicit Settings toggle — never on page load | ✓ Good |
| SMTP conditional guard in reminder scheduler | Push-only path works when SMTP not configured — no hard dependency | ✓ Good |
| Expired subscription cleanup on 410/404 | Push service returns 410 for expired subs — auto-delete prevents waste | ✓ Good |
| Build companies/SLA/billing as a multi-customer model | Explored expanding beyond single-team internal support | Reverted |
| Remove SLA and billing entirely | Internal-only tool generated false SLA alarms; billing not needed without real customer contracts | ✓ Good |
| Remove time tracking, recurring tickets, quick-capture FAB, tag analytics UI | Broader simplification pass once direction was confirmed as single-team internal support, not a general MSP tool | ✓ Good |
| Keep `companies` table after removing SLA/billing | Still useful as a plain contact/ticket grouping; not worth a migration to drop it | ✓ Good |
| OIDC-SSO for Microsoft 365, single-tenant locked | Staff already have M365 accounts; avoids managing local passwords for most logins while keeping local JWT login as fallback | ✓ Good |
| AI via Anthropic SDK, conservative deflection | Differentiator: solve the user's problem from the KB before a ticket is even created; must say "don't know" rather than hallucinate | ✓ Good |
| Circuit breaker + consecutive-failure tracking on AI calls | Prevents silent AI outages and cost leaks from cascading into every ticket action | ✓ Good |
| XLSX over CSV for exports | Better fidelity for spreadsheet consumers | ✓ Good |
| Architecture map viewer shared with Document Hub | Single implementation instead of maintaining two divergent viewers for the same concept | ✓ Good |
| Prefabnavet embedding via postMessage bridge | Lets the ticket system live inside the internal portal (Document Hub) without merging codebases | ✓ Good |
| Retire the server-side dev stack (Portainer id 40) | Rarely used, its backend had silently crash-looped for ~9 days, and localhost dev already covers the same need | ✓ Good |
| Portainer stack definition kept separate from repo `docker-compose.yml` | Existing Portainer operational model — not something this milestone should try to fix | Known friction, documented |

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
*Last updated: 2026-09-16 — reconciled against actual codebase/CLAUDE.md after ~498 untracked commits since the v1.5 milestone (2026-04-06)*
