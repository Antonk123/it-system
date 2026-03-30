# Domain Pitfalls

**Domain:** Dashboard overview, command palette (Cmd+K), dark mode toggle, responsive design, loading states, micro-interactions — added to existing React 18 + Tailwind + shadcn IT ticket system
**Researched:** 2026-03-29
**Confidence:** HIGH for codebase-specific analysis (direct inspection). MEDIUM for command palette patterns (WebSearch + codebase). MEDIUM for responsive retrofit patterns (WebSearch).

---

## Critical Pitfalls

### Pitfall 1: Dark Mode Toggle Conflicts With the Existing `.light`/`.dark` Class System

**What goes wrong:**
The codebase already has a custom mode system (`src/lib/appearance.ts`) that manages `.light` and `.dark` classes on `document.documentElement` via `applyMode()`, persisted in localStorage under `"app-mode-theme"`. The app also has `ThemeProvider` wrapping the app via `next-themes`. If a developer adds `next-themes` as the active dark mode driver (setting `attribute="class"`, `defaultTheme="dark"` on the `ThemeProvider`), it will conflict with the existing `applyMode()` calls in `AppearanceInitializer`. Both systems fight over the same `classList` on `<html>`. The result is flash-of-wrong-theme on load, or one system overwriting the other mid-session.

**Why it happens:**
`ThemeProvider` is already imported from `next-themes` and present in `App.tsx`. The instinct is to wire it up fully for the dark mode toggle. But `AppearanceInitializer` in the same file already calls `applyMode(getStoredMode())` on mount, which directly manipulates `document.documentElement.classList`.

**Consequences:**
- FOUC (flash of unstyled/wrong-theme content) on page load
- Toggle works once then reverts when `AppearanceInitializer` runs again
- Two localStorage keys in use: `next-themes` uses `"theme"`, the custom system uses `"app-mode-theme"` — they can drift out of sync

**Prevention:**
Pick one system and commit to it. The existing `applyMode`/`getStoredMode` system in `appearance.ts` is already correct and sufficient. Do NOT activate `next-themes` as the class driver. Instead, expose a toggle that calls `applyMode` + `saveModeTheme` directly. The toggle reads `getStoredMode()` for the current state and calls `applyMode('light'|'dark')` on change. Keep `next-themes` present in `App.tsx` but do not set its `attribute` prop to `"class"` if `AppearanceInitializer` is also active — or remove `AppearanceInitializer` entirely and let `next-themes` own the class.

**Detection:**
- On page load: flash where the page briefly shows the wrong mode before settling
- After toggling: mode persists to localStorage but reverts on next navigation
- Check: does `document.documentElement.classList` contain both `"light"` and `"dark"` simultaneously?

**Phase to address:** Light/dark mode toggle phase.

---

### Pitfall 2: The `.light` CSS Variables Override Is Incomplete — Several Tokens Are Missing

**What goes wrong:**
The `.light` block in `index.css` (lines 519-575) does not define `--primary`, `--primary-foreground`, `--accent`, `--accent-foreground`, `--ring`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-primary-foreground`, `--background-gradient`, or any of the named theme color tokens. When the user switches to light mode, these tokens fall through to the values set in `:root` / `.theme-default`, which are dark-mode values (e.g., `--background: 222 47% 6%` — a very dark blue). Light-mode cards will have dark backgrounds even though the base `--background` is white.

**Why it happens:**
The `.light` block was added as a partial override, not a complete theme. It overrides surface tokens (`--background`, `--card`, `--muted`) but not accent or primary tokens.

**Consequences:**
- Primary buttons in light mode will have dark-mode primary color with poor contrast against a light background
- The `body::before` mesh gradient uses `hsla(var(--primary), 0.12)` — if `--primary` is the dark-mode value, the gradient looks wrong in light mode
- Sidebar primary color wrong — nav active state color invisible or clashing

**Prevention:**
Before implementing the toggle UI, audit the `.light` block and add every token that differs between dark and light. At minimum: `--primary`, `--primary-foreground`, `--accent`, `--accent-foreground`, `--ring`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--background-gradient`. Cross-reference against each of the 4 dark theme blocks (`theme-default`, `theme-midnight`, `theme-graphite`, `theme-stone`) to understand what values are needed.

