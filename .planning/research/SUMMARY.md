# Project Research Summary

**Project:** IT Ticket System — Dashboard, Search & Polish (v1.4)
**Domain:** Internal single-user IT helpdesk — React + shadcn + Framer Motion stack
**Researched:** 2026-03-29
**Confidence:** HIGH

---

## Executive Summary

This milestone (v1.4) is a polish and productivity sprint on a mature internal IT ticket system. The core product works; the goal is to make it feel professional — a real dashboard with aging visibility and daily rhythm data, a proper command palette replacing an inline search dropdown, a complete light/dark mode toggle, and responsive polish. All of these are achievable without adding a single npm package. Every library required (cmdk, Framer Motion, next-themes, recharts, date-fns, Tailwind breakpoints, shadcn Skeleton) is already installed and verified in package.json.

The recommended approach is to build in four loosely coupled phases with hard ordering constraints: dark mode CSS completeness first (purely additive, zero regression risk), dashboard overview second (new backend endpoint plus parallel client hooks), command palette refactor third (most complex, refactors existing GlobalSearch logic), and responsive plus loading polish last (depends on final component shapes). The architecture is well-understood from direct codebase inspection — no architectural guesswork is needed.

The two highest-consequence risks are: (1) the `.light` CSS variable block in `index.css` is incomplete and will produce broken light-mode UI unless the full token set is audited and patched before the toggle is exposed; and (2) the dashboard's existing `useTickets({ limit: 1000 })` client-side aggregation must not be extended to power aging/reminders — a dedicated `/api/tickets/dashboard-overview` SQL endpoint is required to avoid unbounded fetch growth and silently incorrect counts. Both risks have known solutions fully specified in the research.

---

## Key Findings

### Recommended Stack

Zero new npm dependencies. The entire milestone is buildable with the existing stack: cmdk 1.1.1 (already installed) for the command palette primitive via shadcn's `CommandDialog`, Framer Motion 12.38.0 (already installed) for animations, recharts 2.15.4 for dashboard charts, date-fns 3.6.0 for date formatting, Tailwind CSS 3.4 breakpoints for responsive layout, and shadcn's `Skeleton` component (added via `npx shadcn@latest add skeleton` — a code generation step, not an npm install). This is verified directly from package.json, not assumed.

**Core technologies:**
- `cmdk ^1.1.1` + shadcn `CommandDialog`: command palette modal — already installed; `CommandDialog` already exists in `src/components/ui/command.tsx` but is currently unused
- `framer-motion ^12.38.0`: micro-interactions and stagger animations — already installed but underused; CSS keyframe animations handle most existing cases; Framer Motion reserved for gestures and exit animations
- `better-sqlite3 11.7.0`: new `/api/tickets/dashboard-overview` endpoint — same synchronous SQL pattern as the existing `/api/reports/summary` endpoint
- `next-themes ^0.3.0`: already installed but dormant; custom `applyMode()` in `appearance.ts` is the active dark mode driver — do NOT activate next-themes as the class driver alongside it
- Tailwind CSS 3.4 breakpoints (`sm:` 640px, `md:` 768px, `lg:` 1024px): responsive layout fixes — no config changes needed

**shadcn code-generation steps (not npm installs):**
- `npx shadcn@latest add skeleton` — adds `src/components/ui/skeleton.tsx`
- Verify `src/components/ui/command.tsx` exists (it does — CommandDialog is confirmed present)

### Expected Features

**Must have (table stakes):**
- Aging tickets panel on dashboard — open tickets without recent updates are invisible in the current stats grid; standard in all mature helpdesks
- "Today at a glance" summary — daily created/closed/resolved counts; every helpdesk dashboard surfaces this
- Reminders widget on dashboard — `ticket_reminders` table exists with data; dashboard is the natural home for upcoming reminders
- Command palette as modal (Cmd+K) — current GlobalSearch is an inline dropdown; modal overlay is the established UX pattern (Linear, Notion, GitHub); KB articles must be included in results
- Navigation shortcuts in palette — zero-effort to add, trains muscle memory, expected in any command palette
- Dark mode toggle in nav header — currently buried in Settings; one-click toggle is the norm in polished tools
- Light mode fully styled — `.light` CSS class exists but token coverage is incomplete; light mode must actually work across all components
- Loading skeleton screens — blank states during load feel like bugs; skeletons communicate loading clearly

