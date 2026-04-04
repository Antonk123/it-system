# Phase 16: Responsive & Animation Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-05
**Phase:** 16-responsive-animation-polish
**Areas discussed:** Mobile navigation, Table & list reflow, Skeleton coverage, Animation approach

---

## Mobile Navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Bottom tab bar | Fixed bottom bar with 4-5 key destinations. Sidebar becomes secondary. | ✓ |
| Keep sidebar overlay | No bottom bar. Existing hamburger + sidebar overlay only. | |
| Bottom bar + FAB | Bottom tab bar plus floating QuickCapture FAB. Two layers. | |

**User's choice:** Bottom tab bar
**Notes:** Most natural for mobile pattern.

### Tab Items

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard, Tickets, KB, Settings | 4 core items. Others via sidebar. | ✓ |
| Dashboard, Tickets, KB, Archive, Settings | 5 items. | |
| Dashboard, Tickets, KB, More | 3 primary + overflow button. | |

**User's choice:** 4 items (Dashboard, Tickets, KB, Settings)

### FAB Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| FAB sits above bottom bar | Standard mobile pattern (like Google apps). | ✓ |
| Replace FAB with tab bar action | Center '+' button in tab bar. | |
| Hide FAB on mobile | Quick capture only from ticket list. | |

**User's choice:** FAB sits above bottom bar

### Breakpoint

| Option | Description | Selected |
|--------|-------------|----------|
| md: (768px) | Phones only. Matches useIsMobile hook. | ✓ |
| lg: (1024px) | Phones and tablets. | |
| sm: (640px) | Very small phones only. | |

**User's choice:** md: (768px)

---

## Table & List Reflow

### Ticket Table Mobile

| Option | Description | Selected |
|--------|-------------|----------|
| Card reflow | Stacked cards below md: with title, status, priority, age. | ✓ |
| Horizontal scroll | Keep table, scroll horizontally. | |
| Column hiding | Hide less-important columns on small screens. | |

**User's choice:** Card reflow

### KB Article List Mobile

| Option | Description | Selected |
|--------|-------------|----------|
| Single column stack | Full-width cards stacked vertically. | ✓ |
| Compact list | Denser title + type only format. | |
| You decide | Claude's discretion. | |

**User's choice:** Single column stack

### Kanban on Mobile

| Option | Description | Selected |
|--------|-------------|----------|
| Hide on mobile | Force list/card view. View toggle hidden. | ✓ |
| Horizontal scroll Kanban | Swipeable columns. | |

**User's choice:** Hide on mobile

---

## Skeleton Coverage

### Pages with Skeletons

| Option | Description | Selected |
|--------|-------------|----------|
| Ticket list | Skeleton rows/cards while loading. | ✓ |
| KB article list | Skeleton article cards while loading. | ✓ |
| Ticket detail page | Skeleton layout for title, status, description. | ✓ |
| KB article detail | Skeleton layout for article content. | ✓ |

**User's choice:** All four pages (plus existing Dashboard skeletons)

### Skeleton Style

| Option | Description | Selected |
|--------|-------------|----------|
| Pulse (keep existing) | animate-pulse + bg-muted. Consistent. | ✓ |
| Shimmer gradient | Animated gradient sweep. More polished. | |
| You decide | Claude's discretion. | |

**User's choice:** Pulse (keep existing)

---

## Animation Approach

### Animation Engine

| Option | Description | Selected |
|--------|-------------|----------|
| Framer Motion for key moments | FM for page transitions + list stagger. CSS for micro-interactions. | ✓ |
| CSS-only | All via Tailwind keyframes. Simpler. | |
| Full Framer Motion | FM everywhere. Most polished, heaviest. | |

**User's choice:** Framer Motion for key moments

### Polish Level

| Option | Description | Selected |
|--------|-------------|----------|
| Subtle & professional | Staggered reveals, fade transitions, crossfade. ~200-300ms. | ✓ |
| Expressive & delightful | Spring physics, slide-in panels, bouncy feedback. | |
| Minimal | Only requirements mandate. Fastest to ship. | |

**User's choice:** Subtle & professional

### Animation Moments

| Option | Description | Selected |
|--------|-------------|----------|
| Staggered list/card reveals | Animate in with stagger delay on page load. | ✓ |
| Page transitions | Fade/slide on route change. | ✓ |
| Skeleton to content crossfade | Smooth transition from placeholder to data. | ✓ |
| Dashboard KPI entrance | Polish existing stagger animation. | ✓ |

**User's choice:** All four moments

---

## Claude's Discretion

- Bottom tab bar visual design (icons, active state, height)
- Mobile card layout details for ticket list
- Skeleton placeholder shapes per component
- Framer Motion variant definitions and easing curves
- Page transition direction and style
- Whether to create reusable animation wrapper components

## Deferred Ideas

None — discussion stayed within phase scope.
