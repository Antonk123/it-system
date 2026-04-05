# Phase 16: Responsive & Animation Polish - Research

**Researched:** 2026-04-05
**Domain:** Responsive layout, Framer Motion v12, skeleton loading, CSS animations
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Fixed bottom tab bar on screens below `md:` breakpoint (768px) with 4 items: Dashboard, Tickets, KB, Settings. Archive, Recurring, Reports, Users accessible via sidebar overlay.
- **D-02:** Existing sidebar overlay (hamburger) remains available on mobile as secondary navigation. Bottom bar is primary.
- **D-03:** QuickCapture FAB floats above the bottom tab bar on mobile — both accessible simultaneously.
- **D-04:** Bottom bar breakpoint is `md:` (768px). Tablets (768–1024px) keep sidebar overlay with hamburger, no bottom bar.
- **D-05:** Ticket table switches to stacked card layout below `md:`. Shows title, status badge, priority, age. No horizontal scrolling.
- **D-06:** KB article list stacks to single-column full-width cards on mobile. Title, type badge, tags visible.
- **D-07:** Kanban view hidden on mobile (below `md:`). Force list/card view — view toggle hidden below `md:`.
- **D-08:** Skeleton loading added to: ticket list, KB article list, ticket detail page, KB article detail page. Dashboard already has skeletons.
- **D-09:** Skeleton style is pulse (`animate-pulse` + `bg-muted`). No shimmer variant.
- **D-10:** Use Framer Motion v12.38 (already installed). AnimatePresence for page transitions, staggered reveals, skeleton-to-content crossfade. CSS transitions for micro-interactions.
- **D-11:** Subtle & professional animation level. Durations ~200–300ms. No spring physics or scroll-triggered effects.
- **D-12:** Four animation moments in scope: (1) staggered list/card reveals, (2) page-level fade transitions on route change, (3) skeleton-to-content crossfade, (4) polished Dashboard KPI entrance.
- **D-13:** Respect `prefers-reduced-motion`. AnimatedNumber already does this — extend pattern to all new animations.

### Claude's Discretion
- Bottom tab bar visual design (icon choice, active state indicator, height)
- Mobile card layout details for ticket list (exact fields shown, spacing, tap targets)
- Skeleton placeholder shapes per component (rectangle ratios, line counts)
- Framer Motion variant definitions and exact easing curves
- Page transition direction (fade vs slide vs crossfade)
- Whether to create reusable animation wrapper components or inline motion props

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RESP-01 | Layout anpassas för mobil med bottom navigation på små skärmar | Bottom tab bar component in Layout.tsx; `useIsMobile` hook for conditional render; `md:` breakpoint; FAB offset |
| RESP-02 | Tabeller och listor är läsbara och scrollbara på mobil | TicketTable already has isMobile branch (card layout exists but needs D-05 fields); KnowledgeBase.tsx grid → single column; KanbanView hidden via `hidden md:block` |
| ANIM-01 | Skeleton loading states visas vid datahämtning | Skeleton component ready; TicketList/KBArticleList use `isLoading`; TicketDetail/KBArticleDetail use local `isLoading` state |
| ANIM-02 | Sidövergångar och staggered list reveals | Framer Motion v12.38 installed; AnimatePresence in App.tsx wrapping AppRoutes; motion.div with stagger in list pages; Dashboard KPI upgrade |
</phase_requirements>

---

## Summary

Phase 16 is a pure polish phase — no new backend endpoints, no new pages. It layers three concerns on top of the existing codebase: (1) a mobile bottom navigation bar, (2) responsive reflow of ticket and KB lists, and (3) Framer Motion animations for page transitions, staggered reveals, and skeleton crossfades.

The codebase is well-prepared. `useIsMobile` (768px) already exists and is imported in `TicketTable.tsx`. `TicketTable` already has a mobile card branch at line 206 — it renders a card layout when `isMobile` is true. However, the card's field set does not exactly match D-05 (it shows requester but not a formatted "age" field). The KB list already uses `isLoading` with inline pulse skeletons (lines 359–365). `framer-motion` v12.38.0 is installed but no `motion` component or `AnimatePresence` is used anywhere yet.

