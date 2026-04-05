# Phase 13: Dark Mode Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 13-dark-mode-foundation
**Areas discussed:** Light/dark vs themes, Nav toggle design, Recharts reactivity

---

## Light/Dark vs Themes

| Option | Description | Selected |
|--------|-------------|----------|
| One universal light mode | Single .light class overrides all themes. Simplest to maintain. | |
| Drop .light, use Daylight theme | Toggle switches between dark theme and theme-daylight. Fewer CSS blocks. | |
| Per-theme light variants | Each dark theme gets its own light counterpart. Most polished, 5x CSS work. | ✓ |

**User's choice:** Per-theme light variants

**Follow-up: What about Daylight theme?**

| Option | Description | Selected |
|--------|-------------|----------|
| Daylight stays light-only | Toggling dark from Daylight switches to Slate. | |
| Daylight gets a dark variant too | Full symmetry, 5 themes × 2 modes = 10 token sets. | |
| Remove Daylight entirely | Redundant once every theme has a light variant. | ✓ |

**User's choice:** Remove Daylight entirely — 4 themes × 2 modes = 8 token sets.

---

## Nav Toggle Design

| Option | Description | Selected |
|--------|-------------|----------|
| Sun/moon icon — light/dark only | Single icon button in header. Theme picker stays in Settings. | ✓ |
| Icon + dropdown — mode + theme | Click toggles mode, chevron opens theme picker. | |
| Dropdown menu with all options | Single dropdown for mode and theme combined. | |

**User's choice:** Sun/moon icon only — simple toggle in nav header.

---

## Recharts Reactivity

| Option | Description | Selected |
|--------|-------------|----------|
| Mode-keyed remount | Add mode as key prop on chart containers, forces re-render on toggle. | ✓ |
| CSS variable passthrough | Use hsl(var(--chart-x)) directly, needs empirical testing. | |
| You decide | Claude picks approach during implementation. | |

**User's choice:** Mode-keyed remount — deterministic, no guessing about Recharts internals.

---

## Claude's Discretion

- Light variant color palette design for each theme
- Whether to keep or remove the Settings page mode Switch
- Sun/moon icon choice and placement
- FOUC script implementation details
- Order of implementation

## Deferred Ideas

None — discussion stayed within phase scope.