**Should have (differentiators):**
- Staggered page-load animations on dashboard KPI cards — Framer Motion is already installed; one well-done stagger beats scattered micro-interactions
- Toast and hover micro-interactions — `whileTap`/`whileHover` on key interactive elements; high polish-to-effort ratio
- Responsive mobile layout — bottom nav plus sidebar drawer on mobile < 768px; vaul is already installed
- Keyboard shortcut hints — `<kbd>` elements on search bar and empty states; visible shortcut education
- Dark mode action accessible from Cmd+K — "Toggle light/dark mode" action in the palette idle state

**Defer to v2+:**
- Cmd+K ticket actions (clone, mark resolved) — requires two-step selection UX; complex for a single-user tool
- Responsive Kanban for mobile — medium complexity, low usage frequency on mobile
- AI summaries, real-time push, PWA offline — explicitly out of scope per PROJECT.md

### Architecture Approach

The existing architecture is component-per-page with React Query hooks per data source and an `ApiClient` class in `src/lib/api.ts`. No global state management beyond localStorage and React Query cache. For v1.4 the approach is strictly additive: a new `useDashboardOverview` hook calling a new dedicated backend endpoint, a new `CommandPalette` component replacing `GlobalSearch`, CSS variable additions to `index.css`, and Tailwind responsive classes on existing layout components. No architectural pattern changes are needed.

**Major components and changes:**
1. `GET /api/tickets/dashboard-overview` (NEW backend route) — single SQL endpoint returning aging tickets, upcoming reminders, and today-summary counts; must be placed above the `/:id` route in `tickets.ts` to avoid ID match conflict
2. `useDashboardOverview.ts` (NEW hook) + `AgingTicketsPanel`, `UpcomingRemindersPanel`, `TodaySummaryPanel` (NEW components) — mount in `Dashboard.tsx` alongside existing KPI grid; 5-minute React Query stale time
3. `CommandPalette.tsx` (NEW component using `CommandDialog`) — replaces inline `GlobalSearch` dropdown; mounts in `Layout.tsx`; searches tickets + KB articles in parallel with a shared 250ms debounce timer
4. `index.css` `.light` block (MODIFIED) — complete all missing CSS variable tokens (`--primary`, `--primary-foreground`, `--accent`, `--ring`, `--sidebar-primary`, `--background-gradient`, etc.)
5. `Layout.tsx` (MODIFIED) — dark mode toggle button in `BottomSection`, command palette trigger replaces GlobalSearch render
6. `index.html` (MODIFIED) — blocking `<script>` before the React bundle applies the stored mode class synchronously to prevent FOUC

### Critical Pitfalls

1. **Incomplete `.light` CSS token block** — the `.light` override in `index.css` covers only ~12 of 40+ variables. Primary buttons, sidebar active states, and the `body::before` gradient will look broken in light mode. Audit and complete ALL tokens before building the toggle UI — this is a prerequisite, not a follow-up.

2. **Dark mode system conflict (`applyMode` vs `next-themes`)** — both systems are present in the codebase. If `next-themes` is activated with `attribute="class"`, it fights with `AppearanceInitializer` over `document.documentElement.classList`, causing FOUC and toggle reversion. Use `applyMode`/`saveModeTheme` from `appearance.ts` exclusively; keep `next-themes` dormant.

3. **Dashboard 1000-ticket client-side aggregation must not be extended** — `useTickets({ limit: 1000 })` grows unboundedly with ticket count. Aging tickets computed client-side will silently miss tickets beyond position 1000. All new dashboard aggregations must go through the dedicated `/api/tickets/dashboard-overview` SQL endpoint.

4. **Command palette double-listener leak** — registering `document.addEventListener('keydown', ...)` inside a component that could remount causes double-fire (palette opens then immediately closes). Register once at `App.tsx` level with proper `useEffect` cleanup. Always call `e.preventDefault()` to block Firefox address bar focus on Ctrl+K.

5. **Framer Motion `layout` prop on dashboard cards causes layout thrash** — `layout`/`layoutId` triggers FLIP measurement on every data update; combined with recharts SVG redraws this will produce visible jank. Use `initial`/`animate` (opacity + transform only) for entrance animations; never use the `layout` prop on KPICard or stat panels.

---

## Implications for Roadmap

The dependency graph from combined research strongly suggests four phases. The ordering is driven by: (1) CSS-only dark mode work has zero breaking-change risk and should be verified before React features land on top of it; (2) dashboard panels are self-contained and validate the new backend SQL endpoint pattern with lower complexity than the search refactor; (3) command palette refactors existing GlobalSearch functionality and should come after dashboard to avoid dual disruption; (4) responsive and loading polish requires all final component shapes to be in place.

### Phase 1: Dark Mode Foundation