**Primary recommendation:** Build in four discrete tasks — (A) bottom tab bar in Layout.tsx, (B) ticket card field fix + KB single-column + Kanban hide, (C) skeleton states on TicketList, TicketDetail, KBArticleDetail, (D) Framer Motion wiring in App.tsx + list pages + Dashboard KPI upgrade.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| framer-motion | 12.38.0 (installed) | AnimatePresence, motion components, stagger | Already in package.json; v12 stable API |
| tailwindcss | 3.4.17 (installed) | Responsive breakpoints, `md:hidden`, `hidden md:block` | Project standard |
| react-router-dom | 7.12.0 (installed) | `useLocation` for AnimatePresence key | Already used |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn/ui Skeleton | already in `src/components/ui/skeleton.tsx` | Pulse placeholder | All loading states |
| lucide-react | already installed | Icons for bottom tab bar | Nav bar icons |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Framer Motion AnimatePresence | CSS `animate-fade-in` only | CSS-only can't crossfade between route exits and entrances; AnimatePresence handles unmount |
| motion.div stagger | CSS `animation-delay` | CSS delay approach (already on KPICard) works but can't be `prefers-reduced-motion` disabled reliably without JS; Framer Motion is already decided (D-10) |

**Installation:** No new packages required. All dependencies are installed.

---

## Architecture Patterns

### Component Layout

```
src/
├── components/
│   ├── BottomTabBar.tsx      # NEW — mobile bottom nav (4 items)
│   ├── Layout.tsx            # MODIFY — render BottomTabBar below children, pb-16 md:pb-0 on main
│   ├── QuickCaptureFAB.tsx   # MODIFY — bottom-20 when isMobile (above bottom bar)
│   ├── TicketTable.tsx       # MODIFY — fix mobile card fields per D-05 (add age, remove requester)
│   ├── KPICard.tsx           # MODIFY — upgrade animationDelay CSS to Framer Motion variant
│   └── ui/skeleton.tsx       # NO CHANGE — already correct
├── pages/
│   ├── TicketList.tsx        # MODIFY — hide Kanban toggle on mobile, wrap list in motion.div
│   ├── KnowledgeBase.tsx     # MODIFY — replace inline pulse divs with Skeleton component + motion reveal
│   ├── TicketDetail.tsx      # MODIFY — add skeleton loading state
│   ├── KBArticleDetail.tsx   # MODIFY — add skeleton loading state
│   ├── Dashboard.tsx         # MODIFY — upgrade panels to Framer Motion stagger
│   └── App.tsx               # MODIFY — wrap AppRoutes outlet with AnimatePresence
```

### Pattern 1: Bottom Tab Bar Component

**What:** A fixed `nav` rendered at the bottom of the viewport, visible only on mobile (`md:hidden`). Four primary links. Active link gets visual indicator (border-top accent or filled icon).

**When to use:** Always rendered in Layout.tsx, visibility controlled via Tailwind class alone (`md:hidden`), no JS conditional needed.

```tsx
// BottomTabBar.tsx
import { LayoutDashboard, Ticket, BookOpen, Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const tabs = [
  { path: '/', icon: LayoutDashboard, label: 'Översikt' },
  { path: '/tickets', icon: Ticket, label: 'Ärenden' },
  { path: '/kb', icon: BookOpen, label: 'KB' },
  { path: '/settings', icon: Settings, label: 'Inställningar' },
];

export const BottomTabBar = () => {
  const { pathname } = useLocation();
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex h-16 border-t border-border/50 bg-background/95 backdrop-blur-xl">
      {tabs.map(({ path, icon: Icon, label }) => {
        const active = pathname === path;
        return (
          <Link
            key={path}
            to={path}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 transition-colors',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
```

**Integration in Layout.tsx:**
- Add `<BottomTabBar />` just before closing `</div>` of the root wrapper.
- Add `pb-16 md:pb-0` to the `<main>` content div (`div className="p-5 lg:p-6 relative z-10"` → `p-5 pb-[calc(1.25rem+4rem)] md:pb-6 lg:pb-6`).

**QuickCaptureFAB position adjustment:**
The FAB's `bottom-6` must become `bottom-[calc(1.5rem+4rem)] md:bottom-6` on mobile so it sits above the tab bar.
```tsx
// In Layout.tsx:
<QuickCaptureFAB className={cn(
  "left-4 lg:transition-[left] lg:duration-300",
  "bottom-[calc(1.5rem+4rem)] md:bottom-6",   // lift above bottom bar on mobile
  sidebarCollapsed ? "lg:left-20" : "lg:left-[17rem]"
)} />
```
The FAB already accepts a `className` prop that's forwarded to the Button's `cn()` — this works directly.

### Pattern 2: Framer Motion Page Transitions (AnimatePresence)

**What:** Wrap the `<Routes>` output with `<AnimatePresence mode="wait">`. Each page component's root `<Layout>` children wrap with a `motion.div` that fades in/out.

**When to use:** App.tsx — wrap `<AppRoutes />` or individual route content.

