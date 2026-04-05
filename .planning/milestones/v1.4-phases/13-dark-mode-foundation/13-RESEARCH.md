# Phase 13: Dark Mode Foundation - Research

**Researched:** 2026-03-30
**Domain:** CSS theming, FOUC prevention, React mode toggle, Recharts reactivity
**Confidence:** HIGH

## Summary

The project already has a robust custom theming system built on CSS custom properties (HSL values), class-based theme/mode selectors, and `applyMode()` in `appearance.ts` as the canonical mode driver. The 4 dark themes (Slate, Midnight, Graphite, Stone) are fully specified; the single `.light` block at line 519 of `index.css` is a generic fallback that does NOT compose with theme classes — it covers all themes with one neutral palette and lacks theme-specific accent colors. Per-decision D-01/D-03, this must be replaced by 4 per-theme light token sets (`.light .theme-default`, `.light .theme-midnight`, etc.).

The nav header (`Layout.tsx`) has both a mobile header bar and a desktop sticky header that currently only contain `GlobalSearch`. Adding a sun/moon icon button to either or both is low-risk and isolated. The Settings page already has a functional `Switch` toggle wired to `applyMode` + `saveModeTheme`. The FOUC problem is confirmed: `AppearanceInitializer` runs inside `useEffect`, meaning React must hydrate before the mode class is applied — a blocking `<script>` in `index.html` before the root div is the standard fix.

Recharts uses `hsl(var(--...))` strings evaluated at paint time. Because CSS custom properties are resolved by the browser when the element is painted, toggling the mode class on `<html>` does NOT automatically force Recharts SVG elements to repaint with new resolved values. The mode-keyed remount strategy (D-09) is the correct fix: adding `key={mode}` to the `ResponsiveContainer` or its wrapping `div` in `Reports.tsx` causes React to unmount and remount the chart tree, forcing a fresh paint pass with the updated CSS variable values.

**Primary recommendation:** Implement in order: (1) per-theme light token sets in `index.css`, (2) FOUC-blocking script in `index.html`, (3) sun/moon toggle in `Layout.tsx` header, (4) `key={mode}` on chart containers in `Reports.tsx`, (5) remove `theme-daylight` from `themeOptions` in `Settings.tsx`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Per-theme light variants. Each of the 4 dark themes (Slate, Midnight, Graphite, Stone) gets a corresponding light variant with matching accent colors. 4 themes x 2 modes = 8 token sets total.
- **D-02:** Remove the Daylight theme entirely — it becomes redundant once every theme has its own light variant.
- **D-03:** The existing incomplete `.light` class block in `index.css` (line 519) is replaced by per-theme light token sets (e.g., `.light .theme-default`, `.light .theme-midnight`, etc.).
- **D-04:** `applyMode()` in `appearance.ts` remains the active mode system. Do NOT activate next-themes as the class driver — keep it dormant.
- **D-05:** A sun/moon icon button in the nav header toggles between light and dark mode. Single click, no dropdown.
- **D-06:** The color theme picker (Slate, Midnight, Graphite, Stone) stays in the Settings page under Appearance. Not exposed in the header.
- **D-07:** The existing Switch toggle in Settings can remain as a secondary way to toggle mode, or be replaced — Claude's discretion.
- **D-08:** A blocking `<script>` in `index.html` reads `localStorage` for the stored mode and applies the class to `<html>` before React hydrates.
- **D-09:** Use mode-keyed remount — add the current mode as a `key` prop on chart containers so toggling mode forces a full re-render.

### Claude's Discretion
- Light variant color palette design for each theme — matching accent colors while maintaining readability
- Whether to keep or remove the Settings page mode Switch after adding the header toggle
- Exact sun/moon icon choice and placement in the nav header
- FOUC script implementation details
- Order of implementation (token sets first vs toggle first)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| THEME-01 | Alla CSS-tokens i .light-blocket är kompletta (inga dark-fallbacks i light mode) | Replace generic `.light {}` with 4 per-theme `.light .theme-X {}` blocks, each inheriting its dark counterpart's accent colors mapped to light backgrounds |
| THEME-02 | Synlig tema-toggle i header-navigationen | Add `Sun`/`Moon` icon Button to both mobile header bar and desktop sticky header in `Layout.tsx`; wire to `applyMode` + `saveModeTheme` + local state |
| THEME-03 | Ingen FOUC vid sidladdning (blocking script i index.html) | Inline `<script>` before `<div id="root">` reads `localStorage.getItem('app-mode-theme')` and applies the mode class to `document.documentElement` synchronously |
</phase_requirements>

