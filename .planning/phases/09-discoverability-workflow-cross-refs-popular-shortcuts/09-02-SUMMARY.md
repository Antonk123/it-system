---
phase: 09-discoverability-workflow-cross-refs-popular-shortcuts
plan: "02"
subsystem: frontend
tags: [knowledge-base, cross-references, popular-articles, keyboard-shortcuts, workflow]
dependency_graph:
  requires: [09-01]
  provides: [KB-popular-section, KB-cross-ref-panel, KB-link-picker, KB-slash-shortcut, KB-ticket-workflow]
  affects: [src/pages/KnowledgeBase.tsx, src/pages/KBArticleDetail.tsx, src/pages/KBArticleForm.tsx, src/components/KBLinksSection.tsx, src/pages/TicketDetail.tsx]
tech_stack:
  added: []
  patterns: [useRef keyboard shortcut, Command+Popover link picker, useSearchParams lazy init, useMemo computed views]
key_files:
  created: []
  modified:
    - src/pages/KnowledgeBase.tsx
    - src/pages/KBArticleDetail.tsx
    - src/pages/KBArticleForm.tsx
    - src/components/KBLinksSection.tsx
    - src/pages/TicketDetail.tsx
decisions:
  - "Popular articles filter includes a.status === 'published' guard per D-05 plan-checker warning"
  - "Template picker auto-dismissed when query params present to avoid overwriting pre-filled content"
  - "Slash keyboard shortcut suppresses in input/textarea/contenteditable for Tiptap compatibility"
  - "Link picker shows only published articles and excludes self and already-linked articles"
metrics:
  duration: "~25 minutes"
  completed: "2026-03-29"
  tasks: 3
  files_modified: 5
---

# Phase 09 Plan 02: KB Frontend Features Summary

**One-liner:** Popular articles by view_count, Se även bidirectional cross-refs, Command+Popover link picker, / keyboard shortcut, and ticket-to-KB creation workflow with query param pre-fill and auto-linking.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Popular articles section and / keyboard shortcut | d07e851 | src/pages/KnowledgeBase.tsx |
| 2 | Se aven panel on article detail and link picker on edit form | bb10d24 | src/pages/KBArticleDetail.tsx, src/pages/KBArticleForm.tsx |
| 3 | Ticket-to-KB creation button and query param pre-fill | 734a37c | src/components/KBLinksSection.tsx, src/pages/TicketDetail.tsx |

## Features Delivered

### KB Home Page
- **Populara artiklar section**: Top 5 published articles sorted by `view_count desc`, rendered with same card pattern as Senast uppdaterade, hidden when filters active or no articles have views
- **/ keyboard shortcut**: Pressing `/` focuses the search input; suppressed inside `input`, `textarea`, and `contenteditable` elements (Tiptap compatibility)
- **kbd hint**: Visual `/` indicator inside search input to signal the shortcut

### KB Article Detail
- **Se aven panel**: Fetches bidirectional cross-refs via `api.getKbArticleLinks(id)`, renders as clickable `<Link>` elements with article title and type badge; placed before the Lankade biljetter panel; hidden when no cross-refs exist

### KB Article Edit Form
- **Command+Popover link picker**: Available only in edit mode (`isEditing`); searches across published articles, excludes self and already-linked articles, calls `addKbArticleLink`/`removeKbArticleLink` with immediate state updates
- **Query param pre-fill**: `useSearchParams` reads `title`, `article_type`, `ticket_id` from URL; state initialized lazily so pre-fill takes effect correctly
- **Auto-dismiss template picker**: When query params are present, template picker is auto-dismissed to avoid overwriting pre-filled data
- **Auto-link on creation**: After `createKbArticle`, if `ticket_id` param present, calls `api.linkKbArticleToTicket(sourceTicketId, created.id)` (non-fatal on error)

### Ticket Detail
- **Skapa KB-artikel button**: In KBLinksSection header area; navigates to `/kb/new?title=<encoded title>&article_type=solution&ticket_id=<ticketId>`; receives `ticketTitle` prop from TicketDetail

## Deviations from Plan

### Auto-fixed Issues

None.

### D-05 Guard Applied

**D-05 (plan-checker note):** Added `.filter(a => a.status === 'published')` to `popularArticles` useMemo as a defensive guard to exclude drafts from the popular section, per the important note in execution context.

## Known Stubs

None — all features are fully wired to live API data.

## Verification

- Build: `npx vite build` succeeded, 0 TypeScript errors, 3614 modules transformed
- All acceptance criteria verified via grep
- All 3 tasks committed individually with descriptive messages

## Self-Check: PASSED

Files confirmed present:
- src/pages/KnowledgeBase.tsx — FOUND (popularArticles, searchInputRef, handleKeyDown, Populara artiklar)
- src/pages/KBArticleDetail.tsx — FOUND (crossRefs, getKbArticleLinks, Se aven panel)
- src/pages/KBArticleForm.tsx — FOUND (crossRefs, useSearchParams, linkPickerOpen, sourceTicketId, addKbArticleLink)
- src/components/KBLinksSection.tsx — FOUND (ticketTitle, Skapa KB-artikel, navigate)
- src/pages/TicketDetail.tsx — FOUND (ticketTitle={ticket.title})

Commits confirmed:
- d07e851 — FOUND
- bb10d24 — FOUND
- 734a37c — FOUND
