# Phase 10: KB Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 10-kb-cleanup
**Areas discussed:** Database cleanup depth, Template removal strategy, Token refresh behavior, Removal verification

---

## Database Cleanup Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Full removal | Drop view_count column from DB, remove API increment endpoint, remove all UI display | ✓ |
| UI/API only | Keep column in DB but remove all frontend display and API increment | |
| Soft remove | Just hide from UI, keep API and column intact | |

**User's choice:** Full removal
**Notes:** Clean cut — no dead code left behind.

### Follow-up: Popular articles endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| Drop everything | Remove /api/kb/articles/popular endpoint, KnowledgeBase.tsx section, and any sorting by view_count | ✓ |
| Keep endpoint, change metric | Replace view_count ranking with something else | |

**User's choice:** Drop everything

### Follow-up: Senast uppdaterade endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| Remove both | Drop the API endpoint and the UI section | ✓ |
| Keep API, remove UI | The endpoint stays for potential future use | |

**User's choice:** Remove both

### Follow-up: Column drop strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Leave column, strip usage | Column stays in DB but is never read, written, or returned. schema.sql omits it for fresh installs | ✓ |
| Table rebuild migration | CREATE new table without column, copy data, drop old, rename | |
| You decide | Claude picks safest approach | |

**User's choice:** Leave column, strip usage
**Notes:** Zero migration risk. Future fresh installs won't have the column.

---

## Template Removal Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Seed + live DB delete | Remove from seed-templates.ts AND add migration to delete rows from live DB | ✓ |
| Seed only | Remove from seed data, existing DB keeps them | |
| You decide | Claude picks based on article references | |

**User's choice:** Seed + live DB delete

### Follow-up: Orphaned ticket references

| Option | Description | Selected |
|--------|-------------|----------|
| Null out template_id | Set template_id to NULL on affected tickets before deleting templates | ✓ |
| Leave as orphan | Delete templates without updating tickets | |
| You decide | Claude checks usage and picks accordingly | |

**User's choice:** Null out template_id

---

## Token Refresh Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Last API call | Any authenticated request resets the 7-day clock | ✓ |
| Last explicit login | 7 days from last password entry | |
| You decide | Claude picks based on current implementation | |

**User's choice:** Last API call

### Follow-up: Expired refresh UX

| Option | Description | Selected |
|--------|-------------|----------|
| Silent redirect to login | Redirect to /login with no error toast | ✓ |
| Toast + redirect | Show 'Session expired' toast, then redirect | |
| You decide | Claude picks smoothest UX | |

**User's choice:** Silent redirect to login

### Follow-up: Current pain point

| Option | Description | Selected |
|--------|-------------|----------|
| Access token expires too fast | JWT expires and refresh doesn't kick in silently | ✓ |
| Refresh token not working | Refresh endpoint errors or isn't called | |
| Not sure, just fix it | Claude investigates and fixes | |

**User's choice:** Access token expires too fast

---

## Removal Verification

| Option | Description | Selected |
|--------|-------------|----------|
| Code review + manual spot-check | Claude verifies via grep, user does visual check after deploy | ✓ |
| Automated assertions | Add assertions for removed endpoints and UI elements | |
| You decide | Claude picks appropriate verification level | |

**User's choice:** Code review + manual spot-check

### Follow-up: Data preservation

| Option | Description | Selected |
|--------|-------------|----------|
| No, just delete | Data has no value, remove without backup | ✓ |
| Export view counts first | Dump view_count values to file | |
| You decide | Claude assesses worth | |

**User's choice:** No, just delete

---

## Claude's Discretion

- Token expiry durations (access + refresh) — values that satisfy the 7-day requirement
- Order of CLEAN-XX removals
- Commit granularity (combined vs atomic per removal)

## Deferred Ideas

None — discussion stayed within phase scope.
