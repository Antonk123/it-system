---
name: IT-Ticket — Forge
description: A materials-specification board for triaging IT tickets — flat steel/concrete panels, material-grade priority swatches, and stamped approval statuses.
colors:
  background-concrete: "hsl(200, 10%, 8%)"
  foreground-paper: "hsl(60, 5%, 93%)"
  card-panel: "hsl(200, 9%, 11%)"
  primary-steel-blue: "hsl(205, 45%, 48%)"
  secondary-panel: "hsl(200, 8%, 15%)"
  muted-panel: "hsl(200, 7%, 16%)"
  accent-rust-amber: "hsl(28, 60%, 48%)"
  destructive-oxide-red: "hsl(9, 70%, 48%)"
  border-steel: "hsl(200, 8%, 22%)"
  priority-critical: "hsl(9, 75%, 50%)"
  priority-high: "hsl(28, 75%, 50%)"
  priority-medium: "hsl(205, 30%, 52%)"
  priority-low: "hsl(150, 20%, 42%)"
  status-open: "hsl(205, 55%, 52%)"
  status-in-progress: "hsl(32, 70%, 50%)"
  status-waiting: "hsl(195, 15%, 55%)"
  status-resolved: "hsl(150, 35%, 45%)"
  status-closed: "hsl(200, 8%, 50%)"
typography:
  body:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontWeight: 400
  label:
    fontFamily: "Inter, -apple-system, system-ui, sans-serif"
    fontWeight: 600
    letterSpacing: "0.025em"
  numeral-mono:
    fontFamily: "JetBrains Mono, ui-monospace, Fira Code, monospace"
    fontWeight: 700
rounded:
  sm: "calc(0.25rem - 4px)"
  md: "calc(0.25rem - 2px)"
  lg: "0.25rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
components:
  priority-badge:
    backgroundColor: "{colors.priority-critical}"
    rounded: "{rounded.sm}"
    padding: "2px 8px 2px 6px"
  status-badge:
    textColor: "{colors.status-open}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  kpi-card:
    backgroundColor: "{colors.card-panel}"
    rounded: "{rounded.lg}"
    padding: "16px"
  card-base:
    backgroundColor: "{colors.card-panel}"
    rounded: "{rounded.lg}"
---

# Design System: IT-Ticket — Forge

## Overview

**Creative North Star: "The Materials-Specification Board"**

Forge treats the ticket queue as a specification sheet for structural materials, not a card-based SaaS dashboard. It categorically rejects the genre the critique flagged as generic (glassmorphism, hover-glow KPI cards, decorative corner blobs, soft rounded-pill badges): panels are flat, cornered close to square, and read their state through material-grade color and stamp typography rather than gradient or blur. This is the shipped state after three finish-review rounds — round 1 removed an inherited gradient/blur/hover-glow from the shared Card primitive, round 2 removed its residual shadow and brought `TicketTable.tsx` into the same flat pattern, and round 3 removed the critical-alert banner's borrowed left-bar device (it now uses its own four-sided frame) and deleted dormant glassmorphic CSS (`body::before` mesh-gradient, an unused `.ticket-card` utility, unused `--background-gradient` vars) from `src/index.css` entirely.

Priority reads as a material grade: a flat swatch tag with a left-edge color bar, warm hues (oxide-red, rust-amber) for urgent grades and cool hues (steel-blue, concrete-green) for calm ones, so urgency is legible by color before any label is parsed. Status reads as an approval stamp: an outlined, uppercase, tracked rectangle — a procedurally cooler, distinct color family from priority so the two never visually collide. Mono numerals (JetBrains Mono) are reserved for ticket IDs and KPI figures only, never for ordinary labels.

Forge ships as the app's `defaultTheme`, selectable in Settings → Appearance as "Forge," alongside six untouched pre-existing themes (`theme-default`, `theme-midnight`, `theme-graphite`, `theme-stone`, `theme-linear`, `theme-spotify`). Its color tokens apply app-wide because the theme system is global, but component-level migration to Forge's patterns is surface-by-surface: today that's Dashboard and Ärendelista (`TicketTable.tsx`, `TicketQueueTable.tsx`). Other pages inherit Forge's palette but may still carry old chrome until migrated in a later pass — this is expected, not a defect.

**Key Characteristics:**
- Flat panels at rest: no gradient fill, no blur, no baked-in hover-lift or glow on the base Card primitive.
- Priority = material-grade swatch (left-bar tag); Status = approval stamp (outlined uppercase rectangle). Two distinct devices, never merged.
- Mono type is numerals-only (ticket IDs, KPI figures); labels stay in Inter, plain case.
- Shadows exist only for genuinely floating UI (dialogs, menus, active-drag) — never resting panels or cards.

## Colors

A cool, low-saturation concrete-and-steel base carries the interface; color is spent almost entirely on priority/status signal, not decoration.