---

## Standard Stack

### Core (already in project — no new installs needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS | existing | `darkMode: ["class"]` already configured | Class-based dark mode, CSS var `hsl()` wrappers work out of the box |
| lucide-react | existing | `Sun` and `Moon` icons for toggle button | Already used throughout, consistent with project icon language |
| Recharts | existing | `BarChart`, `ResponsiveContainer`, `Cell` in Reports.tsx | Already in use, mode-keyed remount is the fix |

### No new packages required
All tooling for this phase exists. No `npm install` needed.

---

## Architecture Patterns

### CSS Token Specificity Model
The project uses a two-class system on `<html>`:
- **Mode class** (`dark` or `light`) — set by `applyMode()`
- **Theme class** (`theme-default`, `theme-midnight`, `theme-graphite`, `theme-stone`) — set by next-themes (dormant) or manually

The current `.light {}` block overrides ALL themes equally. Per-theme light variants require higher specificity using compound selectors:

```css
/* Pattern: .light .theme-X overrides plain :root / .theme-X */
.light .theme-default {
  --background: 210 20% 98%;
  --primary: 214 100% 50%;      /* Keep theme accent, adjust lightness */
  /* ... all tokens */
}

.light .theme-midnight {
  --background: 230 35% 97%;
  --primary: 243 75% 55%;       /* Midnight indigo, adapted for light bg */
  /* ... all tokens */
}
```

**Specificity:** `.light .theme-default` (0,2,0) beats `.theme-default` (0,1,0) and `:root` (0,1,0). This is exactly how it should cascade.

### Token Completeness for THEME-01
The existing `.light {}` block covers:
- `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`
- `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`
- `--destructive`, `--destructive-foreground`
- `--border`, `--input`
- Status/priority colors (same as dark — kept identical)
- Sidebar tokens
- Chart colors
- Shadow tokens

Missing from current `.light {}` (tokens defined in dark themes but absent in light):
- `--primary`, `--primary-foreground` (critical — buttons will fall through to dark theme value)
- `--accent`, `--accent-foreground`
- `--ring`
- `--radius` (each theme sets this differently)
- `--background-gradient` (the linear-gradient body background)
- `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-ring`
- All `--search-glow-*` tokens
- `--search-input-bg`
- `--success`, `--success-foreground`
- `--app-font-family` (should remain as set by font class, not overridden per mode)

Each per-theme light block must define ALL of the above. The `.theme-daylight` source in `index.css` (lines 374–459) is the reference implementation for a complete light token set and should guide the structure.

### FOUC Prevention Script (THEME-03)
**Pattern:** Inline blocking script in `<head>` before React bundle loads.

```html
<!-- index.html — inside <head>, before </head> -->
<script>
  (function() {
    try {
      var mode = localStorage.getItem('app-mode-theme');
      var validMode = (mode === 'light' || mode === 'dark') ? mode : 'dark';
      document.documentElement.classList.add(validMode);
    } catch (e) {}
  })();
</script>
```

**Why IIFE + try/catch:** Protects against environments where `localStorage` is unavailable (e.g., private browsing in some browsers, or SSR hypotheticals). Falls back silently to `dark` (the app default).

**Key insight:** `AppearanceInitializer` in `App.tsx` runs `applyMode(getStoredMode())` in `useEffect`, which is too late (after paint). The script runs synchronously before the DOM is painted. Both can coexist — the FOUC script is the initial paint gate; `AppearanceInitializer` is a safety sync after hydration. No conflict.

**Font theme:** The same script can optionally also restore the font class to avoid font FOUC. However, CONTEXT.md scopes this phase to mode only, so the font is Claude's discretion.

### Nav Toggle Placement (THEME-02)
`Layout.tsx` has two header zones:

1. **Mobile header** (line 250–261): `flex items-center gap-4` row with `Menu` button and `GlobalSearch`
2. **Desktop header** (line 263–268): sticky `hidden lg:block` bar with `max-w-md` `GlobalSearch`

The toggle should appear in both — end of the flex row in mobile, right side of desktop header. Pattern:

