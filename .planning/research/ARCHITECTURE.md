# Architecture Patterns

**Domain:** IT Ticket System — v1.4 Dashboard, Search & Polish
**Researched:** 2026-03-29
**Confidence:** HIGH (direct codebase analysis)

---

## Existing Architecture Baseline

Before mapping new features, what currently exists matters because every change must slot into established patterns.

### Frontend Structure

```
src/
  pages/
    Dashboard.tsx          — KPI cards, sparklines, critical ticket alert
    TicketList.tsx         — paginated list, UnifiedFilterBar, kanban/list toggle
    Archive.tsx            — closed tickets, same filter parity
    Reports.tsx            — recharts analytics, 4-tab layout
    KnowledgeBase.tsx      — KB article list, category manager
    KBArticleDetail.tsx    — article detail, ToC, linked tickets, Se även
    ...
  components/
    Layout.tsx             — sidebar, mobile header, desktop header w/ GlobalSearch
    GlobalSearch.tsx       — Command palette embedded in header (inline dropdown)
    KPICard.tsx            — metric card with AnimatedNumber + SparklineChart
    ThemeProvider.tsx      — wraps next-themes NextThemesProvider
    QuickCaptureFAB.tsx    — floating action button, sidebar-aware positioning
    ...
  lib/
    api.ts                 — ApiClient class, fetch-based, CSRF, JWT, all methods
    appearance.ts          — font theme + light/dark mode utilities (localStorage)
  hooks/
    useTickets.ts          — tickets query hook
    useTicketReminders.ts  — reminder CRUD per ticket
    useFilterViews.ts      — saved filter views (localStorage-backed)
    ...
  index.css                — CSS custom properties per theme (.theme-default, .theme-midnight etc.)
                             plus .dark and .light mode variable sets
  App.tsx                  — ThemeProvider wraps all routes, AppearanceInitializer runs at mount
```

### Theme and Dark Mode — Current State

The system has **two orthogonal theme axes already in place:**

1. **Color theme** — 5 themes (`.theme-default`, `.theme-midnight`, `.theme-graphite`, `.theme-stone`, `.theme-daylight`), managed via `next-themes` `ThemeProvider` in App.tsx. Each theme defines full HSL CSS variable sets in `index.css`.

2. **Light/Dark mode** — `.dark` and `.light` CSS classes in `index.css`, applied via `applyMode()` in `appearance.ts` to `document.documentElement`. Stored in `localStorage`. Applied at mount via `AppearanceInitializer` in `App.tsx`.

**Critical gap for v1.4:** The `.dark` and `.light` CSS variable sets in `index.css` are incomplete. They only override a subset of variables (background, foreground, card, sidebar basics), not the full theme palette. The 5 named themes (`.theme-default` etc.) are dark-coded by default. A proper light mode requires either completing the `.light` overrides or creating paired light variants of each theme. The existing `applyMode()` plumbing is already wired — only the CSS variable completeness is missing.

**No `dark:` Tailwind variant is used structurally** (only 32 occurrences, concentrated in `ImportDialog.tsx` and `HtmlRenderer.tsx`). The design system uses CSS custom properties exclusively — this is the correct pattern to continue.

### Global Search — Current State

`GlobalSearch.tsx` is an **inline dropdown component** embedded in `Layout.tsx` (both mobile header and desktop header positions). It:
- Opens on Ctrl+K / Cmd+K keyboard shortcut
- Renders a custom Command dropdown using `cmdk` primitives (`CommandList`, `CommandGroup`, `CommandItem`, `CommandSeparator` from `src/components/ui/command.tsx`)
- Searches tickets via `GET /api/tickets?search=&status=all` with 250ms debounce
- Shows quick actions, recent tickets (localStorage), popular tags, popular categories when idle
- Searches users client-side from passed `users` prop
- Does NOT search KB articles

**`CommandDialog` component exists** in `src/components/ui/command.tsx` (wraps `@radix-ui/react-dialog` + `Command`) but is NOT currently used — `GlobalSearch.tsx` implements its own dropdown manually.

