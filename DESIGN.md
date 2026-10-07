---
name: IT-Ticket
description: A calm, rounded interface for internal IT support, using the existing theme palettes.
rounded:
  sm: "0.5rem"
  md: "0.625rem"
  lg: "0.75rem"
---

# IT-Ticket design system

## Direction

The interface should feel like a practical work tool: clear labels, rounded controls,
quiet surfaces and predictable spacing. The October 2026 refinement replaces the
previous sharp-cornered Forge treatment and decorative effects. Keep existing
navigation and workflows familiar.

All color themes share the same shapes. `src/index.css` defines `--radius: 0.75rem`
once; color themes must not override it. The Tailwind mapping gives controls and
cards 12px corners, medium elements 10px, and small elements 8px. Circular avatars,
switches and the mobile create action retain their existing shapes.

## Colors and typography

Use semantic theme tokens for every surface and state. Keep all existing color
palettes and the user's selected font; Forge remains the default palette.

- `background`, `card`, `popover`, `muted`: page and component surfaces.
- `primary`: primary actions, selected navigation and focus indicators.
- `foreground` / `muted-foreground`: primary and supporting text.
- `border`: thin, neutral separation between surfaces.
- `priority-*` and `status-*`: existing semantic colors, always paired with labels.

Inter is the default body font. Labels and buttons use medium weight and ordinary
sentence case. KPI values use tabular numerals; ticket IDs can use monospace.
Avoid uppercase tracked labels and decorative technical typography.

## Shared components

- **Buttons:** 12px corners, solid fills, medium labels. Secondary outlined actions
  use a 1px neutral border. Hover and pressed states change color without moving
  or scaling the control. No gradients, glow, blur or colored shadows.
- **Icon buttons:** use the same rounded button primitive. Keep Lucide's rounded
  strokes and supply an accessible name for controls without a text label.
- **Inputs and selects:** use the shared radius and visible focus ring. Menus have
  an opaque `popover` surface, a neutral border and a modest floating shadow.
- **Cards and tables:** flat surfaces with a thin border and rounded corners.
  No resting shadows, registration marks or decorative corner ornaments.
- **KPI cards:** a muted rounded icon background, readable label and tabular value.
  Only interactive cards receive a hover affordance.
- **Status badges:** sentence-case labels with a subtle outline and semantic color.
- **Priority badges:** retain the existing colored left edge and literal class map.
- **Sidebar:** rounded selected rows with a soft primary tint. The create action
  uses the same solid primary fill as other primary buttons.

## Layout and interaction

Use a 4/8px spacing rhythm and consistent page gutters. Avoid empty layout wrappers
that create unexplained gaps between headings and filters. Keep shadows for floating
menus/dialogs and active drag states, not resting panels.

Preserve visible keyboard focus, accessible names, disabled states and reduced-motion
support. Verify shared changes in light/dark mode and at desktop/mobile widths.
