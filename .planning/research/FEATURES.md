# Feature Landscape: Dashboard, Search & Polish (v1.4)

**Domain:** Internal IT ticket system — single-user, existing React + shadcn + Framer Motion stack
**Researched:** 2026-03-29
**Confidence:** HIGH — direct codebase analysis of all relevant files + domain knowledge of mature helpdesk and internal tools

---

## What Already Exists (Baseline)

Do not rebuild these. They are fully implemented and are the foundation for the new features.

| Existing Feature | Implementation |
|-----------------|----------------|
| Dashboard KPI cards with sparklines and trends | `Dashboard.tsx`, `KPICard.tsx`, `SparklineChart.tsx` |
| Dashboard queue cards from saved filter views | `Dashboard.tsx`, `useFilterViews`, localStorage-backed |
| Global search bar (inline in nav header) with Cmd+K | `GlobalSearch.tsx` — searches tickets + users, debounced, backend-powered |
| Search shows: quick actions, recent tickets, popular tags/categories | `GlobalSearch.tsx` — client-side enrichment on idle state |
| Theme system: 5 themes (Slate, Midnight, Graphite, Stone, Daylight) | `index.css` class-based CSS vars, next-themes, Settings.tsx |
| Light/dark mode toggle (per-theme mode classes: `.light`, `.dark`) | Settings.tsx, `applyMode()`, localStorage persistence |
| Framer Motion already installed | `package.json` — `framer-motion@^12.38.0` |
| cmdk already installed | `package.json` — `cmdk@^1.1.1`, used in `Command*` components |
| next-themes already installed | `package.json` — `next-themes@^0.3.0`, ThemeProvider wrapping App |
| Responsive sidebar with collapse/expand | `Layout.tsx` — open/closed state, icon-only collapsed mode |
| Critical tickets alert banner on dashboard | `Dashboard.tsx` — destructive alert for critical+non-closed |

---

## Table Stakes

Features users expect from a mature helpdesk overview. Missing = dashboard feels unfinished.

| Feature | Why Expected | Complexity | Dependency on Existing | Notes |
|---------|-------------|------------|------------------------|-------|
| **Aging tickets section on dashboard** | Standard in Freshdesk, Zendesk, ManageEngine. Tickets open for 3+ days without update are invisible in the current stats grid. Without aging visibility, SLA drift is silent. | Medium | Needs `updated_at` filtering (already on ticket model). Backend query or client-side sort by `updatedAt ASC` where status != closed. | Show top 5-10 oldest-untouched open/in-progress tickets. "No update in X days" label. Click navigates to ticket. No new schema — filter existing data. |
| **"Today at a glance" summary on dashboard** | Helpdesk dashboards universally show daily activity: created today, closed today, resolved today. Gives the single user a daily work rhythm anchor. | Low | `created_at`, `resolved_at`, `closed_at` all exist on tickets. Pure client-side filtering by today's date using existing ticket data. | 3-4 inline stat chips above or below KPI grid. "3 created · 1 resolved · 2 closed today." Compact, not another KPI card row. |
| **Reminders / due-today widget on dashboard** | `ReminderList.tsx` exists and reminders exist in the DB. A dashboard widget showing upcoming/overdue reminders is a natural home for this data. | Low-Medium | `reminders` table already exists. `GET /api/reminders` already exists (check if it does). Reuse `ReminderList` component or a compact variant. | Show top 3-5 upcoming reminders with ticket link. Compact card on dashboard. "Due today" badge for reminders due today. |
| **Command palette as modal (not inline)** | The current GlobalSearch is an inline search bar in the nav header. Standard Cmd+K UX (Linear, Notion, Vercel, GitHub) is a full-screen modal overlay, not inline. The inline approach limits keyboard navigation, result density, and action scope. | Medium | `cmdk` is already installed and `Command*` components from shadcn are already used inside `GlobalSearch.tsx`. Refactor: keep inline input as trigger, open Dialog/modal on focus/Cmd+K. | Use `CommandDialog` from shadcn (wraps `cmdk` in Radix Dialog). Existing search logic (debounce, backend fetch, recent tickets, popular tags) moves into the modal. |
| **Cmd+K includes KB articles in results** | The current global search only searches tickets and users. KB articles have their own FTS5 search API (`GET /api/kb/articles?search=`). Users expect cross-content search from a command palette. | Medium | KB search API already exists. Add parallel fetch to existing search flow. Add a "KB Artiklar" result group in the command list. | Run ticket search and KB search in parallel. Show top 5 KB results. Navigate to `/kb/:id` on select. |
| **Cmd+K includes navigation shortcuts** | Command palettes in Linear, Vercel, GitHub always include "Go to [page]" actions. These are zero-effort to add and train muscle memory. | Very Low | Pure frontend. Hard-coded list of nav items already in `Layout.tsx`. Add as a "Navigation" group when search is empty. | Items: "Gå till Alla ärenden", "Gå till KB", "Gå till Rapporter", "Nytt ärende" etc. Show in idle state. |
| **Dark mode accessible from Cmd+K** | Power users expect settings-level actions in the command palette. "Byt till ljust läge" / "Byt till mörkt läge" as an action. | Very Low | `useTheme()` from next-themes is already available. Add as action in command palette. | Single item: "Växla ljust/mörkt läge". Calls `setTheme()` + `applyMode()` same as Settings.tsx does. |
| **Loading states (skeleton screens)** | The dashboard, ticket list, and KB list all show blank/empty states while data loads. Skeleton screens communicate "loading" instead of "empty", prevent layout shift, and feel faster. | Low-Medium | Framer Motion already installed for animation. React Query (`@tanstack/react-query`) already installed — `isLoading` flag available on all hooks. | Add skeleton variants for: KPI cards (rectangle shimmer), ticket list rows (row shimmer), KB article list (row shimmer). Use CSS shimmer animation, no new library. |
| **Light mode fully styled** | The `.light` and `.dark` mode classes exist in `index.css`, but the light mode (`theme-daylight`) may have incomplete coverage across all components. A fully working light mode is table stakes for UI polish. | Medium | Light mode CSS vars already defined for `theme-daylight`. Audit coverage on all pages and components — fix any color tokens that don't respond to `.light` class. | Systematic audit pass: Dashboard, TicketList, Archive, KB, Reports, Settings, Recurring. Fix any hardcoded dark values. No new libraries needed. |

