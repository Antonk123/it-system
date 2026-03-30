# Technology Stack — Dashboard, Search & Polish (v1.4)

**Project:** IT Ticket System
**Milestone scope:** Dashboard overview (aging tickets, reminders, today summary), global Cmd+K command palette (tickets, KB, contacts, navigation, actions), UI polish (dark mode toggle, responsive layout, loading states, micro-interactions)
**Researched:** 2026-03-29
**Overall confidence:** HIGH (package.json verified; existing infrastructure audited directly)

---

## Existing Stack (do not change)

React 18.3.1 + Vite 7 + Express 4.21.2 + better-sqlite3 11.7.0 + TypeScript 5.8.3 + Tiptap 3.20.x + shadcn/Radix UI + Tailwind CSS 3.4.17 + Framer Motion 12.38.0 + recharts 2.15.4.

All new libraries must slot into this stack without replacing anything already installed.

---

## Critical Pre-Research Findings

Direct inspection of the codebase reveals three capabilities already in place that directly affect this milestone:

**1. cmdk is already installed** — `cmdk ^1.1.1` is in `package.json`. No new dependency needed for the command palette primitive. The `shadcn/ui` `<Command>` component wraps cmdk and is the correct integration path.

**2. Dark mode infrastructure already exists** — `src/lib/appearance.ts` implements `applyMode(mode: "light" | "dark")` via CSS class manipulation on `documentElement`. `src/index.css` has both `.dark` and `.light` CSS variable blocks fully defined. `tailwind.config.ts` has `darkMode: ["class"]`. `next-themes ^0.3.0` is already installed. The system defaults to dark and has three named color themes (default/midnight/graphite). The "dark mode" feature for this milestone means wiring the existing toggle UI into a persistent user preference, not building dark mode from scratch.

**3. Framer Motion is already installed** — `framer-motion ^12.38.0` is in `package.json`. Note: the upstream project was renamed to `motion` in 2025 (import from `motion/react`), but `framer-motion` still works and the codebase already uses it. Do NOT migrate to the `motion` package — it would break existing imports without any functional benefit for this milestone.

---

## Feature Coverage Map

| Feature | New Backend Dep | New Frontend Dep | Config/Schema Change |
|---------|----------------|------------------|---------------------|
| Dashboard aging tickets widget | none | none | New `/api/dashboard/summary` SQL endpoint |
| Dashboard reminders widget | none | none | Reuses existing `/api/tickets` with `has_reminder` filter |
| Dashboard "today" summary | none | none | New SQL aggregation on `tickets.created_at` |
| Cmd+K command palette | none | **none** (cmdk already installed) | New `CommandPalette` component |
| Global search (tickets + KB + contacts) | none | none | Reuse existing search endpoints |
| Dark mode toggle (persistent) | none | none | Wire `applyMode` + `saveModeTheme` to Settings UI |
| Responsive layout (mobile/tablet) | none | none | Tailwind responsive classes (`sm:`, `md:`, `lg:`) |
| Skeleton loading states | none | none | shadcn `<Skeleton>` (already in shadcn) |
| Micro-interactions (hover, transitions) | none | none | Framer Motion already installed |
| Staggered list entry animations | none | none | Framer Motion `AnimatePresence` + `staggerChildren` |

**Total new packages: 0**

All features for this milestone are achievable with the existing dependency set.

---

## New Frontend Dependencies

### None Required

Every library needed for this milestone is already installed:

| Capability | Library | Status |
|-----------|---------|--------|
| Command palette primitive | `cmdk ^1.1.1` | Already installed |
| Command palette UI wrapper | `shadcn <Command>` component | Already available via shadcn |
| Dark mode state management | `next-themes ^0.3.0` | Already installed |
| Dark mode CSS | `.dark` / `.light` classes in `index.css` | Already defined |
| Micro-interactions | `framer-motion ^12.38.0` | Already installed |
| Skeleton loading | shadcn `<Skeleton>` component | Already available via shadcn |
| Responsive layout | `tailwindcss ^3.4.17` breakpoints | Already installed |
| Dashboard charts | `recharts ^2.15.4` | Already installed |
| Date calculations | `date-fns ^3.6.0` | Already installed |

**Confidence:** HIGH — verified directly from `package.json`.

---

## New Backend Dependencies

### None Required

Dashboard aggregation queries use `better-sqlite3` (already installed) with standard SQL:

```sql
-- Aging tickets: tickets open > N days, grouped by age bucket
SELECT
  CASE
    WHEN julianday('now') - julianday(created_at) > 30 THEN '30+'
    WHEN julianday('now') - julianday(created_at) > 14 THEN '14-30'
    WHEN julianday('now') - julianday(created_at) > 7  THEN '7-14'
    ELSE '0-7'
  END as age_bucket,
  COUNT(*) as count
FROM tickets
WHERE status NOT IN ('closed', 'resolved')
GROUP BY age_bucket;
```

