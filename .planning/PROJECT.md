# IT Ticket System

## What This Is

An internal IT ticket system for single-user use. Tickets are submitted, tracked, and resolved through a web interface. A knowledge base stores how-to guides and ticket solutions. Reports and an archive provide historical visibility into resolved work.

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

### Active

- [ ] Reports page — ticket stats over time (open/closed trend charts by week/month)
- [ ] Reports page — category and tag breakdown charts
- [ ] Reports page — export filtered ticket sets to CSV or PDF
- [ ] Archive view — separate page for closed/resolved tickets, removed from main list
- [ ] KB rework — full-text search across all articles
- [ ] KB rework — two-way linking between tickets and KB articles
- [ ] KB rework — article categories (how-to guides vs. ticket solutions)

### Out of Scope

- Multi-user support — single user system, no team features needed
- OAuth / SSO — email + password is sufficient
- Mobile native app — web (PWA) is sufficient
- Real-time collaboration — single user, not needed

## Context

- **Stack**: React 18 + Vite (frontend), Express 4 + SQLite via better-sqlite3 (backend), Docker deployment
- **UI**: shadcn/Radix UI, Tailwind CSS, Framer Motion, recharts (already installed)
- **Auth**: JWT + Passport local strategy, single admin user
- **Deployment**: Two Docker containers (nginx frontend, Node backend) with persistent volume for DB and uploads
- **KB current state**: CRUD works, Tiptap editor in place, but missing search, article organization, and ticket integration
- **Reports current state**: recharts is installed but no reports page exists yet
- **Archive current state**: Closed tickets exist in the DB but appear in the main ticket list with no separation

## Constraints

- **Tech stack**: Keep existing stack — React, Express, SQLite, Docker. No new databases or runtimes.
- **Single user**: No multi-tenancy, no team permissions, no invite flows.
- **Deployment**: Changes must rebuild via Docker. Backend runs tsx directly (no compile step).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SQLite over Postgres | Simpler ops for single-user internal tool | ✓ Good |
| JWT stateless auth | No session store needed | ✓ Good |
| recharts for reports | Already installed, fits the React stack | — Pending |
| Tiptap for KB editor | Rich text with image support | ✓ Good |

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
*Last updated: 2026-03-22 after initialization*
