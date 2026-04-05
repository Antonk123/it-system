# Phase 15: Command Palette - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Cmd+K / Ctrl+K modal palette for searching tickets and KB articles, navigating to any page, and running quick actions — all without touching the mouse. Replaces the existing GlobalSearch inline component.

</domain>

<decisions>
## Implementation Decisions

### Relation to GlobalSearch
- **D-01:** Replace `GlobalSearch.tsx` entirely — the Command Palette takes over Cmd+K and all search functionality. Remove GlobalSearch from `Layout.tsx`. One unified search surface.
- **D-02:** Reuse the existing `cmdk` library and `src/components/ui/command.tsx` (shadcn `CommandDialog` wrapper) as the foundation. No new library needed.
- **D-03:** Migrate useful logic from GlobalSearch: backend search with debounce, `recently_viewed_tickets` localStorage, `mapTicketRow` helper, normalize search logic.

### Idle state (empty query)
- **D-04:** When opened with no query, show three sections in order: (1) Recently visited tickets and KB articles, (2) Navigation links (Dashboard, Tickets, KB, Archive, Reports, Settings, Users, Recurring), (3) Quick actions.
- **D-05:** Recently visited items sourced from localStorage (`recently_viewed_tickets` already exists; add `recently_viewed_kb` for KB articles).

### Search behavior
- **D-06:** Typing filters all result types together in a single mixed list — tickets and KB articles ranked by relevance, with a type badge (Ärende / KB) to distinguish them. Navigation items and quick actions also filterable by typing.
- **D-07:** Backend search with debounce (250ms, carried from GlobalSearch). Search tickets via existing `/api/tickets?search=` endpoint; search KB via `/api/kb/articles?search=` (or similar).
- **D-08:** Limit to 5 tickets + 5 KB articles in search results. Show "Visa alla resultat" link if more exist.

### Quick actions
- **D-09:** Quick actions set: Create new ticket (`/tickets/new`), Create KB article (`/kb/new`), Toggle light/dark mode (instant switch via `appearance.ts`), Go to settings (`/settings`).
- **D-10:** Quick actions shown as a "Snabbåtgärder" group with icons. Each action has a keyboard shortcut hint displayed (but not bound — just visual reference).

### Claude's Discretion
- Animation and transitions for modal open/close
- Exact keyboard navigation behavior (arrow keys, Enter, Escape — cmdk handles most of this)
- Search result item design (how much info per result row)
- Whether to show a search icon or footer hint ("ESC to close") in the palette

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing search infrastructure
- `src/components/GlobalSearch.tsx` — Current search component to be replaced; contains backend search logic, recent tickets, mapTicketRow helper
- `src/components/ui/command.tsx` — shadcn Command component wrapping `cmdk`; includes CommandDialog modal wrapper

### Navigation and routing
- `src/App.tsx` lines 95-116 — All route definitions (Dashboard, Tickets, KB, Archive, Reports, Settings, Users, Recurring)
- `src/components/Layout.tsx` — Where GlobalSearch is mounted; sidebar navigation structure

### Theme system
- `src/lib/appearance.ts` — Theme toggle logic (`ModeTheme`, `MODE_STORAGE_KEY`, light/dark switching)

### Backend search endpoints
- `server/src/routes/tickets.ts` — `GET /api/tickets?search=` with pagination
- `server/src/routes/kb.ts` — KB article routes (check for search support)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cmdk` library already installed — `CommandDialog`, `CommandGroup`, `CommandItem`, `CommandList`, `CommandEmpty` all available
- `GlobalSearch.tsx` search logic: backend debounce (250ms), `mapTicketRow()`, `normalizeSearch()`, `recently_viewed_tickets` localStorage
- `appearance.ts` theme toggle: `getModeTheme()`, `setModeTheme()` — ready to use for quick action
- `useNavigate` from react-router-dom for all navigation actions

### Established Patterns
- Hooks pattern: `useTickets.ts`, `useDashboardOverview.ts` etc. — React Query hooks with `api.request()`
- Component pattern: PascalCase files in `src/components/`, shadcn UI primitives in `src/components/ui/`
- Search pattern: debounced backend search, 250ms delay, results mapped to typed interfaces

### Integration Points
- `Layout.tsx` — Remove GlobalSearch, add Command Palette trigger (or make it global via App.tsx)
- `App.tsx` — Potential location for global palette if it should work across all pages
- localStorage — Extend `recently_viewed_tickets` pattern to `recently_viewed_kb`
- Cmd+K keydown listener — currently in GlobalSearch, needs to move to palette

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-command-palette*
*Context gathered: 2026-03-31*
