# Phase 14: Dashboard Overview - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-31
**Phase:** 14-dashboard-overview
**Areas discussed:** Panel layout & placement, Aging tickets ranking, Today summary format

---

## Panel Layout & Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Below KPI cards, full-width stacked | Keep existing KPI grid. Three new panels stack vertically below. | ✓ |
| Two-column grid below KPIs | Aging (left) + today/reminders stacked (right). | |
| Replace secondary stats row | Remove Arkiverade card, put today summary in its place. | |

**User's choice:** Full-width stacked below KPI cards.

**Follow-up: Panel order**

| Option | Description | Selected |
|--------|-------------|----------|
| Aging → Today → Reminders | Most urgent first. | |
| Today → Aging → Reminders | Daily briefing first. | ✓ |
| You decide | Claude picks. | |

**User's choice:** Today → Aging → Reminders. Later revised to Aging → Reminders only (today summary merged into KPI cards).

---

## Aging Tickets Ranking

| Option | Description | Selected |
|--------|-------------|----------|
| Days since last status change or comment | Most accurate "stale" measure. | ✓ |
| Days since creation | Simpler but less accurate. | |
| Days since last modification (updated_at) | Catches all changes, may be noisy. | |

**User's choice:** Days since last status change or comment.

**Follow-up: Count and display**

| Option | Description | Selected |
|--------|-------------|----------|
| Top 5, compact rows | Title, age, priority, requester. "Visa alla" link. | ✓ |
| Top 10, table-style | More rows with status column. | |
| All, scrollable | No cap, scrollable container. | |

**User's choice:** Top 5 compact rows with "Visa alla" link.

---

## Today Summary Format

| Option | Description | Selected |
|--------|-------------|----------|
| Compact stat row | Horizontal strip: "Skapade: 2 | Lösta: 1 | Stängda: 3" | |
| Panel with mini-list | Counts + list of today's tickets below. | |
| Merge into KPI cards | Add "idag" sub-label on existing KPI cards. No new panel. | ✓ |

**User's choice:** Merge into existing KPI cards. This eliminates the need for a separate "Today" panel.

---

## Claude's Discretion

- Skeleton loading placeholder design
- Number of reminders to show
- Visual design of aging ticket rows
- "Visa alla" link destination
- How "idag" count renders on KPI cards

## Deferred Ideas

None — discussion stayed within phase scope.