### Dashboard — Current State

`Dashboard.tsx` fetches `useTickets({ limit: 1000, status: 'all' })` and derives:
- Status counts (open, in-progress, waiting, resolved, closed)
- 7-day trend percentages (client-side calculation from ticket timestamps)
- Sparkline data (client-side, last 7 days by day)
- Critical ticket count and list

Uses `KPICard` with `AnimatedNumber` and `SparklineChart`. No backend-specific dashboard endpoint — everything aggregated client-side from a bulk ticket fetch.

**No aging tickets panel, no upcoming reminders widget, no "what happened today" summary.**

### Reminder Architecture

`ticket_reminders` table: `id, ticket_id, user_id, reminder_time TEXT, message, sent INTEGER, sent_at`. Indexed on `reminder_time` and `sent`. Reminders are per-ticket and only fetched on the ticket detail page via `useTicketReminders(ticketId)`. There is no global "upcoming reminders" endpoint.

### Animation and Motion — Current State

`framer-motion@^12.38.0` is installed. Usage is sparse — components use CSS `animate-fade-in` class (defined in `index.css`) with `animation-delay` inline style. `KPICard` uses this staggered CSS pattern. No `motion.*` components found in pages or most components.

---

## New Feature Architecture: Dashboard Overview

### What to Add

The dashboard needs three new data panels:
1. **Aging tickets** — open/in-progress tickets older than N days, sorted by age
2. **Upcoming reminders** — reminders with `reminder_time` in the next X days that are not sent
3. **"What happened today"** — tickets created, updated, resolved, or closed today

### Backend: New Endpoint

Add `GET /api/tickets/dashboard-overview` to `server/src/routes/tickets.ts`.

**Why a dedicated endpoint:** Client-side aggregation on `useTickets({ limit: 1000 })` is the current pattern but fetches too much data. For aging and reminders, targeted SQL with JOINs is cleaner and faster than transferring 1000 rows.

```
GET /api/tickets/dashboard-overview
Response:
{
  aging: [{ id, title, status, priority, created_at, category_id, age_days }],   // top 10 oldest non-closed
  reminders: [{ id, ticket_id, ticket_title, reminder_time, message }],           // next 5 upcoming, sent=0
  today: {
    created: number,
    updated: number,
    resolved: number,
    closed: number
  }
}
```

SQL for aging: `SELECT id, title, status, priority, created_at, category_id, CAST((julianday('now') - julianday(created_at)) AS INTEGER) as age_days FROM tickets WHERE status NOT IN ('closed', 'resolved') ORDER BY created_at ASC LIMIT 10`

SQL for reminders: `SELECT tr.id, tr.ticket_id, t.title as ticket_title, tr.reminder_time, tr.message FROM ticket_reminders tr JOIN tickets t ON t.id = tr.ticket_id WHERE tr.sent = 0 AND tr.reminder_time >= datetime('now') ORDER BY tr.reminder_time ASC LIMIT 5`

SQL for today: 4 COUNT queries with `date(field) = date('now')` — one per event type.

**Route placement:** Add above the `/:id` route in `tickets.ts` to avoid the ID route matching `dashboard-overview` as a ticket ID. This is the critical placement constraint.

### Frontend: New Hook and Components

**New hook:** `useDashboardOverview()` in `src/hooks/useDashboardOverview.ts`
- Calls `GET /api/tickets/dashboard-overview`
- Returns `{ aging, reminders, today, isLoading }`
- Refreshes every 5 minutes (staleTime: 5 * 60 * 1000 via react-query, or manual interval)

**Dashboard.tsx modifications:**
- Replace `useTickets({ limit: 1000, status: 'all' })` with the existing KPI data source (keep for trend/sparklines) PLUS `useDashboardOverview()` for the new panels
- OR: move the existing client-side KPI stats to use `GET /api/reports/summary` (already exists) and free up the bulk fetch

**New panel components (inline in Dashboard.tsx or extracted):**
- `AgingTicketsPanel` — table/list of oldest open tickets with age badge, links to ticket detail
- `UpcomingRemindersPanel` — list of upcoming reminders with time and ticket link
- `TodaySummaryPanel` — 4 small stat chips: created/updated/resolved/closed today