No external aggregation library needed. `date-fns` on the frontend handles all date formatting.

---

## Integration Points

### Command Palette (Cmd+K)

The `cmdk` library is already installed and used indirectly via shadcn's `<Command>` component (already used in combobox dropdowns throughout the app). The command palette for this milestone requires:

1. A new `<CommandPalette>` component using shadcn's `<CommandDialog>` (wraps `<Command>` in a Radix Dialog)
2. A global `useEffect` keyboard listener in `App.tsx` (or a custom hook) for `Cmd+K` / `Ctrl+K`
3. Search handler functions calling existing API endpoints: `/api/tickets`, `/api/kb/articles`, `/api/contacts`
4. Navigation actions using `react-router-dom`'s `useNavigate` (already installed)

**No new library needed.** `cmdk 1.1.1` is the latest stable version as of 2026-03 (last publish ~1 year ago but stable). The shadcn `<Command>` wrapper is the production-ready integration path used by the existing codebase.

**Confidence:** HIGH — cmdk version confirmed from npm registry search results; shadcn Command component docs verified.

### Dark Mode Toggle

The existing system in `src/lib/appearance.ts` already handles:
- `applyMode(mode)` — adds `.dark` or `.light` class to `documentElement`
- `saveModeTheme(mode)` — persists to `localStorage`
- `getStoredMode()` — reads from `localStorage` with `"dark"` as default

The `AppearanceInitializer` in `App.tsx` already calls `applyMode(getStoredMode())` on mount.

**What's missing for this milestone:** A visible toggle in the UI (Settings page or header). Wire a `<Switch>` or button to `applyMode` + `saveModeTheme`. That's a UI component task, not a new dependency.

**Note on `next-themes`:** Already installed but currently configured as a passthrough wrapper (`ThemeProvider` in `ThemeProvider.tsx` passes all props to `NextThemesProvider` without configuring `attribute`, `themes`, or `storageKey`). The custom `applyMode` system in `appearance.ts` is doing the actual work. These two systems are currently not conflicting — next-themes is dormant. Do NOT replace `appearance.ts` with next-themes; it would require migrating the multi-theme system (default/midnight/graphite) and is out of scope.

**Confidence:** HIGH — verified from direct code inspection.

### Skeleton Loading States

