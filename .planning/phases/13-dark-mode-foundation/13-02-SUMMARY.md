---
phase: 13-dark-mode-foundation
plan: 02
subsystem: ui
tags: [dark-mode, light-mode, react, recharts, layout, toggle, theming]

requires:
  - phase: 13-dark-mode-foundation/13-01
    provides: per-theme light CSS tokens, FOUC prevention, useMode hook with dispatchModeChange

provides:
  - Sun/Moon mode toggle button in both mobile and desktop nav headers
  - Mode-reactive chart remount via key={mode} on all ResponsiveContainer instances in Reports.tsx
  - Daylight theme removed from Settings themeOptions and App.tsx ThemeProvider
  - Daylight migration in AppearanceInitializer for existing users

affects: [13-dark-mode-foundation, Layout.tsx, Reports.tsx, Settings.tsx, App.tsx]

tech-stack:
  added: []
  patterns:
    - "Mode toggle: handleModeToggle calls applyMode + saveModeTheme + dispatchModeChange — single source of truth for toggle state"
    - "Chart reactivity: key={mode} on ResponsiveContainer forces remount on mode change — colors re-read CSS vars on mount"
    - "Daylight migration: AppearanceInitializer checks localStorage at app start, falls back to theme-default"

key-files:
  created: []
  modified:
    - src/components/Layout.tsx
    - src/pages/Reports.tsx
    - src/pages/Settings.tsx
    - src/App.tsx

key-decisions:
  - "Toggle placed in header (not sidebar) — always visible regardless of sidebar collapsed state"
  - "key={mode} on ResponsiveContainer (not parent div) — minimal change, directly targets recharts remount"
  - "Daylight migration runs in AppearanceInitializer useEffect — runs once on app boot, safe for existing users"

patterns-established:
  - "Mode toggle pattern: import getStoredMode for initial state, call applyMode+saveModeTheme+dispatchModeChange in handler"
  - "Chart mode reactivity: add key={mode} from useMode() to ResponsiveContainer — no other changes needed"

requirements-completed: [THEME-02, THEME-03]

duration: ~15min
completed: 2026-03-31
---

# Phase 13 Plan 02: Dark Mode Foundation — Nav Toggle, Chart Reactivity, Daylight Removal

**Sun/Moon toggle wired into both headers via handleModeToggle, recharts remount on mode switch via key={mode}, and Daylight theme fully removed from Settings picker and ThemeProvider config**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-31T05:10:00Z
- **Completed:** 2026-03-31T05:25:00Z
- **Tasks:** 2 code tasks + 1 human-verify checkpoint (pending)
- **Files modified:** 4

## Accomplishments

- Added Sun/Moon toggle button to both mobile and desktop nav headers — imports `dispatchModeChange` from Plan 01's useMode.ts, calls `applyMode + saveModeTheme + dispatchModeChange` on click
- Added `key={mode}` to all 4 `ResponsiveContainer` instances in Reports.tsx so recharts remounts and re-reads CSS variables on mode toggle (no page reload needed)
- Removed `theme-daylight` from `themeOptions` in Settings.tsx (4 themes remain: Slate, Midnight, Graphite, Stone)
- Removed `theme-daylight` from ThemeProvider `themes` prop in App.tsx
- Added Daylight migration in `AppearanceInitializer` — users who had daylight stored fall back to `theme-default` on next app load

## Task Commits

1. **Task 1: Add sun/moon mode toggle to Layout.tsx header** - `da283d9` (feat)
2. **Task 2: Mode-keyed chart remount, remove Daylight from pickers and config** - `49d5c98` (feat)

## Files Created/Modified

- `src/components/Layout.tsx` — Added Sun/Moon imports, mode state, handleModeToggle, toggle Button in mobile + desktop headers
- `src/pages/Reports.tsx` — Added useMode import, `const mode = useMode()`, `key={mode}` on 4 ResponsiveContainers
- `src/pages/Settings.tsx` — Removed `{ value: 'theme-daylight', label: 'Daylight' }` from themeOptions
- `src/App.tsx` — Removed `"theme-daylight"` from ThemeProvider themes, added Daylight migration in AppearanceInitializer

## Decisions Made

- Toggle placed in nav header (not sidebar) — always visible regardless of desktop sidebar collapsed state or mobile sidebar closed state
- `key={mode}` added directly to `<ResponsiveContainer>` (not a wrapper div) — minimal change, correct React remount target for recharts
- Daylight migration uses `localStorage.getItem('theme')` directly (not next-themes API) — consistent with how applyMode works in appearance.ts

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- worktree was created before Plan 01 ran — merged `main` into the worktree to get useMode.ts and the CSS tokens. Not a code issue; standard parallel-agent worktree setup.

## Known Stubs

None.

## Next Phase Readiness

- Complete dark mode foundation is in place: CSS tokens (Plan 01) + toggle wire + chart reactivity + Daylight removal (Plan 02)
- Awaiting Task 3 human verification checkpoint to confirm visual correctness across all 4 themes in both modes
- Phase 14 (dashboard panels) can proceed once checkpoint approved

---
*Phase: 13-dark-mode-foundation*
*Completed: 2026-03-31*