**Component boundaries:**
```
Dashboard.tsx
  useDashboardOverview() → GET /api/tickets/dashboard-overview
  KPICard grid (existing, keep useTickets for sparklines OR switch to /reports/summary)
  AgingTicketsPanel      — new, inline or extracted component
  UpcomingRemindersPanel — new, inline or extracted component
  TodaySummaryPanel      — new, small stat row
```

---

## New Feature Architecture: Command Palette (Cmd+K)

### What to Change

The existing `GlobalSearch.tsx` is an inline header dropdown. The v1.4 goal is a **full command palette** — a modal-style overlay triggered by Cmd+K, with keyboard navigation across tickets, KB articles, contacts, and navigation actions.

**`CommandDialog` is already implemented** in `src/components/ui/command.tsx`. The upgrade path is:

1. **Refactor `GlobalSearch.tsx`** from inline dropdown to using `CommandDialog` (which renders via `@radix-ui/react-dialog`) — OR — create a new `CommandPalette.tsx` component that uses `CommandDialog` and retire the current inline dropdown search in the header

2. **Add KB article search** to the results — call `GET /api/kb/articles?search=` in parallel with ticket search. The `api.getKbArticles({ search })` method already exists in `api.ts`.

3. **Add navigation commands** — static list of page destinations (Tickets, Archive, Reports, KB, Settings etc.) filtered by search term. No backend needed.

4. **Upgrade the header** — replace the inline search input that opens a dropdown with a styled trigger button showing `⌘K` hint, which opens the `CommandDialog` modal.

### Integration Points

**`Layout.tsx`** is the mount point. Currently renders `<GlobalSearch tickets={...} users={...} categories={...} tags={...} />`. After refactor, render `<CommandPalette ... />` instead, or keep the header search as a thin trigger.

**Data passed to CommandPalette:**
- `tickets` — from `useTickets({ page: 1, limit: 100, status: 'all' })` already in Layout.tsx
- `users` — from `useUsers()` already in Layout.tsx
- `categories` — from `useCategories()` already in Layout.tsx
- `tags` — from `useTags()` already in Layout.tsx
- KB search — fetched on-demand inside CommandPalette when query exceeds 2 chars (same as ticket backend search pattern)

**Keyboard shortcut:** Already wired — `document.addEventListener('keydown', ...)` checking `e.key === 'k' && (e.metaKey || e.ctrlKey)`. Keep this, but change it to open the `CommandDialog` (set `open` state) instead of focusing the inline input.

**Result sections in palette:**
```
[idle state]
  Quick Actions (static: Nytt ärende, Inställningar, KB ny artikel...)
  Recently Viewed Tickets (from localStorage 'recently_viewed_tickets')
  Popular Tags
  Popular Categories

[search state — query > 1 char]
  Tickets (from /api/tickets?search=, debounced 250ms)
  KB Artiklar (from /api/kb/articles?search=, debounced 250ms, parallel)
  Kontakter (client-side from users prop)
  Sidor (static nav items filtered by label match)
```

### Modified vs New

| Item | New or Modified |
|------|----------------|
| `CommandPalette.tsx` | NEW — replaces GlobalSearch or wraps it |
| `GlobalSearch.tsx` | MODIFIED — either refactored to use CommandDialog, or replaced |
| `Layout.tsx` | MODIFIED — replace GlobalSearch render with CommandPalette trigger |
| `api.ts` | NO CHANGE — `getKbArticles({ search })` already exists |
| Backend | NO CHANGE — existing `/api/kb/articles?search=` and `/api/tickets?search=` sufficient |

---

## New Feature Architecture: UI Polish

### Dark Mode — What Actually Needs Work

The `.dark` and `.light` CSS classes in `index.css` exist but are incomplete. They override only ~12 variables each. The per-theme definitions (`.theme-default`, `.theme-midnight`, etc.) define 40+ variables but are dark-only by default.

