---
phase: 08-content-quality-toc-templates-staleness
plan: "02"
subsystem: frontend
tags: [kb, toc, templates, navigation, ux]
dependency_graph:
  requires: []
  provides: [toc-on-kb-article-detail, template-picker-on-new-article]
  affects: [src/pages/KBArticleDetail.tsx, src/pages/KBArticleForm.tsx]
tech_stack:
  added: []
  patterns:
    - IntersectionObserver scroll-spy for active ToC heading
    - Post-render DOM mutation to set IDs stripped by DOMPurify
    - useRef pointing to rendered HTML container for heading extraction
key_files:
  created: []
  modified:
    - src/pages/KBArticleDetail.tsx
    - src/pages/KBArticleForm.tsx
decisions:
  - slugify helper normalizes Swedish chars (å→a, ä→a, ö→o) to produce valid anchor IDs
  - IDs injected via el.setAttribute post-render since DOMPurify strips id attributes
  - ToC hidden when fewer than 2 headings to avoid empty sidebar chrome
  - Template picker dismissed (not hidden) after selection to keep form clean
  - Both ToC renderings (mobile + desktop) have print:hidden to avoid duplicate ToC in print
metrics:
  duration_minutes: 2
  completed_date: "2026-03-29T16:06:22Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 08 Plan 02: Table of Contents and Article Templates Summary

**One-liner:** Client-side ToC with scroll-spy anchor links on article detail, plus 3-card Swedish-language template picker on new article form.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Table of Contents on article detail page | 0bbf030 | src/pages/KBArticleDetail.tsx |
| 2 | Article template picker on new article form | d3a73b6 | src/pages/KBArticleForm.tsx |

## What Was Built

### Task 1 — Table of Contents

Added a full ToC implementation to `KBArticleDetail.tsx`:

- `contentRef` (useRef) attached to the article content div — enables post-render DOM queries
- `slugify` helper converts heading text to valid anchor IDs, handling Swedish characters (å/ä→a, ö→o) and deduplicating repeated slugs
- Heading extraction useEffect: runs after `article.content` changes, queries all h1-h6 from rendered DOM, sets `id` attribute on each element (post-sanitization, bypasses DOMPurify's id strip), builds `tocItems` array
- IntersectionObserver scroll-spy useEffect: observes all heading elements, updates `activeId` state to highlight current section in desktop ToC
- Layout restructured from `max-w-3xl` to `max-w-4xl` outer, with header/share/linked-tickets constrained to `max-w-3xl`. Content + ToC sidebar in a flex row.
- Desktop ToC: `aside` with `hidden lg:block w-52`, `sticky top-24`, active heading highlighted via `text-primary font-medium`
- Mobile ToC: `details`/`summary` collapsible, `lg:hidden`, above article content
- Both ToC elements: `print:hidden` class
- Guard: `tocItems.length >= 2` on both mobile and desktop renders

### Task 2 — Article Template Picker

Added to `KBArticleForm.tsx`:

- `ARTICLE_TEMPLATES` const array (outside component) with 3 templates using proper Swedish characters:
  - **Lösning** (id: `solution`): Problem / Orsak / Lösning / Förebyggande structure
  - **Instruktion** (id: `how-to`): Förutsättningar / Steg (ol) / Verifiering structure
  - **Felsökning** (id: `troubleshooting`): Symptom / Diagnos / Åtgärd structure
- `templateDismissed` state (default false) inside component
- Template picker rendered between header and form, guarded by `!isEditing && !templateDismissed`
- Template card click: `setContent(tmpl.body)` fills Tiptap editor (syncs via internal useEffect on value prop), then dismisses picker
- "Hoppa över" button dismisses picker without selecting a template
- Picker not shown for edit routes (isEditing = true)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All template content is fully wired. ToC is generated from real DOM headings.

## Self-Check: PASSED

Files exist:
- FOUND: src/pages/KBArticleDetail.tsx
- FOUND: src/pages/KBArticleForm.tsx

Commits exist:
- FOUND: 0bbf030 (Task 1 - ToC)
- FOUND: d3a73b6 (Task 2 - Templates)