```tsx
// In Layout.tsx — import state from appearance.ts
import { Sun, Moon } from 'lucide-react';
import { applyMode, getStoredMode, saveModeTheme, ModeTheme } from '@/lib/appearance';

// In Layout component:
const [mode, setMode] = useState<ModeTheme>(getStoredMode);

const handleModeToggle = () => {
  const next: ModeTheme = mode === 'dark' ? 'light' : 'dark';
  setMode(next);
  applyMode(next);
  saveModeTheme(next);
};

// Button:
<Button variant="ghost" size="icon" onClick={handleModeToggle} aria-label="Byt läge">
  {mode === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
</Button>
```

**State note:** `Layout.tsx` does not currently use appearance state. This adds minimal state (one `useState`). No context/provider needed — `applyMode()` is side-effectful directly on `document.documentElement`.

### Recharts Mode-Keyed Remount (D-09)
Recharts SVG elements capture colors at paint time. CSS variable updates to `<html>` are not automatically observed by existing SVG paint commands.

**Pattern:** Pass current mode as `key` to the wrapping element of each chart:

```tsx
// Reports.tsx — propagate mode into component
const mode = getStoredMode(); // or pass as prop / read from context

// Wrapping each chart:
<div key={mode}>
  <ResponsiveContainer width="100%" height={200}>
    <BarChart data={...}>
      ...
    </BarChart>
  </ResponsiveContainer>
</div>
```

**Concern:** `getStoredMode()` reads `localStorage` at render time — it will return the current mode but will NOT re-render when mode changes unless `mode` is reactive. Reports.tsx needs to subscribe to mode changes. Two options:
1. Pass `mode` as a prop from `Layout` through page routing (complex, not viable)
2. Create a lightweight mode hook using a custom event or `localStorage` listener (preferred)

**Recommended pattern — custom hook:**
```tsx
// src/hooks/useMode.ts
import { useState, useEffect } from 'react';
import { getStoredMode, ModeTheme } from '@/lib/appearance';

export function useMode(): ModeTheme {
  const [mode, setMode] = useState<ModeTheme>(getStoredMode);
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'app-mode-theme') {
        setMode((e.newValue as ModeTheme) ?? 'dark');
      }
    };
    window.addEventListener('storage', e => {
      if (e.key === 'app-mode-theme') setMode((e.newValue as ModeTheme) ?? 'dark');
    });
    return () => window.removeEventListener('storage', handler);
  }, []);
  return mode;
}
```

**Caveat:** `StorageEvent` only fires when `localStorage` is changed from a DIFFERENT tab, not the same tab. For same-tab reactivity, a custom DOM event is more reliable:

```typescript
// In saveModeTheme (or handleModeToggle):
window.dispatchEvent(new CustomEvent('app-mode-change', { detail: mode }));

// In useMode hook:
window.addEventListener('app-mode-change', handler);
```

Alternatively, since `Reports.tsx` is only one page, a simpler approach is for `Reports.tsx` to call `getStoredMode()` inside a `useState` initializer and listen for a custom event. The chart `key` then references this reactive mode value.

### Settings Page Cleanup (D-02, D-07)
- Remove `{ value: 'theme-daylight', label: 'Daylight' }` from `themeOptions` array (line 47–53 in Settings.tsx)
- Update `ThemeProvider` `themes` prop in `App.tsx` to remove `"theme-daylight"`
- Optionally remove `.theme-daylight {}` token block from `index.css` (keep for now to avoid breaking users already stored in `theme-daylight` — code will gracefully fall through to `:root` dark defaults)
- The Settings Switch can remain as a secondary control (no harm, minimal code)