**Approach:** Complete the `.light` class in `index.css` to override all necessary CSS variables to light-appropriate values. The `applyMode()` / `getStoredMode()` plumbing in `appearance.ts` and `AppearanceInitializer` in `App.tsx` is already correct. No React code changes needed — pure CSS variable additions to `index.css`.

**Pattern to follow:** All theming works through CSS custom properties. Never add `dark:` Tailwind variants — use the existing CSS variable approach exclusively. Components use `bg-background`, `text-foreground`, etc. which resolve through the CSS vars.

**Toggle UI:** A mode toggle button (sun/moon icon) needs to be added to the UI. Best placement is `BottomSection` in `Layout.tsx` alongside the logout button, calling `applyMode()` + `saveModeTheme()` from `appearance.ts`.

### Responsive Design — Current Gaps

The layout already has mobile support:
- Sidebar is `fixed`, slides in on mobile with hamburger toggle
- Mobile header shows hamburger + search
- Dashboard grid uses `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`

**Gaps to address:**
- `TicketTable.tsx` / `TicketList.tsx` — table likely needs horizontal scroll or column hiding on mobile
- `KBArticleDetail.tsx` two-column layout (ToC + content) should collapse to single column on mobile
- `Reports.tsx` — chart widths may not adapt to small screens
- New dashboard panels need `sm:` / `md:` responsive grid rules

**Approach:** Audit each page for overflow issues at `sm` (640px) breakpoint. Use `overflow-x-auto` on tables, `hidden sm:table-cell` for secondary columns, `flex-col sm:flex-row` for panel layouts.

### Loading States — Current State and Gaps

`Skeleton` component exists at `src/components/ui/skeleton.tsx`. Usage is sparse — 52 occurrences of "loading/skeleton/spinner" but concentrated in specific components.

**Dashboard loading:** Currently `useTickets` loading state shows nothing — the KPI grid just renders with `value={0}`. A skeleton grid during initial load is the right fix.

**Pattern to establish:**
```tsx
// Consistent loading pattern for all data-dependent pages:
if (isLoading) {
  return <PageSkeleton />  // component-specific skeleton
}
```

**New dashboard panels** must implement skeleton loading — `AgingTicketsPanel` and `UpcomingRemindersPanel` should show `Skeleton` rows while `useDashboardOverview()` resolves.

### Micro-interactions — Current State and Additions

**Existing patterns:**
- `animate-fade-in` CSS class with `animationDelay` for staggered reveals (KPICard)
- `transition-all duration-300 hover:-translate-y-1` on KPICard hover
- `backdrop-blur-xl` on sticky headers
- Sidebar transitions (`transition-all duration-300`)
- `AnimatedNumber` component for counting up values

**`framer-motion@^12.38.0` is installed but underused.** CSS animations cover most existing cases. For v1.4, reserved for:
- CommandPalette overlay entrance (scale + fade via `motion.div` or CSS `@keyframes`)
- New dashboard panels stagger entrance (extend the existing `animate-fade-in` pattern with delays)
- Loading-to-content transition for new widgets

**Rule:** Prefer CSS-only animations (`@keyframes` in `index.css`, Tailwind `animate-*` classes) for simple cases. Use Framer Motion only for gestures or exit animations where CSS falls short (e.g., dismiss/close transitions on panels).

---

## Component Boundaries Summary

