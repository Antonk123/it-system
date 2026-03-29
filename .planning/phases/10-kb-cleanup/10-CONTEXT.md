# Phase 10: KB Cleanup - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Strip unused features from the knowledge base (view counter, "Senast uppdaterade", "Populära artiklar", unused templates) and fix token refresh so the user never sees a login screen unless inactive for 7+ days. Pure removal + one behavioral fix — no new capabilities.

</domain>

<decisions>
## Implementation Decisions

### Database Cleanup (CLEAN-01, CLEAN-02, CLEAN-04)
- **D-01:** Full removal of view_count — strip from all API endpoints, UI display, and queries. Column stays in existing DBs (no table rebuild migration) but is omitted from `schema.sql` for fresh installs.
- **D-02:** Drop the "Populära artiklar" section AND its API endpoint (`/api/kb/articles/popular` or equivalent). No replacement metric — section is gone.
- **D-03:** Drop the "Senast uppdaterade" section AND its API endpoint. Both UI and backend query removed entirely.

### Template Removal (CLEAN-03)
- **D-04:** Remove "Lösenordsåterställning" and "Ny användare" from seed data AND add a migration that deletes these rows from the live DB.
- **D-05:** Before deleting templates, null out `template_id` on any tickets that reference them. No orphaned foreign keys.

### Token Refresh (CLEAN-05)
- **D-06:** "Inactive for 7+ days" means 7 days since last authenticated API call. Any API request resets the clock.
- **D-07:** The current pain point is access token expiring too fast and silent refresh not catching it. Fix: ensure refresh token interceptor works reliably and extend access token / refresh token lifetimes appropriately.
- **D-08:** When refresh token is truly expired (7+ days inactive), silently redirect to `/login` — no error toast. Login after long absence is expected, not an error.

### Verification
- **D-09:** Verification via code review (grep for removed references) + manual spot-check on live app after deploy. No automated test assertions needed.
- **D-10:** No data export before removal. View counts and template definitions can be deleted without backup.

### Claude's Discretion
- Access token and refresh token expiry durations — Claude picks values that satisfy the 7-day inactivity requirement
- Order of removals (which CLEAN-XX to tackle first)
- Whether to combine related removals into single commits or keep them atomic

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### KB Feature Code
- `src/pages/KnowledgeBase.tsx` — KB home page with "Senast uppdaterade" and "Populära artiklar" sections to remove
- `src/pages/KBArticleDetail.tsx` — Article detail page with view count display to remove
- `server/src/routes/kb.ts` — KB API endpoints including view count increment and popular/recent queries
- `src/lib/api.ts` — API client methods for KB features (view count, popular, recent)
- `server/src/db/connection.ts` — DB schema initialization including view_count column and template seeding

### Template Code
- `server/src/db/seed-templates.ts` — Template seed data containing "Lösenordsåterställning" and "Ny användare"
- `src/components/TemplateEditorModal.tsx` — Template editor (may reference these templates)
- `src/pages/Settings.tsx` — Settings page with template management

### Token Refresh Code
- `src/lib/tokenRefresh.ts` — Axios interceptor for automatic token refresh
- `server/src/routes/auth.ts` — Auth endpoints including `/refresh`
- `server/src/db/add-refresh-tokens.ts` — Refresh token DB migration
- `src/main.tsx` — Token setup on app load
- `src/contexts/AuthContext.tsx` — Auth state management

### Requirements
- `.planning/REQUIREMENTS.md` — CLEAN-01 through CLEAN-05 definitions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tokenRefresh.ts` — Existing Axios interceptor that handles token refresh; needs fixing, not replacing
- `AuthContext.tsx` — Auth state provider; redirect-to-login logic likely lives here or in a route guard

### Established Patterns
- Idempotent migrations in `server/src/db/` — template deletion migration should follow same pattern (check before altering)
- API client methods in `src/lib/api.ts` — removed endpoints need their client methods stripped too
- React Query hooks — any hooks fetching popular/recent articles need removal

### Integration Points
- `KnowledgeBase.tsx` is the main KB home page — removing sections changes its layout
- `schema.sql` defines fresh-install schema — must be updated to omit view_count for new installs
- `initializeDatabase()` in `connection.ts` — migration for template deletion wired in here

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard removal and fix approaches apply.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-kb-cleanup*
*Context gathered: 2026-03-30*