---

## Differentiators

Features that make this internal tool feel genuinely polished beyond basic functionality.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| **Cmd+K actions: clone ticket, mark resolved** | Real command palette power comes from actions, not just navigation. "Clone ticket #123" or "Mark #123 as resolved" without opening the ticket detail page. | Medium-High | Existing clone logic in `TicketDetail.tsx`. Existing status update API. In command palette, show recent/active tickets as actionable items with action sub-commands. | Requires two-step selection UX: select ticket → select action. More complex than navigation but high UX value. Defer to Phase 2 if scoping is tight. |
| **Staggered page-load animations** | The dashboard and ticket list currently have no entry animations. A well-orchestrated stagger on KPI cards and list rows (fade + slide-up, 50ms delay each) makes the app feel responsive and alive. | Low | Framer Motion already installed at v12. Wrap cards/rows in `motion.div` with `variants` and `staggerChildren`. | One well-done stagger beats scattered micro-interactions. Focus: Dashboard KPI cards stagger, ticket list rows on first load. Use `AnimatePresence` for unmount. |
| **Toast confirmation micro-interactions** | Status changes, ticket creates, and comment submits already use `toast()` from Sonner. Add brief scale/glow animations on the interactive elements (status badge, submit button) at the moment of action. | Low | Framer Motion. Existing Sonner toast. Add `whileTap={{ scale: 0.97 }}` and `whileHover={{ scale: 1.02 }}` on key interactive cards. | Very high polish-to-effort ratio. Apply sparingly: KPI cards, status badge on update, quick-capture FAB. |
| **Responsive mobile layout** | The sidebar collapses but does not become a bottom nav or drawer on mobile. On screens < 768px, a bottom navigation bar is the expected mobile pattern for internal tools (ServiceNow mobile, Jira mobile). | Medium | `Layout.tsx`. No new dependencies — Radix Sheet/vaul already installed for drawers. | Bottom nav with 4 key items (Dashboard, Tickets, KB, New Ticket). Hamburger triggers a slide-over drawer for full nav. Requires breakpoint-aware layout switch in `Layout.tsx`. |
| **Responsive ticket list / kanban** | Kanban view does not work on mobile (columns overflow). List view works but the table columns are too wide. At mobile, Kanban should collapse to a single-column status-filtered view. | Medium | `KanbanView.tsx`, `TicketTable.tsx`. Pure CSS + conditional render. | Hide column headers on mobile, stack cards vertically. Show status selector to switch "active column" view. |
| **Dark mode toggle in nav header** | The current mode toggle is buried in Settings. A one-click toggle in the nav header (sun/moon icon) is standard in all polished tools. | Very Low | `useTheme()` hook, `applyMode()` function. Add icon button to `Layout.tsx` header. | 1 icon button, 5 lines of code. Highest polish-to-effort ratio of any feature in this milestone. |
| **Keyboard shortcut hints visible in UI** | Show keyboard shortcut hints inline on hover or in the command palette header area. E.g., "⌘K to search", "/ to focus KB search". Trains users on available shortcuts. | Very Low | Existing shortcuts already implemented: Cmd+K in `GlobalSearch.tsx`, `/` for KB search in `KnowledgeBase.tsx`. Add visual badges. | Add `<kbd>` elements next to the search bar and in empty states. CSS-styled keyboard key appearance. |