| Component | Type | Communicates With |
|-----------|------|-------------------|
| `Dashboard.tsx` | MODIFIED page | `useDashboardOverview`, `useTickets` (existing), new panel components |
| `useDashboardOverview.ts` | NEW hook | `GET /api/tickets/dashboard-overview` |
| `AgingTicketsPanel.tsx` | NEW component | Mounts in `Dashboard.tsx`, data from `useDashboardOverview` |
| `UpcomingRemindersPanel.tsx` | NEW component | Mounts in `Dashboard.tsx`, data from `useDashboardOverview` |
| `TodaySummaryPanel.tsx` | NEW component (small) | Mounts in `Dashboard.tsx`, data from `useDashboardOverview` |
| `tickets.ts` (backend) | MODIFIED route | New `GET /dashboard-overview` sub-route above `/:id` |
| `CommandPalette.tsx` | NEW component | Mounts in `Layout.tsx`, uses `CommandDialog` from `ui/command.tsx`, calls `api.getKbArticles` and `api.getTickets` |
| `Layout.tsx` | MODIFIED | Replace `GlobalSearch` with `CommandPalette`, add dark mode toggle in `BottomSection` |
| `GlobalSearch.tsx` | RETIRED or REFACTORED | Functionality merged into `CommandPalette.tsx` |
| `index.css` | MODIFIED | Complete `.light` CSS variable set, add missing dark mode variable completeness |
| `appearance.ts` | NO CHANGE | Already correct — mode toggle logic exists |

---

## Data Flow Changes

### Dashboard Page Load — Extended

**Current:**
```
Dashboard mounts
  → useTickets({ limit: 1000, status: 'all' }) — fetches all tickets
  → useMemo derives stats, trends, sparklines client-side
```

**New:**
```
Dashboard mounts
  → useTickets({ limit: 1000, status: 'all' })  — keep for sparklines and trends
  → useDashboardOverview()                        — NEW parallel fetch
      → GET /api/tickets/dashboard-overview
          → aging: SQL query (oldest open/in-progress, limit 10)
          → reminders: SQL query (upcoming unsent, limit 5, JOIN tickets)
          → today: 4 COUNT queries
      → returns { aging, reminders, today }
  → Render KPI grid (existing) + 3 new panels in parallel
```

### Command Palette Flow — Refactored

**Current:**
```
User types in GlobalSearch input (in Layout header)
  → Debounced GET /api/tickets?search=&status=all&limit=20
  → Results shown in inline dropdown below input
  → Cmd+K focuses the input
```

**New:**
```
User presses Cmd+K anywhere
  → CommandPalette opens as CommandDialog (modal overlay, z-index above sidebar)
  → [idle] Shows quick actions, recent tickets (localStorage), popular tags/categories
  → [typing > 1 char] Debounced parallel:
      → GET /api/tickets?search=&status=all&limit=20
      → GET /api/kb/articles?search=&limit=10
      → Client-side filter on users prop
      → Static nav items label match
  → User selects item → navigate(path) → dialog closes
```

### Dark Mode Toggle Flow

**Current:** `applyMode()` called once at mount via `AppearanceInitializer`. No UI toggle.

**New:**
```
User clicks mode toggle (in Layout BottomSection)
  → Reads current mode from localStorage
  → Calls applyMode(newMode) — adds/removes .dark/.light on documentElement
  → Calls saveModeTheme(newMode) — persists to localStorage
  → CSS vars on documentElement update → all components re-render via CSS cascade
  → No React state involved — pure DOM class manipulation
```

---

## Build Order

Dependencies drive this order. Dark mode CSS work is standalone. Dashboard and CommandPalette share no dependencies.

### Phase 1 — Dark Mode CSS (no React changes)

Complete the `.light` CSS variable set in `index.css`. All 5 themes need light-appropriate overrides. Test by manually adding `.light` to `documentElement`. Add the toggle button in `Layout.tsx` `BottomSection` after CSS is verified.

**Why first:** No risk, no breaking changes, validates the theming system before adding new features. Purely additive CSS.

### Phase 2 — Dashboard Overview (new backend endpoint + new frontend panels)

1. Add `GET /api/tickets/dashboard-overview` to `server/src/routes/tickets.ts` (above `/:id` route)
2. Create `useDashboardOverview.ts` hook
3. Create `AgingTicketsPanel`, `UpcomingRemindersPanel`, `TodaySummaryPanel` components
4. Update `Dashboard.tsx` to call `useDashboardOverview` and render the new panels
5. Add skeleton loading states to new panels using `Skeleton` component

**Why before CommandPalette:** Self-contained feature, no cross-dependencies. Validates the new backend endpoint pattern before refactoring the complex search.

### Phase 3 — Command Palette Refactor

