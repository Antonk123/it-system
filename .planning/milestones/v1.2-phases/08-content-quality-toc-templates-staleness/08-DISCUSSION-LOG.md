# Phase 08: Content Quality — ToC, Templates & Staleness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-29
**Phase:** 08-content-quality-toc-templates-staleness
**Areas discussed:** ToC placement, Template selection UX, Staleness threshold, Template content
**Mode:** --auto (all decisions auto-selected as recommended defaults)

---

## ToC Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Sticky sidebar | Right-side sidebar on desktop, collapses on mobile | ✓ |
| Inline above content | Collapsible section at top of article | |
| Floating mini-nav | Small floating widget | |

**User's choice:** [auto] Sticky sidebar on desktop, collapsible above content on mobile
**Notes:** Matches documentation site conventions. HtmlRenderer already allows all heading tags.

---

## Template Selection UX

| Option | Description | Selected |
|--------|-------------|----------|
| Card picker on new article | Cards above form, only shown for new articles | ✓ |
| Dropdown in form | Template select dropdown alongside other fields | |
| Step wizard | Template selection as first step before form loads | |

**User's choice:** [auto] Card picker on new article creation
**Notes:** Simple, non-intrusive. Dismissed to start blank.

---

## Staleness Threshold

| Option | Description | Selected |
|--------|-------------|----------|
| 90 days | Standard for internal IT docs | ✓ |
| 60 days | More aggressive review cycle | |
| 180 days | Relaxed for stable content | |

**User's choice:** [auto] 90 days
**Notes:** Reasonable default. Can be made configurable later if needed.

---

## Template Content

| Option | Description | Selected |
|--------|-------------|----------|
| 3 templates (Solution, How-to, Troubleshooting) | Covers standard IT documentation | ✓ |
| 2 templates (Solution, How-to) | Minimal set | |

**User's choice:** [auto] 3 templates with Swedish headings
**Notes:** Templates defined as frontend constants per out-of-scope ruling on Mall-CRUD.

## Claude's Discretion

- ToC scroll-spy behavior
- Template picker card styling
- Stale badge color/icon

## Deferred Ideas

None.
