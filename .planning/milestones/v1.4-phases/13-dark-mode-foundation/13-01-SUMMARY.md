---
phase: 13-dark-mode-foundation
plan: 01
subsystem: ui
tags: [css, theming, dark-mode, light-mode, fouc, react-hooks]

requires:
  - phase: 12-quick-capture
    provides: stable baseline codebase

provides:
  - 4 per-theme light CSS token sets (.light .theme-default/midnight/graphite/stone)
  - FOUC prevention blocking script in index.html head
  - useMode reactive hook (useMode, dispatchModeChange, MODE_CHANGE_EVENT)

affects: [13-dark-mode-foundation/13-02, Layout.tsx, Reports.tsx, Settings.tsx]

tech-stack:
  added: []
  patterns:
    - "Per-theme light variants: .light .theme-X compound selectors (specificity 0,2,0)"
    - "FOUC prevention: blocking IIFE in <head> reads localStorage before React hydrates"
    - "Mode reactivity: CustomEvent for same-tab, StorageEvent for cross-tab in useMode hook"

key-files:
  created:
    - src/hooks/useMode.ts
  modified:
    - src/index.css
    - index.html

key-decisions:
  - "Per-theme light blocks use .light .theme-X compound selectors (0,2,0 specificity) to beat standalone .theme-X (0,1,0)"
  - "FOUC script also restores font class to prevent font flash on reload"
  - "dispatchModeChange helper exported from useMode.ts for toggle wiring in Plan 02"

patterns-established:
  - "Light mode specificity: .light .theme-X must be used, not plain .light, to preserve per-theme accent colors"
  - "FOUC prevention: IIFE in <head> with try/catch, defaults to 'dark' on no stored value"

requirements-completed: [THEME-01, THEME-03]

duration: 12min
completed: 2026-03-31
---

# Phase 13 Plan 01: Dark Mode Foundation — CSS Tokens + FOUC + useMode Hook

**4 complete per-theme light token sets in index.css with full coverage (primary, accent, ring, sidebar, chart, shadows, search-glow), FOUC-blocking script in index.html, and reactive useMode hook**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-31T04:50:00Z
- **Completed:** 2026-03-31T05:01:58Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Replaced incomplete generic `.light {}` block and `.theme-daylight {}` with 4 compound `.light .theme-X` selectors — each with complete token coverage including the previously missing `--primary`, `--accent`, `--ring`, `--radius`, `--background-gradient`, all `--sidebar-*`, `--search-glow-*`, and `--success` tokens
- Added blocking IIFE script in `<head>` of index.html that reads `localStorage` and applies mode + font class to `<html>` before React hydrates — eliminates FOUC entirely
- Created `src/hooks/useMode.ts` with `useMode()` reactive hook, `dispatchModeChange()` helper, and `MODE_CHANGE_EVENT` constant ready for toggle wiring in Plan 02

## Task Commits

1. **Task 1: Create per-theme light token sets and remove daylight theme** - `d44ad68` (feat)
2. **Task 2: Add FOUC prevention script and create useMode hook** - `03f69c1` (feat)

## Files Created/Modified

- `src/index.css` - Replaced `.theme-daylight {}` + generic `.light {}` with 4 complete `.light .theme-{default,midnight,graphite,stone}` blocks
- `index.html` - Added FOUC-prevention blocking `<script>` in `<head>` before `</head>`
- `src/hooks/useMode.ts` - New reactive mode hook with CustomEvent + StorageEvent listeners

## Decisions Made

- Per-theme light blocks use compound selector `.light .theme-X` (specificity 0,2,0) — this is required to beat standalone `.theme-X` (0,1,0) selectors so theme-specific accents are preserved in light mode
- FOUC script also includes font restoration (`app-font-theme`) — 2-line addition that prevents font flash too with zero risk
- `dispatchModeChange` exported from useMode.ts so Plan 02's toggle can use it without re-implementing event dispatch

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan delivers pure CSS tokens and a utility hook; no UI stubs or placeholders.

## Self-Check: PASSED

- `src/index.css` — `.light .theme-default`, `.light .theme-midnight`, `.light .theme-graphite`, `.light .theme-stone` all present (verified: 1 each)
- `src/index.css` — `.theme-daylight` absent (verified: 0 matches)
- `src/index.css` — standalone `.light {` absent (verified: 0 matches)
- `index.html` — `app-mode-theme` present in blocking script (verified: 1 match)
- `src/hooks/useMode.ts` — exists, exports `useMode`, `dispatchModeChange`, `MODE_CHANGE_EVENT`
- TypeScript: `npx tsc --noEmit` passed with no errors
- Commits: `d44ad68` and `03f69c1` both present in git log

---
*Phase: 13-dark-mode-foundation*
*Completed: 2026-03-31*