**Rationale:** Purely additive CSS changes with zero regression risk. Validates the theming system before any React code changes land. If dark mode CSS is incomplete when React code arrives, every subsequent feature will have light-mode rendering bugs that are expensive to debug retroactively.

**Delivers:** Working light mode across all existing components; dark mode toggle button in nav header (`BottomSection` in `Layout.tsx`); blocking `<script>` in `index.html` to prevent FOUC; `prose-invert` fixed in `HtmlRenderer`; recharts chart colors responsive to mode switch via `getComputedStyle` or mode-keyed remount.

**Addresses features:** Light mode fully styled, dark mode toggle in nav header, dark mode accessible from Cmd+K (toggle action added to palette in Phase 3).

**Avoids pitfalls:** Incomplete `.light` token block (Pitfall 2), dual mode system conflict (Pitfall 1), FOUC on hard reload (Pitfall 8), `HtmlRenderer` `prose-invert` hardcode (Pitfall 10), recharts colors frozen at mount (Pitfall 13), `body::before` gradient wrong in light mode (Pitfall 16).

---

### Phase 2: Dashboard Overview

**Rationale:** Self-contained feature — new backend endpoint plus new frontend panels. No cross-dependencies with CommandPalette or Layout restructuring. Validates the dedicated SQL aggregation pattern that pitfalls research strongly recommends over extending the existing 1000-ticket client fetch.

**Delivers:** Aging tickets panel, upcoming reminders panel, "today at a glance" summary row; new `GET /api/tickets/dashboard-overview` backend route; `useDashboardOverview` hook; skeleton loading states on all new panels.

**Addresses features:** Aging tickets, reminders widget, today summary, loading skeletons (new panels).

**Avoids pitfalls:** 1000-ticket client-side aggregation growth (Pitfall 3), aging count missing tickets beyond limit (Pitfall 15), dashboard fetch waterfall (Pitfall 3).

**Uses:** `better-sqlite3` synchronous SQL (same pattern as existing `/api/reports/summary`), React Query parallel hooks, shadcn `Skeleton` component.

---

### Phase 3: Command Palette Refactor

**Rationale:** Most complex change — refactors existing `GlobalSearch` functionality into `CommandPalette` using the already-present `CommandDialog`. Deliberately last among feature phases so GlobalSearch continues working undisturbed during Phases 1 and 2. KB article search and navigation shortcuts are bundled here since they require the modal to exist first.

**Delivers:** Full command palette modal (Cmd+K) with tickets + KB articles + contacts + navigation shortcuts; retired inline GlobalSearch dropdown; updated `Layout.tsx` header with palette trigger; parallel debounced search with a shared 250ms timer; dark mode toggle action in palette idle state.

**Addresses features:** Command palette as modal, KB articles in Cmd+K, navigation shortcuts, dark mode action in palette, keyboard shortcut hints.

**Avoids pitfalls:** Double-listener leak (Pitfall 4), multi-source search race conditions (Pitfall 5), navigation timing conflict with close animation (Pitfall 9), input losing focus on results update (Pitfall 14).

**Implements:** `CommandPalette.tsx` using `CommandDialog` from `ui/command.tsx`; `api.getKbArticles()` already present in `api.ts`; `useNavigate` from react-router-dom already installed.

---

### Phase 4: Responsive and Animation Polish

**Rationale:** Polish work that depends on all feature components being in their final shape. Responsive audit touches `TicketList`, `KBArticleDetail`, `Reports`, and the new dashboard panels — all of which must be final before the audit. Animation additions (stagger on KPI grid, micro-interactions) are additive overlays with no dependencies beyond Framer Motion.

**Delivers:** Mobile-responsive layout (bottom nav + sidebar drawer at < 768px); `TicketTable` mobile overflow fixes; KBArticleDetail single-column on mobile; staggered page-load animations on dashboard KPI grid; `whileTap`/`whileHover` micro-interactions on key interactive elements; comprehensive skeleton screens across Dashboard, TicketList, and KB list.

**Addresses features:** Responsive mobile layout, stagger animations, toast micro-interactions, full loading state coverage, keyboard shortcut hint badges.

**Avoids pitfalls:** Responsive sidebar clipping from `overflow-hidden` ancestor (Pitfall 6), `layout` prop layout thrash (Pitfall 7), sidebar collapsed state lost across navigation (Pitfall 11), bespoke skeleton shimmer per component instead of using `ui/skeleton.tsx` (Pitfall 12).

---

### Phase Ordering Rationale