### Primary
- **Steel Blue** (`hsl(205, 45%, 48%)` dark / `hsl(205, 55%, 34%)` light): primary actions, links, focus ring (`--ring`), sidebar-primary. The calm, structural accent — never the urgency signal.

### Secondary
- **Rust Amber** (`hsl(28, 60%, 48%)` dark / `hsl(28, 70%, 38%)` light): `--accent`, used sparingly for secondary emphasis (in-progress status ink, warning tone).

### Neutral
- **Concrete** (`hsl(200, 10%, 8%)` dark background / `hsl(195, 8%, 95%)` light background): base app surface.
- **Panel** (`hsl(200, 9%, 11%)` dark / `hsl(195, 6%, 98%)` light): `--card`, the surface every flat panel sits on.
- **Steel Border** (`hsl(200, 8%, 22%)` dark / `hsl(195, 8%, 78%)` light): `--border`, the structural line that replaces shadow as the depth cue.
- **Paper** (`hsl(60, 5%, 93%)` dark foreground / `hsl(200, 12%, 12%)` light foreground): body text.

### Named Rules
**The Warm-Urgent / Cool-Calm Rule.** Priority hue families are load-bearing: oxide-red (critical, `hsl(9,75%,50%)`) and rust-amber (high, `hsl(28,75%,50%)`) are warm; steel-blue (medium, `hsl(205,30%,52%)`) and concrete-green (low, `hsl(150,20%,42%)`) are cool. An agent must be able to spot what's burning by hue alone, before reading a single label.

**The Two-Ink Rule.** Priority and status never share a color family at the same lightness/hue band — status runs its own procedurally-generated, cooler-leaning ink set (`--status-*`) distinct from `--priority-*`, so a status stamp is never mistaken for a priority swatch.

## Typography

**Body Font:** Inter (with -apple-system, system-ui, sans-serif fallback)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, Fira Code, monospace fallback)

**Character:** A plain, structural sans for everything read as prose or UI chrome; a monospace reserved exclusively for numerals that function like a serial stamp — never decorative, never a label.

### Hierarchy
- **Body** (400, text-sm–base): default UI text, table cells, descriptions.
- **Label** (600, text-xs, tracking-wide on status only): field labels, badge text. Plain case except the Status stamp, which is uppercase.
- **Numeral-mono** (700, font-mono, text-2xl on KPI figures, text-xs on ticket IDs): reserved strictly for numeric values — ticket IDs and KPI card figures.

### Named Rules
**The Numerals-Only Mono Rule.** `font-mono` (JetBrains Mono) appears only on the KPI card's numeral (`<AnimatedNumber>`) and ticket-ID text — never on a plain-case or uppercase label, and never as a decorative "technical" typeface applied to prose.

## Layout