**Detection:**
Switch to light mode and check: primary buttons, sidebar active nav item, KPICard accent colors, StatusBadge colors. Any component using `bg-primary` or `text-accent` that looks wrong in light mode is a missing token.

**Phase to address:** Light/dark mode toggle phase — before building the toggle, complete the token audit.

---

### Pitfall 3: Dashboard Fetches All 1000 Tickets Client-Side for Every Aggregation

**What goes wrong:**
The existing `Dashboard.tsx` calls `useTickets({ limit: 1000, status: 'all' })` to load all tickets, then computes all KPIs (`stats`, `trends`, `sparklineData`, `criticalTickets`) in `useMemo` on the client. The new dashboard milestone adds aging ticket analysis, reminders, and "what happened today" — if these features also pull from the same `useTickets` call (or add their own), the dashboard will:
1. Fetch 1000+ tickets on every load (growing unboundedly as tickets accumulate)
2. Run multiple expensive `useMemo` computations serially in the render phase
3. Show a blank or loading dashboard while all tickets load before any stat is visible

**Why it happens:**
The existing pattern works fine at low ticket counts and is already in place. The new features logically extend it. Adding reminders with `useReminders()` and an aging hook creates multiple independent fetch waterfalls on page mount.

**Consequences:**
- Dashboard feels slow as ticket count grows to 500+
- `limit: 1000` will eventually return incomplete data (tickets beyond 1000 are invisible to all dashboard aggregations)
- Multiple `useEffect` / query hooks fire on mount, staggering their waterfalls

**Prevention:**
Add a dedicated `/api/dashboard/summary` endpoint that returns pre-aggregated data in a single SQL query: open count, in-progress count, critical count, aging tickets (created >X days ago, still open), today's closed/created count, upcoming reminders. Do NOT expand the client-side aggregation pattern. The dashboard should fetch one small summary JSON object, not 1000 ticket records.

For reminders and recent activity: add them as separate lightweight endpoints (`GET /api/reminders?upcoming=true&limit=5`, `GET /api/tickets?created_today=true&limit=5`) fetched in parallel with `Promise.all` or parallel `useQuery` calls — not sequentially.

**Detection:**
Open browser DevTools Network tab on the Dashboard page. If you see a request for `GET /api/tickets?limit=1000`, the anti-pattern is active. Watch for requests that start only after the previous one finishes (sequential waterfall).

**Phase to address:** Dashboard overview phase.

---

### Pitfall 4: Command Palette Registered as Global `keydown` Listener Inside a Component That Mounts/Unmounts

**What goes wrong:**
The `GlobalSearch` component is rendered inside `Layout.tsx`. If `GlobalSearch` registers `document.addEventListener('keydown', handler)` to catch `Cmd+K`, and if Layout ever conditionally renders or unmounts `GlobalSearch`, the listener may leak (double-registered on remount) or disappear (removed on unmount before user expects). Additionally, `Ctrl+K` in Firefox focuses the browser's address bar — the handler must call `e.preventDefault()` before that default fires.

The existing `GlobalSearch.tsx` has no keyboard listener as of inspection — the Cmd+K trigger needs to be added. The risk is registering it in a component rather than at the root app level.

**Why it happens:**
The command palette is implemented as a component, so the keyboard listener gets placed in a `useEffect` inside that component. This is fine only if the component never unmounts. Since `Layout` renders on every authenticated page, `GlobalSearch` stays mounted — but any refactor that lifts or moves it breaks the listener.

**Consequences:**
- Double-registered listeners: toggle opens and immediately re-opens (two handlers fire)
- Platform divergence: `Cmd+K` on macOS, `Ctrl+K` on Windows/Linux — need both. `Ctrl+K` conflicts with Firefox address bar.
- `e.preventDefault()` missing: browser native action fires before palette opens

