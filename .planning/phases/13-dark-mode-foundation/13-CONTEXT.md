# Phase 13: Dark Mode Foundation - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

The theming system is complete — light mode is fully styled across every component, dark mode toggle is one click away in the nav, and the chosen mode persists without a flash on reload. No new features or capabilities beyond theming.

</domain>

<decisions>
## Implementation Decisions

### Light/Dark Mode Architecture
- **D-01:** Per-theme light variants. Each of the 4 dark themes (Slate, Midnight, Graphite, Stone) gets a corresponding light variant with matching accent colors. 4 themes x 2 modes = 8 token sets total.
- **D-02:** Remove the Daylight theme entirely — it becomes redundant once every theme has its own light variant.
- **D-03:** The existing incomplete `.light` class block in `index.css` (line 519) is replaced by per-theme light token sets (e.g., `.light .theme-default`, `.light .theme-midnight`, etc.).
- **D-04:** `applyMode()` in `appearance.ts` remains the active mode system. Do NOT activate next-themes as the class driver — keep it dormant.

### Nav Toggle
- **D-05:** A sun/moon icon button in the nav header toggles between light and dark mode. Single click, no dropdown.
- **D-06:** The color theme picker (Slate, Midnight, Graphite, Stone) stays in the Settings page under Appearance. Not exposed in the header.
- **D-07:** The existing Switch toggle in Settings can remain as a secondary way to toggle mode, or be replaced — Claude's discretion.

### FOUC Prevention
- **D-08:** A blocking `<script>` in `index.html` reads `localStorage` for the stored mode and applies the class to `<html>` before React hydrates. This prevents any flash of the wrong theme on page load (THEME-03).

### Recharts Color Reactivity
- **D-09:** Use mode-keyed remount — add the current mode as a `key` prop on chart containers so toggling mode forces a full re-render. Charts pick up new CSS variable values on remount.

### Claude's Discretion
- Light variant color palette design for each theme — matching accent colors while maintaining readability
- Whether to keep or remove the Settings page mode Switch after adding the header toggle
- Exact sun/moon icon choice and placement in the nav header
- FOUC script implementation details
- Order of implementation (token sets first vs toggle first)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Theming system
- `src/index.css` — All CSS custom property token sets (.theme-default, .theme-midnight, .theme-graphite, .theme-stone, .theme-daylight, .light). The source of truth for color tokens.
- `src/lib/appearance.ts` — Mode and font theme utilities (applyMode, getStoredMode, saveModeTheme). The active mode system.
- `tailwind.config.ts` — Tailwind dark mode config (`darkMode: ["class"]`) and CSS variable mappings.

### Theme provider
- `src/components/ThemeProvider.tsx` — next-themes wrapper (dormant — do not activate as class driver).
- `src/App.tsx` lines 43-48 — `AppearanceInitializer` component that applies stored mode/font on mount.

### Settings page
- `src/pages/Settings.tsx` — Current appearance section with mode Switch and theme Select. Lines 47-52 for theme options, lines 521-534 for mode toggle.

### Requirements
- `.planning/REQUIREMENTS.md` — THEME-01, THEME-02, THEME-03 requirements for this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `applyMode()` / `getStoredMode()` / `saveModeTheme()` in `appearance.ts` — complete mode persistence and application logic, ready to use.
- `AppearanceInitializer` in `App.tsx` — already applies mode on mount, but uses `useEffect` (not blocking). Needs FOUC script to complement.
- 5 complete dark theme token sets in `index.css` — 4 will be kept, each needs a light counterpart.
- `theme-daylight` in `index.css` — full light token set that can serve as reference/starting point for the per-theme light variants.

### Established Patterns
- CSS custom properties via HSL values (e.g., `--primary: 214 100% 60%`) consumed by Tailwind's `hsl(var(--x))` pattern.
- Theme classes on `<html>` element (`theme-default`, `theme-midnight`, etc.) alongside mode classes (`light`, `dark`).
- `next-themes` provider wraps the app but `applyMode()` is the real driver — dual system, do not conflict.

### Integration Points
- Nav header (likely `src/components/Layout.tsx` or similar) — where the sun/moon toggle button will be added.
- `index.html` — where the FOUC-preventing blocking script must be injected.
- `src/pages/Reports.tsx` and any page with Recharts — where mode-keyed remount needs to be applied to chart containers.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for the light variant palettes.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 13-dark-mode-foundation*
*Context gathered: 2026-03-30*
