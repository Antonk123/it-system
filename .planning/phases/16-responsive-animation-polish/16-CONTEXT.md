# Phase 16: Responsive & Animation Polish - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

The application is usable on mobile and tablet, communicates loading state clearly, and delivers smooth entrance animations that make the UI feel alive. No new features or capabilities — only responsive layout adaptations, skeleton loading states, and motion polish on existing pages.

</domain>

<decisions>
## Implementation Decisions

### Mobile Navigation (RESP-01)
- **D-01:** Fixed bottom tab bar on screens below md: breakpoint (768px) with 4 items: Dashboard, Tickets, KB, Settings. Archive, Recurring, Reports, Users remain accessible via sidebar overlay (hamburger menu).
- **D-02:** The existing sidebar overlay (hamburger menu) remains available on mobile as a secondary navigation for the full item list. Bottom bar is primary navigation.
- **D-03:** QuickCapture FAB floats above the bottom tab bar on mobile — both remain accessible simultaneously.
- **D-04:** Bottom bar breakpoint is md: (768px), matching the existing `useIsMobile` hook. Tablets (768-1024px) keep the sidebar overlay with hamburger, no bottom bar.

### Table & List Reflow (RESP-02)
- **D-05:** Ticket table switches to stacked card layout below md: breakpoint. Each card shows title, status badge, priority, and age. No horizontal scrolling.
- **D-06:** KB article list stacks to single-column full-width cards on mobile. Title, type badge, and tags remain visible.
- **D-07:** Kanban view is hidden on mobile (below md:). Force list/card view — the view toggle is hidden below md: breakpoint.

### Skeleton Loading (ANIM-01)
- **D-08:** Skeleton loading states added to: ticket list, KB article list, ticket detail page, and KB article detail page. Dashboard already has skeletons from Phase 14.
- **D-09:** Skeleton style is pulse (existing `animate-pulse` with `bg-muted`). Consistent with Dashboard skeletons from Phase 14. No shimmer variant.

### Animation Approach (ANIM-02)
- **D-10:** Use Framer Motion (already installed, v12.38) for key animation moments: page transitions (AnimatePresence), staggered list/card reveals, and skeleton-to-content crossfade. Keep CSS transitions for micro-interactions (hover, focus).
- **D-11:** Animation polish level is subtle & professional — staggered reveals on page load, fade transitions between pages, skeleton-to-content crossfade. Durations ~200-300ms. No flashy spring physics or scroll-triggered effects.
- **D-12:** All four animation moments are in scope: (1) staggered list/card reveals on page load, (2) page-level fade transitions on route change, (3) skeleton-to-content crossfade when data loads, (4) polished Dashboard KPI entrance (improve existing stagger).
- **D-13:** Respect `prefers-reduced-motion` — disable animations when user has reduced motion preference. AnimatedNumber already does this; extend to all new animations.

### Claude's Discretion
- Bottom tab bar visual design (icon choice, active state indicator, height)
- Mobile card layout details for ticket list (exact fields shown, spacing, tap targets)
- Skeleton placeholder shapes per component (rectangle ratios, line counts)
- Framer Motion variant definitions and exact easing curves
- Page transition direction (fade vs slide vs crossfade)
- Whether to create reusable animation wrapper components or inline motion props

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Layout & Navigation
- `src/components/Layout.tsx` — Primary layout wrapper with sidebar, mobile header, responsive breakpoints. Bottom bar integrates here.
- `src/hooks/use-mobile.tsx` — Mobile breakpoint detection hook (768px). Used for conditional rendering.
- `src/components/ui/sidebar.tsx` — Shadcn sidebar with mobile/desktop variants, Sheet overlay pattern.

### Ticket list & table
- `src/components/TicketTable.tsx` — Current table component, needs card reflow variant for mobile.
- `src/components/KanbanView.tsx` — Kanban board, hidden on mobile per D-07.
- `src/pages/TicketList.tsx` — Page that renders TicketTable/KanbanView with view toggle.

### KB article list
- `src/pages/KnowledgeBase.tsx` — KB list page with article cards, needs single-column stack on mobile.

### Dashboard & existing animations
- `src/pages/Dashboard.tsx` — Dashboard with KPI cards, aging panel, reminders panel. Has staggered `animationDelay` props.
- `src/components/KPICard.tsx` — KPI card with `animationDelay` prop and `animate-fade-in` class.
- `src/components/AnimatedNumber.tsx` — Number animation with `prefers-reduced-motion` support — pattern to follow.
- `src/components/AgingTicketsPanel.tsx` — Uses skeleton loading pattern.
- `src/components/RemindersPanel.tsx` — Uses skeleton loading pattern.

### Skeleton & animation infrastructure
- `src/components/ui/skeleton.tsx` — Existing skeleton component (`animate-pulse` + `bg-muted`).
- `tailwind.config.ts` — Custom keyframes (fade-in, slide-in-right, scale-in) and animation utilities.
- `src/index.css` — Global keyframes (fade-in-lift, shimmer, mesh-shift). Theme CSS variables.

### Detail pages (skeleton targets)
- `src/pages/TicketDetail.tsx` — Ticket detail page, needs skeleton loading state.
- `src/pages/KBArticleDetail.tsx` — KB article detail page, needs skeleton loading state.

### Quick capture
- `src/components/QuickCaptureFAB.tsx` — Floating action button, needs position adjustment above bottom bar on mobile.

### Requirements
- `.planning/REQUIREMENTS.md` — RESP-01, RESP-02, ANIM-01, ANIM-02 requirements for this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Skeleton` component in `ui/skeleton.tsx` — ready for use across all new skeleton states.
- `useIsMobile` hook — 768px breakpoint detection, use for bottom bar and card reflow conditionals.
- `AnimatedNumber` component — has `prefers-reduced-motion` check pattern to replicate.
- `framer-motion` v12.38 — installed but unused. AnimatePresence, motion components available.
- Tailwind keyframes (fade-in, slide-in-right, scale-in) — available for CSS-only micro-interactions.
- `animate-fade-in` utility class — already used in Dashboard and Layout for entrance animations.

### Established Patterns
- Responsive breakpoints use `lg:` (1024px) as primary. This phase adds `md:` (768px) for bottom bar and card reflow.
- Dashboard panels use `animationDelay` inline style for staggered entrance — can be upgraded to Framer Motion stagger.
- Data fetching uses React Query with `isLoading` state — skeleton rendering can key off this directly.
- Layout.tsx manages mobile state via `isMobileMenuOpen` and `isCollapsed` — bottom bar adds a third responsive layer.

### Integration Points
- `Layout.tsx` — bottom tab bar component renders here, below `{children}`.
- `App.tsx` — page transitions wrap route outlets with AnimatePresence.
- `TicketList.tsx` — view toggle hides Kanban option on mobile; table switches to card layout.
- `KnowledgeBase.tsx` — grid switches to single column on mobile.
- `QuickCaptureFAB.tsx` — bottom positioning adjusts when bottom bar is visible.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for all visual implementations.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 16-responsive-animation-polish*
*Context gathered: 2026-04-05*