**Prevention:**
Register the global `keydown` listener once, at the `App.tsx` level or in a `useCommandPalette` context that is never unmounted. Use the `cmdk` library's built-in `CommandDialog` component (from shadcn's `Command`) which handles portal rendering and focus trapping automatically. Pass `open` / `onOpenChange` state from the global context. Check both `e.metaKey` (macOS) and `e.ctrlKey` (Windows/Linux):

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setOpen(prev => !prev);
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, []);
```

**Detection:**
Open the app, press Cmd+K twice in quick succession. If the palette opens and immediately closes, there are two listeners. Check in Firefox: does `Ctrl+K` focus the address bar instead of the palette?

**Phase to address:** Command palette phase.

---

### Pitfall 5: Command Palette Search Fires API Calls on Every Keystroke Without Debounce

**What goes wrong:**
The existing `GlobalSearch.tsx` already has a debounce pattern (`debounceRef`) for search. But the new command palette needs to search across tickets, KB articles, and contacts simultaneously. If these are three separate `fetch` calls triggered on each debounced keystroke, a fast typist generates N×3 requests. Worse: if the KB article search uses the FTS5 endpoint (`/api/kb/articles?search=`) while ticket search uses a different endpoint, each with different response shapes, the results assembly code becomes complex and fragile.

**Why it happens:**
Extending `GlobalSearch` with KB and contact results means adding new `useState` / `useEffect` pairs or new query calls per result type. The temptation is to copy the existing pattern three times.

**Consequences:**
- Race conditions: older response arrives after newer one, showing stale results
- Noticeable lag if three round-trips complete sequentially
- Complexity in state management: three loading booleans, three error states, three result arrays

**Prevention:**
Add a single `/api/search?q=&types=tickets,kb,contacts` endpoint that runs all three searches in parallel (SQLite can handle concurrent reads via WAL mode) and returns a unified response shape. The client makes one debounced request, gets one structured response. This is simpler than coordinating three async calls client-side.

If adding a unified endpoint is deferred, use `Promise.all` to fire all three requests in parallel client-side and wait for all to settle — not three sequential `await` calls.

**Detection:**
Type a 5-character search term in the palette. In DevTools Network tab, count the number of requests fired. More than one per debounce interval indicates parallel uncoordinated requests.

**Phase to address:** Command palette phase.

---

### Pitfall 6: Responsive Retrofit Breaks the Collapsible Sidebar on Mobile

**What goes wrong:**
The current `Layout.tsx` has two sidebar states: `sidebarOpen` (mobile toggle, default `false`) and `sidebarCollapsed` (desktop collapse, default `false`). The mobile toggle is controlled by a `Menu`/`X` button that appears conditionally. The desktop collapse button is `hidden lg:flex`. If a responsive pass adds `overflow-hidden` to the main content area (common when trying to prevent horizontal scroll), it can clip the sidebar overlay on mobile. Alternatively, if `min-w-0` is missing from the main content flex child, adding responsive padding can cause horizontal overflow that breaks the layout.

**Why it happens:**
Responsive fixes are applied piecemeal — a class is added to fix one breakpoint and inadvertently breaks another. The sidebar overlay (`fixed` positioned) is particularly fragile because `overflow-hidden` on any ancestor clips `position: fixed` children in some browsers.

**Consequences:**
- Mobile sidebar cannot overlay the content (gets clipped)
- Horizontal scrollbar appears on mobile due to a too-wide flex child
- Desktop sidebar collapse animation breaks because width transition collides with new responsive classes

**Prevention:**
Before adding responsive classes, document the current layout structure: which elements are `flex`, which are `fixed`, what scroll containers exist. The outermost `div` in `Layout.tsx` is `min-h-screen flex bg-background relative overflow-hidden` — the `overflow-hidden` is already there. Adding it again on a child is redundant and can cause stacking context issues. Add `min-w-0` to the main content flex child to prevent it from overflowing its container. Never add `overflow-hidden` to the sidebar overlay ancestor.

**Detection:**
On mobile viewport (375px wide): open the mobile sidebar. If the sidebar is clipped or does not appear as an overlay, an ancestor has `overflow-hidden`. In desktop narrow view (900px): confirm the sidebar collapse button still animates and the content area does not overflow.

**Phase to address:** Responsive design phase.

---

### Pitfall 7: Framer Motion `layout` Prop on Dashboard Cards Causes Expensive Layout Thrash

**What goes wrong:**
Adding `layout` or `layoutId` to Framer Motion components on the dashboard (KPICard, stat cards) triggers FLIP layout animations whenever the DOM reflows. On the dashboard, a data fetch completing changes card values — if cards have `layout` prop, every data update triggers a full layout measurement cycle across all cards. On slower hardware, this manifests as jank after the initial fetch resolves and numbers animate in.

**Why it happens:**
`layout` prop is appealing for "smooth reordering" but is applied broadly without understanding its cost. Dashboard cards are not reordering — they are just updating numeric values.

**Consequences:**
- Layout measurement runs on every `useTickets` refetch
- Combined with the animated sparkline charts (recharts redraws SVG on data change), the dashboard can drop frames during data updates
- `animate-pulse` decorative blobs in `Layout.tsx` create continuous compositing load; layout animations on top of these amplify the GPU cost

**Prevention:**
Use `animate` with `initial` props for entrance animations (opacity + translateY) rather than `layout`. Number value animations should use `AnimatedNumber` component (already exists in the codebase) not `layout` transitions. Reserve `layoutId` only for shared element transitions between pages (e.g., a ticket card expanding to detail view) where the visual benefit justifies the cost.

For micro-interactions: animate `opacity` and `transform` properties only. These run on the compositor thread and do not trigger layout. Avoid animating `height`, `width`, `top`, `left`, `margin`, or `padding` directly.

**Detection:**
Open Chrome DevTools Performance tab, record a 3-second dashboard load. Look for "Layout" entries in the flame chart. More than 2-3 layout events during a single render cycle indicates `layout` prop is causing thrash.

**Phase to address:** Micro-interactions phase.

---

## Moderate Pitfalls

### Pitfall 8: Dark Mode Toggle Flashes Wrong Mode on Hard Reload

**What goes wrong:**
`AppearanceInitializer` runs `applyMode(getStoredMode())` inside a `useEffect`, which fires after the browser has already painted the page. Between the initial paint (using whatever CSS the browser applies before JavaScript runs) and the `useEffect` call, the user sees a flash of the wrong mode — typically the `:root` dark theme briefly before the `.light` class is added.

**Prevention:**
Move the mode application to a blocking `<script>` tag in `index.html` (before the React bundle loads) that reads localStorage and adds the appropriate class synchronously:

```html
<script>
  (function() {
    var mode = localStorage.getItem('app-mode-theme') || 'dark';
    document.documentElement.classList.add(mode);
  })();