The cleanest approach for react-router-dom v7 is a `PageTransition` wrapper used inside each page at the `<Layout>` children level, keyed by `useLocation().pathname`.

```tsx
// src/components/PageTransition.tsx (NEW — optional wrapper)
import { motion } from 'framer-motion';
import { ReactNode } from 'react';

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const PageTransition = ({ children }: { children: ReactNode }) => {
  if (prefersReduced()) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
};
```

**App.tsx wiring — AnimatePresence on location key:**
```tsx
// In AppRoutes():
import { AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';

const AppRoutes = () => {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* ...existing routes... */}
      </Routes>
    </AnimatePresence>
  );
};
```

Note: `BrowserRouter` must wrap `AppRoutes` for `useLocation` to work — already true in the current structure (AuthProvider is inside BrowserRouter).

### Pattern 3: Staggered List Reveals

**What:** Wrap list containers in `motion.div` with `staggerChildren` variant. Each list item is a `motion.div` child.

```tsx
// Variants — define once, reuse
const listVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
};

// Usage in KnowledgeBase.tsx article list:
<motion.div
  className="space-y-2"
  variants={listVariants}
  initial="hidden"
  animate="visible"
>
  {articles.map(article => (
    <motion.div key={article.id} variants={itemVariants}>
      {/* existing button/card */}
    </motion.div>
  ))}
</motion.div>
```

**prefers-reduced-motion guard:**
```tsx
// Utility hook (or inline) — mirrors AnimatedNumber pattern:
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Then: initial={prefersReduced ? false : 'hidden'}
//       animate={prefersReduced ? false : 'visible'}
```

### Pattern 4: Skeleton-to-Content Crossfade

**What:** When `isLoading` flips from true to false, the skeleton fades out and content fades in using `AnimatePresence`.

```tsx
<AnimatePresence mode="wait">
  {isLoading ? (
    <motion.div
      key="skeleton"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {/* Skeleton rows */}
    </motion.div>
  ) : (
    <motion.div
      key="content"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Real content */}
    </motion.div>
  )}
</AnimatePresence>
```

### Pattern 5: Dashboard KPI Upgrade

Current approach: CSS `animate-fade-in` class + inline `animationDelay` style on each KPICard wrapper in Dashboard.tsx. This works but cannot be disabled via `prefers-reduced-motion` without a media query override in CSS.

Upgrade: Replace the `div className="animate-fade-in"` wrappers with `motion.div` stagger via the `listVariants/itemVariants` pattern. Keep the `animationDelay` prop on KPICard for backwards compat or remove it if replaced.

**Existing `animate-fade-in` CSS keyframe stays** — it's still used in Layout.tsx for the mobile overlay backdrop. Only KPICard wrappers in Dashboard.tsx are upgraded.

### Anti-Patterns to Avoid

- **Wrapping `<Routes>` without passing `location` prop:** AnimatePresence requires `<Routes location={location}>` AND `key={location.pathname}` to detect route changes. Omitting either breaks exit animations.
- **Double motion wrappers:** KPICard already has `div className="animate-fade-in"` as its outermost element. If wrapping with `motion.div` in Dashboard.tsx, remove the `animate-fade-in` wrapper — don't double-animate.
- **Conditional motion imports:** Always import `motion` from `framer-motion` at top level. Conditional rendering uses `initial={false}` pattern, not conditional imports.
- **CSS `pb-16` on wrong element:** The padding-bottom for the bottom bar must go on the scrollable content area (`div className="p-5 lg:p-6"`), not on `<main>` itself (which uses flex layout).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exit animations on route change | Manual CSS transition with `display:none` | `AnimatePresence` from framer-motion | Exit animation requires keeping component mounted during transition — only AnimatePresence does this |
| Stagger timing | `setTimeout` cascade | `staggerChildren` in Framer Motion variants | Built-in, respects variant inheritance |
| prefers-reduced-motion check | Custom hook | Inline `window.matchMedia` check (matches AnimatedNumber pattern) | Consistent with existing codebase; no extra dep needed |
| Skeleton shimmer | Custom CSS gradient animation | `Skeleton` component (`ui/skeleton.tsx`) — already correct style per D-09 | Consistent pulse style; one line to use |

---

## Common Pitfalls

### Pitfall 1: AnimatePresence not triggering exit on route change

**What goes wrong:** Exit animation never fires; components unmount immediately.
**Why it happens:** `<Routes>` must receive `location` prop AND have a `key` prop for AnimatePresence to detect the change. Without `location`, Routes manages its own location internally and AnimatePresence can't intercept unmount.
**How to avoid:** Always use `<Routes location={location} key={location.pathname}>` inside AnimatePresence. `useLocation()` must be called inside BrowserRouter scope — it already is in `AppRoutes`.
**Warning signs:** Page transition fade-in works but fade-out does not.