- CSS-only dark mode work first eliminates the largest cross-cutting concern before feature code lands on top of it
- Dashboard panels and command palette have no dependencies on each other; dashboard goes first because it introduces the new backend endpoint pattern with lower complexity than the GlobalSearch refactor
- Responsive polish last because it requires knowing the final shape of all new components (dashboard panels, command palette trigger in Layout header)
- All four phases are buildable without new npm dependencies — verified from direct package.json inspection

### Research Flags

All phases have well-documented patterns from direct codebase inspection. No phase requires `/gsd:research-phase`.

- **Phase 1 (Dark Mode):** All implementation details fully specified in ARCHITECTURE.md and PITFALLS.md. Token list to add is enumerated in Pitfall 2. Blocking script is a 5-line snippet in Pitfall 8.
- **Phase 2 (Dashboard):** SQL queries written in full in ARCHITECTURE.md. Component boundaries fully mapped. Hook pattern mirrors existing `useTickets`.
- **Phase 3 (CommandPalette):** `CommandDialog` already exists in `ui/command.tsx`. Data flow fully specified in ARCHITECTURE.md. `api.getKbArticles` confirmed present in `api.ts`.
- **Phase 4 (Polish):** Tailwind breakpoints and Framer Motion patterns are well-established. Responsive fixes are audit-and-patch, not design decisions.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified directly from package.json and server/package.json — zero ambiguity; 0 new packages required |
| Features | HIGH | Direct codebase read of GlobalSearch, Dashboard, Layout, Settings; domain patterns from Freshdesk/Zendesk/Linear/Notion/GitHub well-established |
| Architecture | HIGH | Direct analysis of all affected source files; component boundaries, data flow, and SQL queries fully specified — no inference required |
| Pitfalls | HIGH (codebase-specific) / MEDIUM (pattern-based) | CSS token gaps and dual-mode conflict verified by direct code inspection; Framer Motion layout thrash and command palette listener leak are pattern-based warnings not yet triggered in this codebase |

**Overall confidence:** HIGH

### Gaps to Address

- **Reminders API endpoint:** FEATURES.md notes the `/api/reminders` endpoint needs verification ("verify endpoint exists"). During Phase 2 implementation, confirm whether `GET /api/reminders` is a live route in `server/src/routes/`. If absent, the reminders panel requires a new backend route — low effort, same SQL pattern as the aging query, but must not be assumed to exist.

- **Recharts color update on mode switch:** PITFALLS.md recommends either reading CSS variables via `getComputedStyle` on mode change or keying charts on mode string for forced remount. The correct approach should be tested empirically during Phase 1 since recharts version-specific behavior on CSS variable updates is not fully verified.

- **Responsive breakpoint specifics:** FEATURES.md rates responsive layout confidence as MEDIUM — "actual breakpoint behavior requires live browser testing." The architectural plan is correct but specific column-hiding and overflow decisions may need adjustment after testing at 375px viewport width.

---

## Sources

### Primary (HIGH confidence)
- `package.json`, `server/package.json` — installed package versions, confirmed zero new dependencies needed
- `src/lib/appearance.ts`, `src/index.css` — dark mode system architecture and CSS variable coverage gaps
- `src/components/GlobalSearch.tsx`, `src/components/ui/command.tsx` — command palette refactor targets; CommandDialog confirmed present but unused
- `src/pages/Dashboard.tsx`, `src/components/KPICard.tsx` — existing dashboard data flow and 1000-ticket fetch anti-pattern
- `src/components/Layout.tsx`, `src/components/ThemeProvider.tsx`, `src/App.tsx` — mount points and AppearanceInitializer
- `server/src/routes/tickets.ts`, `server/src/routes/reports.ts` — existing backend route patterns
- `server/src/db/connection.ts` — ticket_reminders schema confirmed
- `src/lib/api.ts` — getKbArticles method confirmed present
- `tailwind.config.ts` — darkMode: ["class"] strategy, breakpoints, custom screens confirmed

### Secondary (MEDIUM confidence)
- shadcn/ui Command component docs — CommandDialog integration pattern
- cmdk npm registry — version 1.1.1 latest stable
- motion.dev upgrade guide — framer-motion to motion/react migration is optional (do not migrate)
- Helpdesk dashboard patterns (Freshdesk, Zendesk, ManageEngine) — aging and today-summary feature set validation
- BrowserStack 2025 breakpoint guide — responsive breakpoint values

### Tertiary (LOW confidence)
- None — all implementation decisions are grounded in direct codebase inspection or HIGH/MEDIUM sources

---
*Research completed: 2026-03-29*
*Ready for roadmap: yes*
