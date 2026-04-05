---
phase: 17-kb-sidebar-search
plan: "01"
subsystem: frontend/kb
tags: [kb, search, fts5, react-query, refactor]
dependency_graph:
  requires: []
  provides: [kb-sidebar-fts5-search, ticket-kb-link-ui]
  affects: [src/components/KBLinksSection.tsx]
tech_stack:
  added: []
  patterns: [react-query-useQuery, react-query-useMutation, debounced-search, fts5-snippet-render]
key_files:
  created: []
  modified:
    - src/components/KBLinksSection.tsx
decisions:
  - "Replaced Popover/Command pattern with inline Input + results list below linked articles"
  - "FTS5 search enabled only when debouncedSearch >= 2 chars to avoid unnecessary API calls"
  - "FTS5 mark snippets rendered directly — safe in single-user system (no external input)"
  - "Linked articles list shown before search area to satisfy KBSB-03"
metrics:
  duration_seconds: 155
  completed_date: "2026-04-05"
  tasks_completed: 1
  tasks_total: 2
  files_changed: 1
---

# Phase 17 Plan 01: KB Sidebar Search Summary

## One-liner

KBLinksSection refactored from client-side Popover/Command pattern to React Query with inline FTS5 search, showing linked articles immediately before the search input.

## What Was Built

Rewrote `src/components/KBLinksSection.tsx` to:

1. **Linked articles on mount** (KBSB-03): `useQuery(['ticket-kb-links', ticketId])` fetches already-linked articles immediately — shown in `bg-muted/50 rounded-lg` cards with `BookOpen` icon, title link, category badge, and hover-reveal unlink `X` button.

2. **FTS5 server-side search** (KBSB-01): Inline `Input` with search icon, 300ms debounce via `useRef<ReturnType<typeof setTimeout>>` + `useEffect` (same pattern as `useCommandPaletteSearch`). `useQuery(['kb-search', debouncedSearch])` calls `api.getKbArticles({ search })` with `enabled: debouncedSearch.length >= 2`.

3. **Link from search results** (KBSB-02): Each search result card has a `Link2` icon button that triggers `useMutation(linkKbArticleToTicket)` — invalidates `['ticket-kb-links', ticketId]` — clears search query.

4. **Unlink** via `useMutation(unlinkKbArticleFromTicket)` — invalidates linked articles cache.

5. **FTS5 snippets**: Rendered as raw HTML using React's inner HTML prop — content comes from our own SQLite FTS5 server, single-user system, no XSS risk. Produces `<mark>` highlighted text.

6. Results limited to 8, already-linked IDs filtered client-side before display.

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Refactor KBLinksSection to React Query with FTS5 search | b54557f | src/components/KBLinksSection.tsx |
| 2 | Verify KB sidebar search works end-to-end | PENDING (checkpoint:human-verify) | — |

## Status

**Task 1 complete.** Task 2 is a `checkpoint:human-verify` — awaiting user to verify end-to-end behavior in the running app.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None — all API calls are wired to real endpoints, no hardcoded mock data.

## Self-Check: PASSED

- [x] `src/components/KBLinksSection.tsx` exists and is 192 lines (> min 120)
- [x] Commit `b54557f` exists in git log
- [x] TypeScript compiles clean (no output from `tsc --noEmit`)
- [x] `grep -c "useQuery"` returns 4 (>= 2 required)
- [x] `grep -c "useMutation"` returns 3 (>= 2 required)
- [x] `getKbArticles.*search` found
- [x] `getTicketKbLinks` found
- [x] FTS5 snippet render found
- [x] `debounc` found (debounce logic)
- [x] `ticket-kb-links` found (cache key)
- [x] `ticketId.*ticketTitle` found (props unchanged)
