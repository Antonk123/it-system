---
phase: 16-responsive-animation-polish
plan: "02"
subsystem: frontend-animations
tags: [framer-motion, skeleton-loading, page-transitions, stagger-animations]
dependency_graph:
  requires: [16-01]
  provides: [ANIM-01, ANIM-02]
  affects: [src/App.tsx, src/pages/Dashboard.tsx, src/pages/TicketList.tsx, src/pages/KnowledgeBase.tsx, src/pages/TicketDetail.tsx, src/pages/KBArticleDetail.tsx, src/components/KPICard.tsx]
tech_stack:
  added: [framer-motion AnimatePresence, framer-motion motion.div, staggerChildren variants]
  patterns: [skeleton-to-content crossfade, staggered list reveal, route-keyed AnimatePresence, prefers-reduced-motion guard]
key_files:
  created:
    - src/components/PageTransition.tsx
  modified:
    - src/App.tsx
    - src/pages/TicketList.tsx
    - src/pages/KnowledgeBase.tsx
    - src/pages/TicketDetail.tsx
    - src/pages/KBArticleDetail.tsx
    - src/pages/Dashboard.tsx
    - src/components/KPICard.tsx
decisions:
  - AnimatePresence placed inside AppRoutes (not wrapping it) — useLocation requires BrowserRouter context
  - Routes receives location={location} AND key={location.pathname} — both required for exit animations to fire
  - KPICard animationDelay prop removed entirely — parent Dashboard.tsx motion.div with staggerChildren handles entrance
  - prefersReducedMotion checked with window.matchMedia at module level for performance
  - Skeleton shapes match page layout (mobile/desktop variants for TicketList, grid cards for KB)
metrics:
  duration_seconds: 225
  completed_date: "2026-04-05"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 7
---

# Phase 16 Plan 02: Skeleton Loading States and Framer Motion Animations Summary

Skeleton loading states on all 4 data-fetching pages plus Framer Motion page transitions, staggered list reveals, skeleton-to-content crossfade, and Dashboard KPI entrance upgrade replacing CSS animationDelay.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Skeleton loading states for 4 pages | d756ad6 | TicketList.tsx, KnowledgeBase.tsx, TicketDetail.tsx, KBArticleDetail.tsx |
| 2 | Framer Motion transitions, stagger, Dashboard KPI upgrade | 4694126 | PageTransition.tsx (new), App.tsx, TicketList.tsx, KnowledgeBase.tsx, Dashboard.tsx, KPICard.tsx |

## What Was Built

### Task 1: Skeleton Loading States

**TicketList.tsx** — replaced basic `h-12 w-full` skeleton rows with context-aware shapes:
- Mobile (isMobile=true): 4 card-shaped skeletons matching the mobile card layout (title + status badge row, priority + age row)
- Desktop: 5 row-shaped skeletons with 4 columns (title, status, priority, age)
- `Skeleton` component already imported from plan 01 baseline

**KnowledgeBase.tsx** — replaced 3 raw `animate-pulse` divs with proper `Skeleton` component:
- 6 grid cards matching article card structure (title bar + 2 badge pills)
- Added `Skeleton` import from `@/components/ui/skeleton`

**TicketDetail.tsx** — replaced `Loader2` spinning icon with structured 3-block skeleton:
- Title area (h-8 w-2/3) + 3 badge pills (status, priority, category)
- Body area (h-48 w-full)
- Footer/comments area (h-32 w-full)
- Added `Skeleton` import

**KBArticleDetail.tsx** — replaced 2 inline `animate-pulse` divs with structured skeleton:
- Title (h-8 w-3/4) + meta line (h-5 w-48) + 6 body content lines
- Added `Skeleton` import

### Task 2: Framer Motion Animations

