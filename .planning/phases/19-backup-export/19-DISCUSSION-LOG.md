# Phase 19: Backup & Export - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-05
**Phase:** 19-backup-export
**Areas discussed:** Backup trigger UX, Backup contents, Safety & performance

---

## Backup Trigger UX

### Button Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Own section | A dedicated 'Backup & Export' section in Settings with a prominent download button and last-backup timestamp | ✓ |
| Simple button | Just a download button at the bottom of the existing Settings page, minimal UI | |
| You decide | Claude picks the best placement based on the existing Settings layout | |

**User's choice:** Own section (Recommended)
**Notes:** None

### File Naming

| Option | Description | Selected |
|--------|-------------|----------|
| it-ticket-backup-{date}.zip | Includes the date stamp for easy identification | ✓ |
| backup-{timestamp}.zip | Short name with full ISO timestamp for uniqueness | |
| You decide | Claude picks a sensible naming convention | |

**User's choice:** it-ticket-backup-{date}.zip
**Notes:** None

### Progress Feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Spinner + toast | Button shows spinner while generating, then a success toast with file size when download starts | ✓ |
| Simple disable | Button disables during generation, browser handles the download naturally | |
| You decide | Claude picks appropriate feedback level | |

**User's choice:** Spinner + toast (Recommended)
**Notes:** None

---

## Backup Contents

### ZIP Contents

| Option | Description | Selected |
|--------|-------------|----------|
| DB + uploads only | SQLite snapshot + all files from data/uploads/. Covers BKUP-01 exactly | ✓ |
| DB + uploads + manifest | Also include a manifest.json with backup date, file count, DB size, app version | |
| You decide | Claude picks what makes sense | |

**User's choice:** DB + uploads only (Recommended)
**Notes:** None

### ZIP Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Flat structure | database.sqlite at root + uploads/ folder. Mirrors data/ directory | |
| Timestamped root folder | Everything inside a backup-2026-04-05/ folder within the ZIP | |
| You decide | Claude picks the ZIP structure | ✓ |

**User's choice:** You decide
**Notes:** Claude's discretion on internal ZIP structure

---

## Safety & Performance

### Size Concerns

| Option | Description | Selected |
|--------|-------------|----------|
| Small system, no concern | Single-user system with modest data — no streaming or chunking needed | ✓ |
| Add size safeguards | Check total size before generating, warn if over a threshold | |

**User's choice:** Small system, no concern (Recommended)
**Notes:** None

### Auth Protection

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, require login | Only authenticated users can trigger backup — uses existing JWT middleware | ✓ |
| You decide | Claude applies sensible auth defaults | |

**User's choice:** Yes, require login (Recommended)
**Notes:** None

---

## Claude's Discretion

- ZIP internal folder structure (flat mirror of data/ directory recommended)

## Deferred Ideas

None — discussion stayed within phase scope