shadcn's `<Skeleton>` component is a zero-dependency shimmer placeholder built with Tailwind `animate-pulse`. It is not yet in the project's `src/components/ui/` directory (it's a shadcn component that must be added via `npx shadcn@latest add skeleton`), but this is a code-generation step, not a new npm dependency.

Usage pattern for dashboard cards:
```tsx
// Loading state
<Skeleton className="h-24 w-full rounded-lg" />

// Loaded state
<KPICard ... />
```

The skeleton automatically respects dark/light mode via CSS variables — no extra configuration.

**Confidence:** HIGH — shadcn Skeleton component docs verified; Tailwind animate-pulse is in existing config.

### Micro-Interactions with Framer Motion

`framer-motion ^12.38.0` is already installed. Patterns to use for this milestone:

**Page/list entry animations:**
```tsx
import { motion, AnimatePresence } from "framer-motion";

// Staggered list items
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: index * 0.05, duration: 0.2 }}
/>
```

**Command palette open/close:**
```tsx
<AnimatePresence>
  {open && (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.15 }}
    />
  )}
</AnimatePresence>
```

**Dashboard widget entrance:**
```tsx
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } }
};
```

**Performance rule:** Animate only `opacity`, `transform` (translate/scale/rotate). Never animate `width`, `height`, `top`, `left`. The existing codebase already follows this pattern (tailwind.config.ts has CSS keyframe animations for `fade-in`, `scale-in`).

**Migration note:** `framer-motion` package is now also available as `motion` (import from `motion/react`). The codebase currently uses `framer-motion` imports. Do NOT migrate — it offers no benefit for this milestone and risks breaking existing animation code.

**Confidence:** HIGH — verified from motion.dev upgrade guide and framer-motion npm page.

### Responsive Layout

No new library needed. Tailwind CSS 3.4 breakpoints are already configured:

| Breakpoint | Min-width | Use case |
|-----------|-----------|---------|
| (none) | 0px | Mobile — base styles, single column |
| `sm:` | 640px | Large mobile / small tablet |
| `md:` | 768px | Tablet — two columns |
| `lg:` | 1024px | Desktop — full sidebar layout |
| `xl:` | 1280px | Wide desktop |

The existing `tailwind.config.ts` has a custom `2xl` screen at `1400px`. The sidebar component is already built with responsive behavior in mind.

**What needs work:** Dashboard cards (`KPICard`) need `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` patterns. The command palette dialog already uses Radix Dialog which is mobile-friendly. The sidebar may need a mobile collapse pattern.

**Confidence:** HIGH — Tailwind v3 docs, existing tailwind.config.ts verified.

### Dashboard Aggregation Endpoint

New backend route `/api/dashboard/summary` returning:
- Aging bucket counts (open tickets grouped by age: 0-7d, 7-14d, 14-30d, 30d+)
- Active reminders count (tickets with `reminder_at` in the next 24h)
- "Today" summary (tickets created today, tickets closed today, open critical count)

Implementation uses `better-sqlite3` synchronous queries — no async driver, no ORM, same pattern as `/api/reports/summary`. Single endpoint, multiple result objects in one JSON response.

**Confidence:** HIGH — same pattern as the existing working `/api/reports/summary` endpoint.

---

## What NOT to Add

| Library | Why Not |
|---------|---------|
| `kbar` | Alternative command palette — rejected; cmdk already installed and is the shadcn-native choice |
| `react-loading-skeleton` | External skeleton library — rejected; shadcn `<Skeleton>` covers all needs with zero new dependencies |
| `@tanstack/react-virtual` | Virtual scrolling for command palette — rejected; command palette lists are short (< 50 items shown at a time); cmdk handles its own filtering |
| `fuse.js` / `minisearch` | Client-side fuzzy search — rejected; command palette searches against the backend API (which has FTS5); no client-side search index needed |
| `motion` (new package) | Framer Motion rename — rejected; `framer-motion` works and migrating breaks existing imports with zero benefit |
| `react-use` | Utility hooks — rejected; project uses custom hooks; `react-use` is heavy for the one or two hooks that would be used |
| `zustand` / `jotai` | State management — rejected; command palette state (`open: boolean`, `query: string`) is local component state; no global state needed |
| `@radix-ui/react-command` | Radix command primitive — not real; shadcn Command component already wraps cmdk which is the correct primitive |
| `react-hotkeys-hook` | Keyboard shortcut management — rejected; a single `useEffect` with a `keydown` listener is sufficient for one shortcut (Cmd+K); this library adds 3KB for one use case |
| `next-themes` (version upgrade) | Already at `^0.3.0`; upgrading to `0.4.x` offers no benefit; the custom `appearance.ts` system does the actual work |
| `dayjs` | Date library — rejected; `date-fns ^3.6.0` already installed |
| `recharts` additions | Already at `^2.15.4`; no new chart types needed for dashboard (KPI cards + optional sparklines use existing `LineChart`) |

---

## Summary: New Dependencies

**Frontend:** 0 new packages

**Backend:** 0 new packages

**shadcn component additions (code generation, not npm installs):**
- `npx shadcn@latest add skeleton` — adds `src/components/ui/skeleton.tsx` (Tailwind-only, no npm dep)
- `npx shadcn@latest add command` — if not already added; verify `src/components/ui/command.tsx` exists

---

## DB Schema Additions

No new tables. The dashboard endpoint queries existing tables:

```sql
-- tickets: status, created_at, priority, reminder_at — all existing columns
-- No new indexes needed at single-user scale
-- The composite index (status, closed_at DESC) from the archive already helps aging queries
```

---

## Sources

- `package.json` — confirmed installed packages (HIGH confidence, direct file read)
- `server/package.json` — confirmed backend packages (HIGH confidence, direct file read)
- `src/lib/appearance.ts` — confirmed existing dark/light mode system (HIGH confidence, direct file read)
- `src/index.css` — confirmed `.dark` and `.light` CSS classes fully defined (HIGH confidence, direct file read)
- `tailwind.config.ts` — confirmed `darkMode: ["class"]` and breakpoints (HIGH confidence, direct file read)
- `src/pages/Dashboard.tsx` — confirmed existing dashboard with `recharts`, `date-fns`, `useTickets` (HIGH confidence, direct file read)
- cmdk npm registry — version 1.1.1 latest stable (MEDIUM confidence, WebSearch)
- next-themes 0.4.6 latest — Vite React compatible (MEDIUM confidence, WebSearch)
- shadcn Command component docs — cmdk integration pattern (HIGH confidence, WebFetch)
- motion.dev upgrade guide — framer-motion → motion/react migration is optional (HIGH confidence, WebSearch)
- Tailwind CSS v3 responsive docs — breakpoint values (HIGH confidence, known stable)