### Pitfall 2: Bottom bar obscures page content on mobile

**What goes wrong:** Content behind the bottom tab bar (buttons, table rows, form fields) is unreachable by touch.
**Why it happens:** Fixed bottom bar is `z-40`, sits over the scrollable `<main>` content.
**How to avoid:** Add `pb-16 md:pb-0` (or `pb-[4rem] md:pb-0`) to the inner content `div.p-5`. This ensures the last items scroll clear of the bar. Also ensure FAB is `bottom-20 md:bottom-6` so it clears the bar.
**Warning signs:** Pagination controls on TicketList hidden on mobile.

### Pitfall 3: Framer Motion v12 motion component import

**What goes wrong:** Build error `motion is not a function` or type errors.
**Why it happens:** In Framer Motion v12, the named export is `motion` from `'framer-motion'`. The API is unchanged from v10/v11. No breaking changes to `motion.div`, `AnimatePresence`, or `useReducedMotion` in v12.
**How to avoid:** `import { motion, AnimatePresence } from 'framer-motion';` — standard import, no special v12 syntax.
**Warning signs:** TypeScript errors about motion types — ensure `@types/react` ≥ 18 (already at 18.3.23).

### Pitfall 4: Double animation on KPICard

**What goes wrong:** KPI cards stutter or double-animate — once from CSS `animate-fade-in`, once from Framer Motion.
**Why it happens:** KPICard wraps its content in `<div className="animate-fade-in" style={{ animationDelay }}>`; if Dashboard.tsx also wraps with `motion.div`, both fire simultaneously.
**How to avoid:** When upgrading KPICard to Framer Motion stagger, remove the `animate-fade-in` className and `animationDelay` inline style from KPICard.tsx's outer div. Use Framer Motion variant instead.
**Warning signs:** Cards visually "pop" twice on load.

### Pitfall 5: TicketTable mobile card already exists but has wrong fields

**What goes wrong:** Mobile card branch is present (line 206 in TicketTable.tsx) but fields don't match D-05.
**Why it happens:** The existing mobile card shows title, status select, priority badge, requester, and checklist progress. D-05 requires: title, status badge, priority, and **age**. Requester is absent from spec; age is absent from current implementation.
**How to avoid:** Modify the mobile branch in TicketTable.tsx to match D-05 exactly. Calculate age from `ticket.createdAt` (days ago). Replace the full status `<Select>` with a read-only `<StatusBadge>` for the card layout — tapping the card navigates to detail page, status is not edited inline on mobile.
**Warning signs:** Status select too wide for mobile card; no age shown.

### Pitfall 6: KBArticleDetail uses local state isLoading, not React Query

**What goes wrong:** Skeleton pattern for KBArticleDetail must key off local `isLoading` state (line 43 in KBArticleDetail.tsx), not a React Query `isLoading`. The fetch happens in a `useEffect`.
**Why it happens:** KBArticleDetail.tsx fetches via `api.getKbArticle()` directly in a `useEffect`, not via `useQuery`. So `isLoading` is a plain `useState(true)` that flips to `false` in the `finally` block.
**How to avoid:** The skeleton pattern is the same — just key off the existing `isLoading` state. No refactoring of the fetch to React Query is needed.
**Warning signs:** None, just ensure skeleton renders when `isLoading === true`.

---

## Code Examples

Verified against codebase (not official docs — internal patterns):

### Existing `useIsMobile` pattern to reuse
```tsx
// src/hooks/use-mobile.tsx
const isMobile = useIsMobile(); // true when width < 768px
// Usage: className={cn("fixed bottom-6", isMobile && "bottom-20")}
// Or purely via Tailwind: className="bottom-20 md:bottom-6"
```
The Tailwind class approach is preferred for static layout — avoids JS hydration flicker.

### Existing Skeleton component usage
```tsx
// Already used in TicketList.tsx (lines 293–297) and Dashboard.tsx
import { Skeleton } from '@/components/ui/skeleton';
// Skeleton shapes:
<Skeleton className="h-12 w-full" />         // table row
<Skeleton className="h-8 w-32" />             // title line
<Skeleton className="h-4 w-24 mt-2" />        // sub-line
<Skeleton className="h-64 w-full" />           // article body block
```

### prefers-reduced-motion pattern (from AnimatedNumber.tsx)
```tsx
// Inline check — no hook needed:
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// In motion props:
initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
```
`initial={false}` tells Framer Motion to skip the initial animation entirely.

