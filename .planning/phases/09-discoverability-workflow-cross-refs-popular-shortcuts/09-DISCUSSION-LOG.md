# Phase 09: Discoverability & Workflow — Cross-refs, Popular, Shortcuts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-29
**Phase:** 09-discoverability-workflow-cross-refs-popular-shortcuts
**Areas discussed:** Popular articles, Cross-references, Keyboard shortcut, Ticket-to-KB creation
**Mode:** Auto (--auto flag — all defaults selected automatically)

---

## Popular Articles

| Option | Description | Selected |
|--------|-------------|----------|
| Top 5 by view_count | Matches "Senast uppdaterade" pattern | ✓ |
| Top 10 | More articles but may crowd the page | |
| Configurable count | Over-engineering for single user | |

**User's choice:** [auto] Top 5 by view_count (recommended default)
**Notes:** Consistent with existing "Senast uppdaterade" section showing 5 items. Only published articles with view_count > 0 shown.

---

## Cross-References ("Se även")

| Option | Description | Selected |
|--------|-------------|----------|
| Bidirectional display | If A→B, show B→A too (wiki-style) | ✓ |
| Directional only | Only show explicitly added links | |

**User's choice:** [auto] Bidirectional display (recommended default)
**Notes:** Storage is directional (one row) but queries fetch both directions. Link picker uses search/autocomplete dropdown similar to tag input.

---

## Keyboard Shortcut

| Option | Description | Selected |
|--------|-------------|----------|
| Global `/` with input exclusion | Standard pattern, suppressed in inputs | ✓ |
| KB page only | Only works on Knowledge Base page | |

**User's choice:** [auto] Global `/` with input exclusion (recommended default)
**Notes:** Standard keyboard shortcut convention. Suppressed when focused on text input, textarea, or contenteditable.

---

## Ticket-to-KB Creation

| Option | Description | Selected |
|--------|-------------|----------|
| Button in KBLinksSection | Contextually close to existing KB links | ✓ |
| Action bar button | Top-level action on ticket detail | |

**User's choice:** [auto] Button in KBLinksSection (recommended default)
**Notes:** Pre-fills title from ticket subject and sets article_type to 'solution'. Navigates to KBArticleForm with query params.

---

## Claude's Discretion

- Exact styling of "Se även" panel
- Popular section icon choice
- Link picker component details
- kbd hint near search input

## Deferred Ideas

None — discussion stayed within phase scope.