---

## Anti-Features

Explicitly do not build these in v1.4.

| Anti-Feature | Why Avoid | What to Do Instead |
|-------------|-----------|-------------------|
| **AI-powered summaries / smart inbox** | External API dependency, cost, privacy. The single-user context makes "smart routing" meaningless. | Dashboard aging sort gives the same "what needs attention?" signal without AI. |
| **Custom dashboard widget builder (drag/drop)** | Queue cards already provide user-defined dashboard widgets via saved filter views. A full drag-drop widget canvas (like Grafana) is massive complexity for one user. | The existing queue card system + the new aging/reminders sections is sufficient. |
| **Real-time push / WebSocket updates** | Single-user tool. No race conditions, no need to push updates from other sessions. SQLite in-process doesn't support concurrent writes cleanly anyway. | React Query's `refetchInterval` (already in use) is sufficient for live counts. |
| **PWA offline mode** | Already out of scope per PROJECT.md. Offline support requires service workers, cache strategies, and sync conflict resolution. | Docker deployment with reliable LAN access is the deployment model. |
| **Multi-theme animated transitions** | Animating between themes (fade to black then reveal new theme) is a design distraction that adds complexity with no productivity value. | Instant theme switch (current behavior) is correct. |
| **Command palette history / frecency** | Storing and ranking command history (like Raycast) adds state management complexity. For a single-user tool with <10 actions, the quick-actions list is always the same. | Show hard-coded "Snabbåtgärder" group. Recent tickets already show last 3 visited. |
| **Notification bell / inbox feed** | Ticket status changes + reminders are the only "notifications" in a single-user system. Adding a notification feed duplicates information already visible on the dashboard. | Dashboard reminders widget + existing email notifications are sufficient. |
| **Per-component dark mode toggle** | Some tools let individual components toggle their own color mode. This adds CSS complexity with no UX benefit. | One global mode toggle in the nav header is the correct pattern. |

---

## Feature Dependencies

```
dashboard aging section
  └── uses ticket.updatedAt (already on model)
  └── client-side sort, no new API needed

"today at a glance" summary
  └── uses ticket.createdAt, ticket.resolvedAt, ticket.closedAt (all exist)
  └── pure client-side, no new API

reminders widget on dashboard
  └── GET /api/reminders must return upcoming reminders (verify endpoint exists)
  └── reuse ReminderList.tsx or extract compact variant

command palette as modal (Cmd+K refactor)
  └── cmdk already installed
  └── CommandDialog from shadcn already available (wraps Radix Dialog)
  └── existing search logic in GlobalSearch.tsx moves into modal

KB articles in Cmd+K search
  └── GET /api/kb/articles?search= already exists
  └── requires command palette modal (above)
  └── parallel fetch in existing debounced search handler

navigation shortcuts in Cmd+K
  └── requires command palette modal (above)
  └── nav items already defined in Layout.tsx

dark mode toggle in nav header
  └── useTheme() hook, applyMode() function (both in Settings.tsx already)
  └── no new API or schema

light mode audit and fix
  └── .light and .dark CSS classes already defined in index.css
  └── systematic component-by-component audit

loading states / skeleton screens
  └── isLoading from React Query hooks (already in use across app)
  └── Framer Motion for shimmer animation
  └── applied to Dashboard KPIs, TicketList rows, KB list rows

stagger animations on page load
  └── framer-motion already installed
  └── applied to Dashboard.tsx KPICard grid
  └── applied to TicketList.tsx list rows

responsive mobile layout
  └── vaul already installed (slide-over drawer)
  └── Layout.tsx restructure — breakpoint-aware render
  └── bottom nav on mobile < 768px

actions in Cmd+K (clone, status change)
  └── requires command palette modal (above)
  └── requires two-step selection UX
  └── depends on existing clone/status-update API
```

---

## MVP Recommendation for v1.4

Build in this order, optimizing for highest value and lowest risk of regression:

**Phase 1 — High value, very low complexity:**
1. Dark mode toggle in nav header (1 icon button in Layout.tsx, ~30 min)
2. Navigation shortcuts in Cmd+K (hard-coded list, idle state, ~1 hour — requires modal first)
3. "Today at a glance" summary row on dashboard (client-side date filter, ~1.5 hours)
4. Keyboard shortcut hints visible in UI (`<kbd>` badges, ~30 min)