Dashboard leads with the critical-tickets alert above the KPI row (not below it, per the direction contract's revised ordering), then four KPI panels, then the Aktiv kö table. Ärendelista's desktop view is a single bordered table container; priority/status render as the shared badge components inside table cells, not a third bespoke badge implementation (`TicketQueueTable.tsx` was consolidated onto the same `PriorityBadge`/`StatusBadge` contract used elsewhere — one shared rendering path for priority/status, not per-surface reinvention).

## Elevation & Depth

Forge is flat by default: resting panels and cards carry `shadow-none` and rely on a 1px `border-border` line for structural separation, not a drop shadow. Depth is expressed through border and background-tint layering (`bg-muted/40`, `hover:bg-muted/50`), not elevation. Shadows are reserved for state, not surface: `KanbanCard` applies `shadow-2xl` only while `isDragging` is true (a temporary lift affordance, gone at rest), and the shadow tokens defined per-theme (`--shadow-sm` through `--shadow-2xl`, tight and dark: e.g. `--shadow-sm: 0 1px 3px -1px hsl(200 10% 3% / 0.35), 0 1px 1px 0px hsl(200 10% 3% / 0.2)`) are meant for genuinely floating UI — dialogs, popovers, menus — never panels or cards at rest.

### Shadow Vocabulary
- **shadow-sm** (`0 1px 3px -1px hsl(200 10% 3% / 0.35), 0 1px 1px 0px hsl(200 10% 3% / 0.2)`): floating UI only (dialogs, dropdowns, popovers).
- **shadow-2xl** (Tailwind default, gated behind `isDragging`): active-drag lift on `KanbanCard`. Not a resting-state treatment.

### Named Rules
**The Drag-Not-Hover Rule.** Shadow-as-lift is earned by an active interaction state (drag), never by hover. `KPICard` and `Card`'s own hover treatment is a border-color shift (`hover:border-primary/50`) plus a color transition, not a shadow or glow.

**The Border-Carries-Structure Rule.** Panels and cards separate from their background via `border border-border`, never via shadow. Shadow tokens exist for floating UI only.

## Shapes

`--radius: 0.25rem` is Forge's own theme token, driving the shared `--radius-lg`/`-md`/`-sm` Tailwind mapping — this is what makes Forge's cards and panels read sharp-cornered relative to other themes (e.g. `theme-stone` at `0.75rem`) while reusing the same `rounded-lg`/`rounded-sm` utility classes. Priority and status badges use `rounded-sm` (a near-square corner), reinforcing the "stamped tag" read over a soft pill. The critical-alert banner on Dashboard uses a full four-sided `border` in the priority-critical color — deliberately distinct from the priority-swatch tag's left-bar-only (`border-l-2`) device, so the page-level alert doesn't read as a reused application of the per-row badge pattern.

## Components

### Cards / Containers
- **Corner Style:** `rounded-lg` (0.25rem via Forge's `--radius` token).
- **Background:** `bg-card` (panel token), flat, no gradient.
- **Shadow Strategy:** `shadow-none` at rest (see Elevation & Depth); no baked-in hover-lift or glow on the base primitive — individual components opt in to their own minimal hover treatment.
- **Border:** `border border-border`, always present — this is the primary depth cue.
- **Internal Padding:** `p-4` (CardContent).

### Priority Badge (signature component)
Renders as a flat "material grade" swatch tag, not a soft pill: `inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border-l-2 text-xs font-medium`, colored via a literal per-priority class lookup (`priority-badge-critical`, `-high`, `-medium`, `-low`) — never a template-interpolated class string, which previously stripped all badge color as a P0 correctness bug (fixed; do not reintroduce that pattern). The left border (`border-l-2`) is the grade bar.

### Status Badge (signature component)
Renders as an "approval stamp": `inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold uppercase tracking-wide border`, colored via the same literal-class-lookup pattern as Priority Badge, drawing from the separate `--status-*` ink family (cooler, more procedural than priority's warm/cool split).

### KPI Card (signature component)
Flat bordered panel (`shadow-none`), two opposite-corner "register mark" `<span>` ticks (`absolute ... border-l border-t border-border` top-left, `border-r border-b border-border` bottom-right) — an intentional print-registration-mark motif, confirmed deliberate across multiple review rounds, not a partial four-corner treatment. The numeral is `font-mono font-bold text-2xl`; the label beneath it is plain-case, not uppercase, not tracked.

### Critical Alert Banner (Dashboard, signature pattern)
A full four-sided `border` (not `border-l-2`) in `hsl(var(--priority-critical))` with an 8%-opacity tinted background — deliberately distinct from the priority-badge left-bar device so the page-level alert doesn't read as a scaled-up badge. Positioned above the KPI row, the highest-stakes signal on the page.

### Table (Ärendelista)
`rounded-lg overflow-hidden border border-border bg-card` container; row hover is a flat `hover:bg-muted/50` — no gradient wash. Priority/status cells render the shared `PriorityBadge`/`StatusBadge` components, the same contract used on Dashboard's "Aktiv kö" widget (`TicketQueueTable.tsx`), not a third independent badge implementation.

### Kanban Card
Already-compliant flat `rounded-lg bg-card border border-border`. The only shadow present (`shadow-2xl`) is gated strictly behind the active-drag state (`isDragging && 'opacity-50 scale-95 shadow-2xl z-50 ring-2 ring-primary cursor-grabbing'`) — a legitimate temporary interaction affordance, the pattern to follow for any future "lifted" interaction state.

## Do's and Don'ts

### Do:
- **Do** keep priority as a left-bar swatch tag (`border-l-2`, literal per-priority class) and status as a full-border uppercase stamp (`border`, `uppercase tracking-wide`) — two distinct devices, never merged into one badge style.
- **Do** reserve `font-mono` for numerals only (ticket IDs, KPI figures).
- **Do** use `border border-border` as the default depth cue for panels; reach for shadow only on floating UI (dialogs, menus) or an active-drag state.
- **Do** reuse the shared `PriorityBadge`/`StatusBadge` components for any new surface that renders priority or status — do not reinvent a third badge implementation.

### Don't:
- **Don't** add gradient fill, blur, or a baked-in hover-glow to the base `Card` primitive — this was inherited from a generic-SaaS template and removed across two review rounds; it must not return.
- **Don't** apply the priority swatch's `border-l-2` left-bar device to page-level alert banners — the critical-alert banner intentionally uses a full four-sided `border` so it doesn't read as a reused badge.
- **Don't** build priority/status class names via string interpolation (`` `priority-badge-${priority}` ``) — Tailwind's scanner cannot see interpolated classes; use the literal per-value lookup map, as `PriorityBadge`/`StatusBadge` already do.
- **Don't** treat Forge's global token application as full component migration — `AgingTicketsPanel.tsx` and `TicketList.tsx`'s mobile card list still print raw English priority enum values (a pre-existing, separately-tracked bug) and other untouched pages may still carry old chrome; this DESIGN.md documents Dashboard + Ärendelista, not an app-wide migration.