### Anti-Patterns to Avoid
- **Activating next-themes as class driver:** ThemeProvider `attribute="class"` is set but `enableSystem={false}` keeps it passive. Do NOT change this or call `setTheme()` from next-themes for the mode — conflicts with `applyMode()`.
- **Using `prefers-color-scheme` media query:** The system uses explicit user choice stored in localStorage, not OS preference. Do not introduce media-query-driven dark mode.
- **CSS-only dark mode (Tailwind's `media` strategy):** The config correctly uses `class` strategy. Do not change this.
- **Missing `--primary` in light token sets:** The current `.light {}` block omits `--primary` and `--accent`. This is the root cause of broken button colors in light mode (THEME-01 scope). Every per-theme light block must define these.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Mode persistence | Custom storage layer | `saveModeTheme()` / `getStoredMode()` already in `appearance.ts` |
| Mode class application | Direct DOM manipulation in components | `applyMode()` already in `appearance.ts` |
| Sun/Moon icons | SVG assets | `lucide-react` `Sun` and `Moon` components |
| Color token architecture | Custom theming library | CSS custom properties + Tailwind class strategy already in place |
| FOUC prevention | Complex service worker | Inline blocking `<script>` in `index.html` (standard, proven) |

**Key insight:** The mode infrastructure is complete. This phase is entirely about filling in missing tokens and wiring existing utilities to new UI surfaces.

---

## Common Pitfalls

### Pitfall 1: Missing Tokens in Light Variants
**What goes wrong:** Light mode renders with dark colors for buttons, rings, accents — visually broken even though backgrounds are light.
**Why it happens:** The existing `.light {}` block omits `--primary`, `--primary-foreground`, `--accent`, `--accent-foreground`, `--ring`. CSS falls through to the outer `.theme-X {}` dark values.
**How to avoid:** Use `.theme-daylight {}` as a checklist — it defines every token. Ensure each per-theme light block defines the same set.
**Warning signs:** Blue/dark button on light background at first render; bright text on bright background.

### Pitfall 2: FOUC Script Fires After Body Paint
**What goes wrong:** Page still flashes light on dark or dark on light for ~100ms.
**Why it happens:** Script placed after `<div id="root">` or inside `<body>` at the bottom instead of `<head>`.
**How to avoid:** Place the `<script>` block inside `<head>`, before `</head>`. It MUST run before the browser begins painting.

### Pitfall 3: Recharts Mode Key Not Reactive
**What goes wrong:** Charts don't update after toggle because the `key` value never changes from the component's perspective.
**Why it happens:** `key={getStoredMode()}` called at render returns the initial value, not reactive state.
**How to avoid:** Use reactive state (`useState` + custom event listener). The `key` must reference a state variable that updates when mode changes.

### Pitfall 4: next-themes Interference
**What goes wrong:** After adding the toggle, the page may flicker or revert to the wrong theme class on navigation.
**Why it happens:** `ThemeProvider` with `attribute="class"` can overwrite classes set by `applyMode()` on re-render or route change.
**How to avoid:** Keep `ThemeProvider` configuration unchanged (D-04). The `defaultTheme="theme-default"` in `App.tsx` refers to the color theme (not mode). Verify next-themes is not also trying to manage `light`/`dark` classes after changes.

### Pitfall 5: Daylight Theme Still Selected by Existing User
**What goes wrong:** User previously selected Daylight; after removal, theme class `theme-daylight` persists in localStorage. Component shows blank/fallback styles.
**Why it happens:** Removing `theme-daylight` from the picker doesn't clear stored values.
**How to avoid:** The `:root` / `.theme-default` token set already serves as fallback — browser does not error if the class has no matching CSS block. The visual will simply be Slate dark. Optionally, add a migration in `AppearanceInitializer` that maps `theme-daylight` to `theme-default`.

### Pitfall 6: Light Mode `--background-gradient` Not Set
**What goes wrong:** Body background in light mode is a flat white or falls back to dark gradient.
**Why it happens:** Each dark theme sets `--background-gradient` with a specific linear-gradient. The `.light` block omits it.
**How to avoid:** Each per-theme light block must define `--background-gradient` with a light variant (e.g., near-white gradient). Reference `.theme-daylight`'s gradient as a starting point.

---

## Code Examples

### Per-Theme Light Block Structure (reference)
```css
/* Source: .theme-daylight in src/index.css — complete light token reference */
.light .theme-default {
  --background: 210 18% 98%;
  --background-gradient: linear-gradient(135deg, hsl(210, 18%, 98%) 0%, hsl(215, 16%, 96%) 100%);
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 214 100% 50%;           /* Slate blue — lighter L for light bg */
  --primary-foreground: 0 0% 100%;
  --secondary: 220 15% 93%;
  --secondary-foreground: 222 47% 20%;
  --muted: 220 14% 93%;
  --muted-foreground: 220 12% 48%;
  --accent: 199 85% 48%;             /* Cyan accent — adjusted L */
  --accent-foreground: 0 0% 100%;
  --destructive: 0 70% 50%;
  --destructive-foreground: 0 0% 100%;
  --border: 220 15% 86%;
  --input: 220 15% 91%;
  --ring: 214 100% 50%;
  --radius: 0.625rem;                /* Same as dark theme-default */
  /* ... sidebar, chart, shadow, search-glow tokens */
}
```

### FOUC Prevention Script
```html
<!-- Source: Standard FOUC prevention pattern for class-based dark mode -->
<!-- index.html — inside <head> -->
<script>
  (function() {
    try {
      var mode = localStorage.getItem('app-mode-theme');
      document.documentElement.classList.add(
        (mode === 'light' || mode === 'dark') ? mode : 'dark'
      );
    } catch (e) {}
  })();
</script>
```

### Nav Toggle Button
```tsx
// Source: project pattern — Button from shadcn/ui, lucide icons
// In Layout.tsx desktop header:
<div className="hidden lg:block sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50 p-4 shadow-sm">
  <div className="flex items-center justify-between">
    <div className="max-w-md flex-1">
      <GlobalSearch tickets={tickets} users={users} categories={categories} tags={tags} />
    </div>
    <Button variant="ghost" size="icon" onClick={handleModeToggle} aria-label="Byt läge">
      {mode === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  </div>
</div>
```

### Chart Remount Pattern
```tsx
// Source: React key-based remount idiom
// In Reports.tsx — using reactive mode
const mode = useMode(); // custom hook with custom event listener

// Wrapping each ResponsiveContainer:
<div key={mode}>
  <ResponsiveContainer width="100%" height={200}>
    <BarChart data={ticketsByPriority} ...>
      ...
    </BarChart>
  </ResponsiveContainer>
</div>
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Single `.light` block overriding all themes | Per-theme `.light .theme-X` compound selectors | Theme-specific accent colors preserved in light mode |
| `useEffect` mode application (FOUC possible) | Blocking `<script>` in `index.html` | Zero flash on reload |
| Recharts reads CSS vars at mount only | `key={mode}` forces remount on toggle | Charts reflect mode change without page reload |

---

## Open Questions

1. **Font FOUC**
   - What we know: `AppearanceInitializer` also restores font theme via `useEffect` — same FOUC risk as mode
   - What's unclear: Is font FOUC in scope for this phase?
   - Recommendation: Include font restoration in the blocking script as a 2-line addition — minimal effort, same technique

2. **Settings page Switch after header toggle is added**
   - What we know: Both will work independently (each calls `applyMode` + `saveModeTheme`)
   - What's unclear: User preference for keeping or removing the redundant Settings Switch
   - Recommendation: Keep it — it causes no harm, and removing it is extra change with no functional gain

3. **Recharts custom event vs StorageEvent approach**
   - What we know: `StorageEvent` does not fire for same-tab writes; custom events do
   - What's unclear: Whether the planner wants a `useMode` hook as a shared utility or inline logic in Reports.tsx
   - Recommendation: Create `src/hooks/useMode.ts` as a reusable hook — it will also be needed for any other component that needs to respond to mode changes (e.g., Dashboard in Phase 14)

---

## Environment Availability

Step 2.6: SKIPPED — this phase is CSS token authoring, HTML script injection, and React component wiring. No external tools, services, or CLIs required beyond the existing project stack.

---

## Sources

### Primary (HIGH confidence)
- Direct code reading: `src/index.css` — full token structure for all 5 theme blocks and existing `.light` block
- Direct code reading: `src/lib/appearance.ts` — complete mode utility implementation
- Direct code reading: `src/components/Layout.tsx` — header structure, state, existing imports
- Direct code reading: `src/App.tsx` — `AppearanceInitializer` useEffect pattern, ThemeProvider config
- Direct code reading: `src/pages/Reports.tsx` — COLORS array, chart structure, Tooltip contentStyle
- Direct code reading: `src/pages/Settings.tsx` — existing mode Switch, themeOptions
- Direct code reading: `index.html` — current structure, no blocking script present
- Direct code reading: `tailwind.config.ts` — `darkMode: ["class"]` confirmed

### Secondary (MEDIUM confidence)
- CSS specificity rules: compound selectors `.light .theme-X` (0,2,0) reliably override `.theme-X` (0,1,0) — standard CSS cascade behavior
- React `key` remount behavior: documented React behavior, HIGH confidence
- `StorageEvent` same-tab limitation: well-documented browser behavior, HIGH confidence

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already in the project, versions verified by direct inspection
- Architecture: HIGH — all patterns derived from existing code structure, not hypothetical
- Pitfalls: HIGH — identified by code inspection (missing tokens confirmed by reading existing `.light` block)

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable — no external dependencies changing)