1. Create `CommandPalette.tsx` using `CommandDialog` from `ui/command.tsx`
2. Port existing GlobalSearch logic (recent tickets, popular tags/categories, quick actions) into CommandPalette
3. Add KB article search leg (parallel debounced fetch)
4. Add navigation commands (static list)
5. Update `Layout.tsx` to mount `CommandPalette` and replace GlobalSearch header trigger
6. Update Cmd+K handler to open the dialog instead of focusing input

**Why last:** Most complex change — refactors existing functionality. Building it last avoids disrupting dashboard and dark mode work. GlobalSearch continues working until step 5.

### Phase 4 — Responsive and Loading Polish

1. Audit `TicketList.tsx` / `TicketTable.tsx` for mobile overflow — add `overflow-x-auto` and responsive column hiding
2. Add skeleton grids to Dashboard (existing KPI section) and new panels
3. Add loading indicators to Reports charts
4. Review KB article detail two-column ToC layout on mobile
5. Add micro-interaction touches (stagger delays to new dashboard panels)

**Why last:** Polish work that depends on all features being in place. Nothing blocks other phases.

---

## Anti-Patterns to Avoid

### Adding `dark:` Tailwind Variants

The design system uses CSS custom properties exclusively. Adding `dark:` variants in component files fragments the theming into two systems. All dark mode work belongs in `index.css` as CSS variable overrides under `.dark` or `.light`.

### A Second Dashboard API Endpoint for KPI Counts

The existing `GET /api/reports/summary` already provides status counts. Creating a third source of truth for ticket counts (alongside client-side derivation in Dashboard.tsx and reports) creates sync problems. Use `/reports/summary` for KPI cards if moving off the bulk fetch; use the new `/dashboard-overview` only for aging, reminders, and today-summary.

### Mounting CommandPalette Inside Layout's Header DOM

The CommandDialog uses a Radix Dialog portal that renders outside the component tree. Mounting the trigger anywhere in Layout is fine — the dialog renders at the document body level. Don't try to contain it or set overflow constraints on the header.

### Loading KB Search on Every Keystroke Without Debounce

KB search (FTS5) and ticket search both run SQL. The existing 250ms debounce is the right pattern. In CommandPalette, share a single debounce timer for both parallel fetch calls — don't create separate debounces that fire at different times.

### Replacing `useTickets` in Dashboard with a New Fetch

The existing `useTickets({ limit: 1000 })` in Dashboard.tsx is used for sparklines and trend calculations that require per-ticket timestamps. The new `useDashboardOverview` adds to it, not replaces it. If the bulk fetch becomes a performance concern, that's a separate optimization task — don't conflate it with this feature.

### Storing "Today" Summary State in Component State

The "what happened today" counts come from the backend endpoint. Don't derive them client-side in the Dashboard with `useMemo` over `useTickets` — the bulk fetch misses tickets created in the current session that aren't in the cached result yet.

---

## Sources

- Direct analysis of `src/pages/Dashboard.tsx` — existing data flow (HIGH confidence)
- Direct analysis of `src/components/GlobalSearch.tsx` — current search architecture (HIGH confidence)
- Direct analysis of `src/components/Layout.tsx` — component mount points, header structure (HIGH confidence)
- Direct analysis of `src/components/ThemeProvider.tsx` + `src/lib/appearance.ts` + `src/index.css` — theme and dark mode system (HIGH confidence)
- Direct analysis of `src/components/ui/command.tsx` — CommandDialog availability (HIGH confidence)
- Direct analysis of `server/src/routes/tickets.ts` — countOnly param, reminder routes, route ordering (HIGH confidence)
- Direct analysis of `server/src/routes/reports.ts` — existing summary endpoint (HIGH confidence)
- Direct analysis of `server/src/db/connection.ts` — ticket_reminders schema (HIGH confidence)
- Direct analysis of `src/lib/api.ts` — getKbArticles method exists, ApiClient pattern (HIGH confidence)
- Direct analysis of `package.json` — framer-motion@^12.38.0, cmdk@^1.1.1 confirmed (HIGH confidence)