### Framer Motion stagger variants pattern
```tsx
import { motion, AnimatePresence } from 'framer-motion';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
};

// Wrap list:
<motion.div variants={container} initial="hidden" animate="show">
  {items.map(i => <motion.div key={i.id} variants={item}>...</motion.div>)}
</motion.div>
```

### Age calculation for ticket card (D-05)
```tsx
// Simple days-ago string for mobile card
const daysAgo = Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / 86400000);
const ageLabel = daysAgo === 0 ? 'Idag' : daysAgo === 1 ? '1 dag' : `${daysAgo} dagar`;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CSS `animation-delay` for stagger | Framer Motion `staggerChildren` | This phase | Better `prefers-reduced-motion` support; exit animations |
| Inline pulse div for KB skeleton | `<Skeleton>` component | This phase | Consistency with rest of app |
| No page transitions | `AnimatePresence` + fade | This phase | Perceived performance improvement |

**Deprecated/outdated in this phase:**
- `animate-fade-in` + inline `animationDelay` on KPICard wrappers in Dashboard.tsx — replaced by Framer Motion stagger. The CSS keyframe itself stays (used elsewhere in Layout.tsx).

---

## Open Questions

1. **TicketDetail skeleton granularity**
   - What we know: TicketDetail is a large page (many sections: header, description, checklist, comments, links, activity, reminders). Full page skeleton would be very complex.
   - What's unclear: How many skeleton sections to show — full fidelity vs. simple 2-3 block placeholder.
   - Recommendation: Show 3 skeleton blocks (header area h-8, description area h-48, footer area h-32) while loading. This matches the `h-24 rounded-lg bg-muted animate-pulse` pattern used in KB list — simple, consistent.

2. **AnimatePresence placement — App.tsx vs. per-page**
   - What we know: `AppRoutes` is a separate component inside `BrowserRouter`. `useLocation` is available there.
   - What's unclear: Whether to put `AnimatePresence` in `App.tsx` (wrapping `<AppRoutes />`) or inside `AppRoutes` itself.
   - Recommendation: Inside `AppRoutes` — it needs `useLocation` from react-router-dom, which requires being inside the Router context. `App.tsx` renders `AppRoutes` inside `<BrowserRouter>` but the function component itself does not have router context. Keep `AnimatePresence` inside `AppRoutes`.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely frontend code changes. No external tools, CLI utilities, or services are required beyond what is already running. All dependencies (framer-motion, tailwindcss, react-router-dom) are installed and verified.

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 16 |
|-----------|-------------------|
| **Simplicity First** — minimal code impact | Create one new component (BottomTabBar); modify 7 existing files. No new hooks, no new pages. |
| **No Laziness** — find root causes | TicketTable mobile card already exists but has wrong fields — fix it to match D-05 exactly, not a workaround. |
| **Minimal Impact** — only touch what's necessary | Only modify files listed in canonical_refs. Do not refactor KBArticleDetail fetch to React Query — use existing `isLoading` state. |
| **Plan First** — write plan to tasks/todo.md | Planner will produce PLAN.md files; each task must be checkable. |
| **Frontend Aesthetics** — avoid generic AI aesthetic | Bottom tab bar: distinctive active state (e.g., accent-colored top border + filled icon, not just a blue underline). Motion easing should feel intentional, not generic cubic-bezier(0.4,0,0.2,1). |

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/components/Layout.tsx`, `TicketTable.tsx`, `KnowledgeBase.tsx`, `QuickCaptureFAB.tsx`, `Dashboard.tsx`, `AnimatedNumber.tsx`, `App.tsx`, `tailwind.config.ts`, `use-mobile.tsx`, `ui/skeleton.tsx`, `KPICard.tsx`
- `package.json` + installed `node_modules/framer-motion/package.json` — confirmed v12.38.0
- `.planning/phases/16-responsive-animation-polish/16-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)
- Framer Motion v12 API: no breaking changes to `motion`, `AnimatePresence`, `variants` from v10/v11 per changelog knowledge (training data, August 2025 cutoff — framer-motion v12 was stable by then)

### Tertiary (LOW confidence)
- None. All critical patterns verified against installed version and existing code.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries installed and confirmed
- Architecture: HIGH — patterns derived from reading actual source files
- Pitfalls: HIGH — derived from reading TicketTable.tsx mobile branch, KPICard animation, App.tsx structure
- Framer Motion v12 API: MEDIUM — confirmed installed version; API patterns from training data (no breaking changes to motion/AnimatePresence in v12 series)

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable stack)