**Phase 2 — Core dashboard and command palette upgrade:**
5. Command palette refactored to modal (`CommandDialog`, ~3 hours — migrate existing GlobalSearch logic)
6. KB articles in Cmd+K search (parallel fetch, new result group, ~2 hours — after modal)
7. Aging tickets section on dashboard (sort by updatedAt, top-N list, ~2 hours)
8. Reminders widget on dashboard (reuse/adapt ReminderList, ~2 hours — verify API first)

**Phase 3 — Polish and responsive:**
9. Loading states / skeleton screens (shimmer for KPI cards + list rows, ~3 hours)
10. Light mode audit and fix (systematic token audit, ~3 hours)
11. Stagger animations on page load (Framer Motion on Dashboard KPI grid, ~1.5 hours)
12. Responsive mobile layout — bottom nav + sidebar drawer (Layout.tsx restructure, ~4 hours)

**Defer (high complexity, limited single-user value):**
13. Cmd+K ticket actions (clone, status change) — complex two-step UX, worth a separate phase
14. Responsive Kanban for mobile — medium complexity, low usage frequency

---

## Complexity Matrix

| Feature | Schema Changes | Backend Changes | Frontend Changes | Estimated Effort |
|---------|---------------|-----------------|-----------------|------------------|
| Dark mode toggle in nav | None | None | 1 button in Layout.tsx | ~30 min |
| Keyboard shortcut hints | None | None | `<kbd>` elements in SearchBar, KB | ~30 min |
| "Today at a glance" | None | None | Date filter on existing tickets | ~1.5 hr |
| Nav shortcuts in Cmd+K | None | None | Hard-coded items in command palette | ~1 hr |
| Command palette modal | None | None | Refactor GlobalSearch into CommandDialog | ~3 hr |
| KB articles in Cmd+K | None | None | Parallel KB fetch in search handler | ~2 hr |
| Aging tickets dashboard | None | None (or add sort param) | New section in Dashboard.tsx | ~2 hr |
| Reminders widget | None | Verify GET /api/reminders | Compact ReminderList variant | ~2 hr |
| Loading skeletons | None | None | Shimmer CSS + conditional render | ~3 hr |
| Light mode audit | None | None | CSS token audit and fix | ~3 hr |
| Stagger animations | None | None | Framer Motion variants on grid | ~1.5 hr |
| Responsive mobile layout | None | None | Layout.tsx restructure, bottom nav | ~4 hr |
| Cmd+K actions (tickets) | None | None | Two-step selection UX | ~5 hr |
| Responsive Kanban | None | None | KanbanView.tsx conditional layout | ~3 hr |

---

## Confidence Assessment

| Area | Level | Basis |
|------|-------|-------|
| Existing feature inventory | HIGH | Direct codebase read of GlobalSearch.tsx, Dashboard.tsx, Layout.tsx, Settings.tsx, ThemeProvider.tsx, index.css, package.json |
| Command palette patterns | HIGH | cmdk already installed and used; shadcn Command components already in use; domain patterns from Linear, Vercel, GitHub, Notion are well-established |
| Dashboard aging / "today" patterns | HIGH | Standard helpdesk patterns from Freshdesk, Zendesk, ManageEngine; ticket model already has all required timestamps |
| Skeleton screen / loading states | HIGH | React Query isLoading already in use; Framer Motion installed; pattern is well-established in the codebase |
| Dark mode complexity | HIGH | next-themes + class-based CSS vars fully set up; light/dark classes defined; gap is coverage audit not architecture |
| Responsive layout | MEDIUM | vaul installed; Layout.tsx structure is clear; actual breakpoint behavior requires live browser testing to confirm |
| Micro-interaction scope | MEDIUM | Framer Motion installed; specific animations need scoping per component to avoid performance regressions |

---

## Sources

- Direct codebase: `src/components/GlobalSearch.tsx`, `src/pages/Dashboard.tsx`, `src/components/Layout.tsx`, `src/pages/Settings.tsx`, `src/components/ThemeProvider.tsx`, `src/index.css`, `package.json`
- Project constraints: `.planning/PROJECT.md` — single-user constraint, out-of-scope list, existing stack
- Command palette UX patterns: Mobbin command palette glossary, cmdk GitHub (github.com/pacocoursey/cmdk), shadcn/ui Command docs — HIGH confidence
- Helpdesk dashboard patterns: Geckoboard helpdesk dashboard examples, ManageEngine ticket aging reports, Freshdesk / Zendesk dashboard feature sets — MEDIUM confidence (external, verified against known patterns)
- Responsive breakpoints: BrowserStack 2025 breakpoint guide, NNGroup responsive design — MEDIUM confidence
- Skeleton screens: Smashing Magazine skeleton screens React, react-loading-skeleton GitHub — HIGH confidence (established pattern, no new library needed)