**PageTransition.tsx (new)** — reusable page fade wrapper:
- `initial={{ opacity: 0, y: 8 }}` → `animate={{ opacity: 1, y: 0 }}` → `exit={{ opacity: 0, y: -8 }}`
- 200ms easeOut transition
- Returns `<>{children}</>` passthrough when `prefers-reduced-motion: reduce` is active

**App.tsx** — AnimatePresence wired inside AppRoutes with `useLocation()`:
- `<AnimatePresence mode="wait">` wraps `<Routes location={location} key={location.pathname}>`
- Both `location` prop and `key` are required — without them exit animations silently fail

**TicketList.tsx** — skeleton-to-content crossfade + stagger:
- `<AnimatePresence mode="wait">` switches between `key="skeleton"` and `key="content"` blocks
- Content block: `motion.div` with `listContainer` variants (`staggerChildren: 0.05`)
- Individual items wrapped with `motion.div variants={listItem}` (`opacity: 0 → 1, y: 12 → 0, 250ms`)
- `prefersReducedMotion` guard skips `initial`/`animate` props when active

**KnowledgeBase.tsx** — same pattern as TicketList:
- `<AnimatePresence mode="wait">` switches between skeleton, empty state, and content
- Article cards individually wrapped in `motion.div variants={listItem}`

**Dashboard.tsx** — KPI entrance upgrade:
- Stats Grid: `motion.div variants={kpiContainer} staggerChildren: 0.07 delayChildren: 0.05`
- Each KPICard wrapped in `motion.div variants={kpiItem}` (`y: 10 → 0, opacity: 0 → 1, 220ms`)
- Secondary Stats grid: same stagger pattern
- Dashboard Panels grid: same stagger pattern
- All `animate-fade-in` CSS classes and `animationDelay` inline styles removed

**KPICard.tsx** — cleaned up:
- Removed outer `<div className="animate-fade-in" style={{ animationDelay }}>` wrapper
- Removed `animationDelay` prop from interface and destructuring
- Component now renders `<Card>` directly (entrance handled by parent motion.div)

## Decisions Made

- **AnimatePresence placement**: Inside `AppRoutes` (requires `useLocation` which needs BrowserRouter context). Placing outside BrowserRouter would cause a runtime error.
- **Routes must receive both props**: `location={location}` tells React Router which location to render; `key={location.pathname}` tells AnimatePresence when a new route has mounted so it can trigger the exit animation on the old one.
- **KPICard animationDelay removed**: Replacing CSS delay chains with Framer Motion staggerChildren gives precise, coordinated timing without managing millisecond offsets manually. The `animationDelay` prop is no longer meaningful.
- **prefersReducedMotion at module level**: Checked once on module load rather than per-render — avoids repeated `matchMedia` calls. This is a static preference that only changes if the user changes OS settings (page reload expected).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all animations are fully wired. PageTransition.tsx is created but not yet applied to individual page components (AnimatePresence in App.tsx handles route-level transitions; the PageTransition wrapper is available for page-level entrance if needed in future plans).

## Self-Check: PASSED

Files verified:
- `src/components/PageTransition.tsx` — created, contains `export const PageTransition` and `prefers-reduced-motion` check
- `src/App.tsx` — contains `AnimatePresence`, `useLocation()`, `<Routes location={location} key={location.pathname}>`
- `src/pages/TicketList.tsx` — contains `staggerChildren`, `AnimatePresence`, `Skeleton`
- `src/pages/KnowledgeBase.tsx` — contains `staggerChildren`, `AnimatePresence`, `Skeleton`
- `src/pages/TicketDetail.tsx` — contains `Skeleton` in loading branch
- `src/pages/KBArticleDetail.tsx` — contains `Skeleton` in loading branch
- `src/pages/Dashboard.tsx` — contains `staggerChildren`, no `animate-fade-in` on KPICard wrappers
- `src/components/KPICard.tsx` — no `animate-fade-in` class, no `animationDelay` prop

TypeScript: no errors (`npx tsc --noEmit` clean)
Build: succeeded (`npm run build` completed in 12.49s)
