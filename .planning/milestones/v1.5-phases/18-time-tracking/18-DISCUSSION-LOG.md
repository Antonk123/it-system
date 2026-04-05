# Phase 18: Time Tracking - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-05
**Phase:** 18-time-tracking
**Areas discussed:** Time entry UI, Time display, Reports Tid tab, Data model

---

## Time Entry Input

| Option | Description | Selected |
|--------|-------------|----------|
| Minutes only | Simple number input in minutes (e.g. 45). Clean and fast. | |
| Hours + minutes | Two inputs: hours and minutes (e.g. 1h 30m). | |
| Free-text parsing | Single input that parses '1h 30m', '90min', '1.5h' etc. | ✓ |

**User's choice:** Free-text parsing
**Notes:** Most flexible input method — single field handles all duration formats.

## Time Entry Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Sidebar section | Dedicated 'Tid' section in the right sidebar, similar to KB Links. | ✓ |
| Inline in main content | Below comments/notes in the main content area. | |
| Dialog/modal | Button that opens a dialog for logging time. | |

**User's choice:** Sidebar section
**Notes:** Consistent with existing sidebar pattern (KB Links).

## Time Display - Total Summary

| Option | Description | Selected |
|--------|-------------|----------|
| Header badge | Show total time as a badge/chip in the time section header. | |
| Summary card | Small card above the time entries list showing total + entry count. | |
| Inline text | Simple 'Totalt: 2h 15m' text above the entries list. | |

**User's choice:** "You decide" — Claude's discretion
**Notes:** User deferred to Claude for styling decisions.

## Time Display - Entry List

| Option | Description | Selected |
|--------|-------------|----------|
| Compact list | Each entry as a single row: duration — date — note. Hover reveals delete. | |
| Card per entry | Small card for each entry with duration prominent. | |
| Timeline style | Entries as a vertical timeline with dates as markers. | |

**User's choice:** "You decide" — Claude's discretion
**Notes:** User deferred to Claude for styling decisions.

## Reports Tid Tab - Charts

| Option | Description | Selected |
|--------|-------------|----------|
| Category breakdown + top tickets | Bar chart of time per category + table of top 10 tickets by time spent. | ✓ |
| Full dashboard | Category breakdown + top tickets + monthly trend + daily heatmap. | |
| Minimal | Just the two required views as simple tables, no charts. | |

**User's choice:** Category breakdown + top tickets
**Notes:** Matches success criteria directly, no extra charts needed.

## Reports Tid Tab - Date Filter

| Option | Description | Selected |
|--------|-------------|----------|
| Shared filter | Uses the existing date range picker at top of Reports. | ✓ |
| Own filter | Separate date picker within the Tid tab. | |

**User's choice:** Shared filter (Recommended)
**Notes:** Consistent UX with other tabs, less code.

## Data Model - Precision

| Option | Description | Selected |
|--------|-------------|----------|
| Minutes | Store as integer minutes in DB. | ✓ |
| Seconds | Store as integer seconds. | |

**User's choice:** Minutes
**Notes:** Sufficient for IT ticket work without a live timer.

## Data Model - User Field

| Option | Description | Selected |
|--------|-------------|----------|
| Skip user field | Single-user system — no need for user_id column. | ✓ |
| Include user_id | Add user_id for future-proofing. | |

**User's choice:** Skip user field
**Notes:** Single-user system, no future-proofing needed.

## Claude's Discretion

- Time display total summary styling
- Individual time entry list layout
- Both should be consistent with existing sidebar section patterns (KBLinksSection)

## Deferred Ideas

- TIME-F01: Live start/stop timer (already in REQUIREMENTS.md deferred section)
- TIME-F02: Quick-select chip buttons (already in REQUIREMENTS.md deferred section)