</script>
```

This runs before the first paint. The `applyMode` call in `AppearanceInitializer` becomes a no-op (class already applied) rather than a late correction.

**Phase to address:** Light/dark mode toggle phase.

---

### Pitfall 9: Command Palette Actions That Modify State Must Handle Navigation Timing

**What goes wrong:**
Command palette "actions" (e.g., "Close selected ticket", "Create new ticket", "Mark as resolved") need to close the palette, run the action, and potentially navigate. If `navigate('/tickets/new')` is called while the palette's close animation is running, React may batch the state update (closing palette) with the navigation, causing the palette to remain briefly visible on the new page, or the Radix Dialog's focus trap to fight with the new page's focus management.

**Prevention:**
Always close the palette before triggering navigation or mutations. Use a small `setTimeout(0)` if needed to let the close animation complete before navigation. With shadcn's `CommandDialog`, use `onOpenChange(false)` then navigate in the callback:

```typescript
const runAction = (action: () => void) => {
  setOpen(false);
  // Use a microtask to let the close animation start
  requestAnimationFrame(() => action());
};
```

**Phase to address:** Command palette phase.

---

### Pitfall 10: HtmlRenderer Component Has Hardcoded Dark-Mode Colors in `prose` Classes

**What goes wrong:**
`HtmlRenderer.tsx` renders KB article content using Tailwind's `@tailwindcss/typography` `prose` classes. The `prose` class applies opinionated light-mode text colors. In dark mode, `prose-invert` is needed. In light mode, `prose` (without invert) is correct. If the component hardcodes `prose prose-invert`, it looks correct in the existing dark-only app but breaks in light mode (inverted colors on a light background = poor contrast or invisible text).

**Prevention:**
Make `prose` class conditional on current mode:

```typescript
<div className={cn("prose max-w-none", mode === 'dark' ? 'prose-invert' : '')}>
```

Or use Tailwind's dark variant: `className="prose max-w-none dark:prose-invert"`. The second approach requires `darkMode: ["class"]` in tailwind config — which is already set.

**Phase to address:** Light/dark mode toggle phase.

---

### Pitfall 11: Responsive Sidebar Does Not Persist Collapsed State Across Navigation

**What goes wrong:**
`sidebarCollapsed` in `Layout.tsx` is local component state (`useState(false)`). Since `Layout` wraps every page, navigating between pages does not unmount `Layout` (React Router keeps it mounted). This means the collapsed state survives navigation in normal use. However, if a developer lifts the sidebar state into a context or moves it for the responsive work, they may accidentally change this — and the sidebar will reset to expanded on every navigation, which is annoying on mobile.

**Prevention:**
Keep sidebar state in `Layout` component state (or lift to a context that persists for the session). Do not persist sidebar collapsed state to localStorage — it's a session preference, not a long-term setting. The mobile `sidebarOpen` state should always reset to `false` on navigation (the current `onClick` handlers on nav items correctly call `setSidebarOpen(false)`).

**Phase to address:** Responsive design phase.

---

### Pitfall 12: Loading Skeletons Built From Scratch Rather Than Using shadcn Skeleton

**What goes wrong:**
Adding loading states to the dashboard and command palette results in bespoke shimmer/skeleton markup per component. Each developer or implementation session produces different pulse animations, different heights, different colors — creating visual inconsistency. The codebase already has shadcn UI installed, which includes a `Skeleton` component.

**Prevention:**
Use `src/components/ui/skeleton.tsx` (part of shadcn) for all loading placeholders. The component uses `animate-pulse bg-muted` which respects the current theme tokens (including light/dark mode). Wrap dashboard sections in a conditional: if data is loading, render skeleton rows matching the expected layout dimensions; when data arrives, animate in with Framer Motion `initial={{ opacity: 0 }} animate={{ opacity: 1 }}` — not a layout animation.

**Phase to address:** Loading states phase.

---

### Pitfall 13: Recharts Charts in Dashboard Do Not Respond to Light Mode

**What goes wrong:**
The existing recharts charts (sparklines, reports charts) use hardcoded colors or Tailwind CSS variable references that work in dark mode. Recharts does not read CSS variables natively — colors passed to `<Line stroke="hsl(var(--primary))" />` require the browser to resolve the CSS variable at render time. In some recharts versions, the color is read once at mount and not updated when the CSS variable changes. Switching to light mode after a chart has mounted leaves the chart with its dark-mode color palette.

**Prevention:**
Read the CSS variable value in JavaScript at render time using `getComputedStyle(document.documentElement).getPropertyValue('--primary')`. Re-read when the mode changes. Alternatively, define chart colors directly in recharts props as hex values that work across both modes (e.g., use the same status colors that are identical in `.light` and `.dark` blocks). The status and priority colors in `index.css` are already defined identically in both modes — use those for charts rather than `--primary`/`--accent`.

**Phase to address:** Light/dark mode toggle phase.

---

## Minor Pitfalls

### Pitfall 14: Command Palette Search Input Loses Focus When Results Update

**What goes wrong:**
If search results update triggers a component re-render that unmounts and remounts the input (e.g., a key change on the `Command` component), the input loses focus mid-typing.

**Prevention:**
Never change the `key` prop on the `Command` or `CommandInput` component while the palette is open. Keep search state (`search`, `results`) in the same component that owns the `Command` so results updating does not cause the input to re-mount.

**Phase to address:** Command palette phase.

---

### Pitfall 15: Dashboard "Aging Tickets" Calculation Done Client-Side on 1000 Ticket Fetch

**What goes wrong:**
Aging tickets (open tickets older than N days) computed via `tickets.filter(t => t.status === 'open' && daysSince(t.createdAt) > 30)` on the client-side 1000-ticket result will miss tickets beyond position 1000 in the dataset, producing a silently wrong "aging" count.

**Prevention:**
Compute aging ticket counts server-side: `SELECT COUNT(*) FROM tickets WHERE status = 'open' AND created_at < datetime('now', '-30 days')`. Include this in the `/api/dashboard/summary` endpoint alongside the other aggregations.

**Phase to address:** Dashboard overview phase.

---

### Pitfall 16: `body::before` Mesh Gradient Visible in Light Mode With Wrong Colors

**What goes wrong:**
`index.css` has a `body::before` pseudo-element that creates a mesh gradient using `hsla(var(--primary), 0.12)` and `hsla(var(--accent), 0.10)`. In the current dark themes, this creates a subtle atmospheric effect. If `--primary` in light mode maps to a saturated blue at high lightness, the pseudo-element mesh gradient will be very visible and clash with the white background.

**Prevention:**
Test `body::before` in light mode before shipping the toggle. If it clashes, add a `.light body::before` rule that reduces opacity further or sets different gradient stops. A safe default: reduce to `0.04` opacity in `.light`.

**Phase to address:** Light/dark mode toggle phase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Dashboard overview | 1000-ticket client-side fetch growing unbounded | Add `/api/dashboard/summary` SQL endpoint |
| Dashboard aging tickets | Client-side filter misses tickets beyond limit | Server-side SQL `created_at < datetime('now', '-30 days')` |
| Command palette keyboard shortcut | Dual `applyMode` / `next-themes` system conflict | Register listener once at App level; `e.preventDefault()` on Ctrl/Cmd+K |
| Command palette multi-source search | Three parallel fetches with race conditions | Single `/api/search?q=` endpoint returning unified results |
| Dark mode toggle | `.light` CSS token block incomplete | Audit and complete all missing tokens before building toggle UI |
| Dark mode toggle | FOUC on hard reload | Blocking `<script>` in `index.html` before React bundle |
| Dark mode + recharts | Chart colors not updating on mode switch | Use JS `getComputedStyle` to read CSS vars, or use mode-invariant hex colors |
| Dark mode + HtmlRenderer | `prose-invert` hardcoded for dark only | Use `dark:prose-invert` Tailwind variant |
| Responsive sidebar | `overflow-hidden` on ancestor clips fixed overlay | Add `min-w-0` to flex children; never add `overflow-hidden` to sidebar parent |
| Micro-interactions | `layout` prop on KPICards causes layout thrash | Use `initial`/`animate` opacity+transform only; no `layout` prop on cards |
| Loading states | Bespoke skeleton per component | Use existing `ui/skeleton.tsx` with shadcn tokens |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `next-themes` + custom `applyMode` | Both active simultaneously, fighting over `document.documentElement.classList` | Pick one system; the existing `applyMode` in `appearance.ts` is sufficient without activating `next-themes` class driver |
| Command palette + React Router | `navigate()` called while Radix Dialog close animation runs | Close palette, then `requestAnimationFrame(() => navigate(...))` |
| Framer Motion + recharts on dashboard | `layout` prop triggers layout measurement after every recharts SVG redraw | No `layout` prop on chart-containing cards; use `AnimatedNumber` for value changes |
| Responsive + sidebar `fixed` overlay | `overflow-hidden` on main content clips `position: fixed` sidebar | Never set `overflow-hidden` on a `position: fixed` child's ancestor |
| Dark mode + `@tailwindcss/typography` prose | `prose` class applies light-mode styles that clash in dark mode | Use `dark:prose-invert` variant which respects the `.dark` class strategy already configured |
| FTS5 search + command palette | Command palette search hits same FTS5 endpoint as KB search bar, doubling request load | Deduplicate with shared React Query cache key or unified search endpoint |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Dashboard fetches 1000 tickets for client-side aggregation | Slow initial load, growing with ticket count | Dedicated `/api/dashboard/summary` SQL endpoint | ~500+ tickets |
| Framer Motion `layout` prop on dashboard cards | Jank after data fetch, Layout events in Performance flame chart | `initial`/`animate` only, no `layout` prop | Immediately with 5+ cards and recharts |
| Command palette three-request waterfall | Noticeable delay between keystroke and results | Unified `/api/search` endpoint or `Promise.all` | Always visible on slow connections |
| Ambient `animate-pulse` blobs in Layout + micro-animations | Continuous GPU compositing, battery drain on mobile | Remove or reduce blur on decorative blobs for mobile | Mobile devices immediately |
| Recharts SVG redraw on every `useMemo` recompute | Chart flickers on unrelated state changes | Memoize chart data arrays with stable dependencies | When parent re-renders frequently |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Command palette exposes ticket titles/descriptions without authentication check | Not applicable — palette only renders inside authenticated `Layout` | Confirm palette is inside auth-guarded routes, not rendered on `/public/*` paths |
| Dashboard summary endpoint lacks authentication | Aggregated counts exposed unauthenticated | Apply `authenticate` middleware to `/api/dashboard/summary` same as all other API routes |
| Search endpoint returns full ticket content | Over-fetching sensitive data for display | Summary search results should return title + status + ID only; full content loaded on navigate |

---

## "Looks Done But Isn't" Checklist

- [ ] **Dark mode:** `.light` block in `index.css` has ALL tokens including `--primary`, `--accent`, `--ring`, `--background-gradient`, `--sidebar-primary`
- [ ] **Dark mode:** `body::before` mesh gradient is tested in light mode — opacity reduced if needed
- [ ] **Dark mode:** `HtmlRenderer` uses `dark:prose-invert` not hardcoded `prose-invert`
- [ ] **Dark mode:** Recharts chart colors update when mode is toggled (not frozen from mount)
- [ ] **Dark mode:** No FOUC — blocking `<script>` in `index.html` applies mode class before bundle loads
- [ ] **Dashboard:** `GET /api/tickets?limit=1000` does NOT appear in DevTools on dashboard load
- [ ] **Dashboard:** Aging ticket count is computed server-side, not filtered from the 1000-ticket client array
- [ ] **Command palette:** Pressing Cmd+K in Firefox does NOT focus the browser address bar
- [ ] **Command palette:** Pressing Cmd+K twice quickly does not open-close-open in a single frame (no double listener)
- [ ] **Command palette:** Navigating from palette closes it before navigation starts
- [ ] **Responsive:** Mobile sidebar overlay is not clipped by parent `overflow-hidden`
- [ ] **Responsive:** Horizontal scroll does not appear at 375px viewport width
- [ ] **Micro-interactions:** No `layout` prop on KPICard or dashboard stat cards
- [ ] **Loading states:** All skeletons use `ui/skeleton.tsx`, not bespoke shimmer divs

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Two mode systems fighting, stored in different localStorage keys | LOW | Add migration in `AppearanceInitializer`: read both keys, prefer the custom `app-mode-theme`, remove the `next-themes` key |
| FOUC persists after blocking script added | LOW | Verify the `<script>` tag is before `<div id="root">` in `index.html` and before any CSS `<link>` tags |
| Recharts charts show dark colors after light mode switch | LOW | Force recharts re-mount on mode change by keying on mode string: `<Chart key={mode} ...>` — acceptable since charts re-fetch data on visible anyway |
| 1000-ticket client aggregation deployed, now slow | MEDIUM | Add `/api/dashboard/summary` endpoint and migrate Dashboard.tsx off `useTickets({ limit: 1000 })` — does not require DB migration |
| Command palette double-listener leak | LOW | Add cleanup: verify `useEffect` return function removes the listener; check React StrictMode double-invoke (expected in dev, not production) |

---

## Sources

- Codebase inspection: `src/lib/appearance.ts`, `src/index.css` (.light/.dark blocks), `src/components/ThemeProvider.tsx`, `src/App.tsx` (AppearanceInitializer), `src/pages/Dashboard.tsx` (1000-ticket fetch), `src/components/GlobalSearch.tsx` (existing debounce pattern), `src/components/Layout.tsx` (sidebar structure), `tailwind.config.ts` (darkMode: ["class"])
- Tailwind CSS dark mode (class strategy): https://tailwindcss.com/docs/dark-mode (HIGH confidence)
- shadcn/ui dark mode: https://ui.shadcn.com/docs/dark-mode (HIGH confidence)
- shadcn/ui theming (CSS variable format): https://ui.shadcn.com/docs/theming (HIGH confidence)
- Framer Motion layout animations: https://motion.dev/docs/react-layout-animations (MEDIUM confidence — verified conceptually via WebSearch)
- TanStack Query request waterfalls: https://tanstack.com/query/v5/docs/react/guides/request-waterfalls (MEDIUM confidence)
- cmdk keyboard shortcut conflicts: WebSearch — browser address bar conflict with Ctrl+K is documented behavior (MEDIUM confidence)

---
*Pitfalls research for: Dashboard overview, command palette (Cmd+K), dark mode toggle, responsive design, loading states, micro-interactions — on existing React 18 + Tailwind + shadcn IT ticket system*
*Researched: 2026-03-29*
