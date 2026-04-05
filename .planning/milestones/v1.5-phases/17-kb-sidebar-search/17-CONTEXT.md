# Phase 17: KB Sidebar Search - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Refactor KBLinksSection to use server-side FTS5 search, show already-linked articles, and allow linking from search results — all without leaving ticket detail. Zero backend changes needed.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
User deferred all implementation decisions to Claude. The following areas are open for Claude to decide during planning/implementation:

- **Placement & layout** — Whether to keep inline section, switch to Sheet/sidebar, or use an expanded popover. Consider existing ticket detail structure (KBLinksSection sits after comments/activity).
- **Search behavior** — Result format, number of hits shown, what metadata per article (title, snippet via FTS5 `<mark>` highlights, category badge). Debounce timing for search input.
- **Linked articles display** — How already-linked articles relate to the search area. Separation, visual hierarchy, unlink affordance.
- **Empty/loading states** — Skeleton patterns, empty search state, no-results state.

Design should follow existing patterns in the codebase (shadcn components, React Query hooks, Tailwind styling).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing KB linking code
- `src/components/KBLinksSection.tsx` — Current implementation: fetches all articles client-side, filters locally. Refactor target.
- `src/pages/TicketDetail.tsx` — Where KBLinksSection is rendered (after comments/activity, line ~612)

### API endpoints (no changes needed)
- `server/src/routes/kb.ts` — `GET /api/kb/articles?search=` (FTS5), `GET /api/kb/ticket/:ticketId` (linked articles), `POST/DELETE /api/kb/ticket/:ticketId` (link/unlink)
- `src/lib/api.ts` — Client methods: `getKbArticles(params)`, `getTicketKbLinks()`, `linkKbArticleToTicket()`, `unlinkKbArticleFromTicket()`

### Research
- `.planning/research/FEATURES.md` — KB sidebar feature analysis, table stakes, anti-features
- `.planning/research/ARCHITECTURE.md` — Integration architecture for KB sidebar

No external specs — requirements fully captured in REQUIREMENTS.md (KBSB-01, KBSB-02, KBSB-03).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `KBLinksSection.tsx`: Current component — refactor in place rather than replace
- `api.getKbArticles({ search })`: Already supports FTS5 search with `<mark>` snippets
- `api.getTicketKbLinks(ticketId)`: Fetches linked articles for a ticket
- `api.linkKbArticleToTicket()` / `api.unlinkKbArticleFromTicket()`: Link/unlink APIs
- shadcn Sheet, Popover, Input, Badge components available
- React Query (`useQuery`, `useMutation`) pattern used throughout

### Established Patterns
- Debounced search: CommandPalette uses 300ms debounce with `useDebounce` hook
- FTS5 results return `<mark>` highlighted snippets — same pattern used in KB list page
- Category badges with colored styling used across KB pages
- Skeleton loading states on all data-fetching pages (v1.4 pattern)

### Integration Points
- `TicketDetail.tsx` line ~612: `<KBLinksSection ticketId={...} ticketTitle={...} />`
- No changes to server routes, database, or API client needed
- React Query cache invalidation on link/unlink mutations

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User explicitly deferred all UX decisions to Claude.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 17-kb-sidebar-search*
*Context gathered: 2026-04-05*
