# 0003 — ISO timestamps written by app code

Status: Accepted (2026-10-09)

## Context

Columns declared `DEFAULT CURRENT_TIMESTAMP` store `YYYY-MM-DD HH:MM:SS` (UTC, no zone) while
application code wrote ISO-8601 (`YYYY-MM-DDTHH:MM:SS.sssZ`). Mixed formats break text
comparison and sorting (a space sorts before `T`, so the day's first tickets fell outside a
`dateFrom` filter), and the browser's `new Date('2026-10-09 09:06:02')` parses the SQLite form
as **local** time, shifting displayed clock times. SQLite cannot change a column default
without rebuilding the table, and prod (upgraded ALTER by ALTER) and fresh installs must keep
identical schemas (`server/src/db/schema-path-parity.test.ts`).

## Decision

- **App code always writes ISO timestamps explicitly** — `new Date().toISOString()` — and never
  relies on `CURRENT_TIMESTAMP` or `datetime('now')` defaults for values it will later compare
  or display.
- Existing rows were normalised once by migration `073` (`normalize_sqlite_timestamps_to_iso`),
  which rewrites only values that match the SQLite format and leaves ISO values untouched.
- The remaining `DEFAULT CURRENT_TIMESTAMP` clauses stay in `schema.sql` as a safety net for
  raw inserts; they are not removed because that needs table rebuilds on every affected table.
- Triggers that stamp `updated_at` use `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  (migration `072`, which also narrowed the ticket trigger to content columns so bookkeeping
  updates no longer bump `updated_at`).
- Queries that bound by date compare `YYYY-MM-DD` text prefixes (`server/src/lib/ticketQuery.ts`),
  which works for both formats and lets indexes be used.

## Consequences

- Text comparison, `ORDER BY` and range filters on timestamp columns are correct without
  `datetime()` wrappers; the frontend can pass values to `new Date()` safely.
- A route that inserts without a timestamp and takes the column default will reintroduce the
  old format. `server/src/db/timestampFormat.test.ts` creates a ticket, comment, history and
  audit row through the real routes and asserts the ISO shape — extend it when adding a table
  that app code writes to.
- Rule for contributors, also recorded in `CLAUDE.md`: write `new Date().toISOString()`, never
  `CURRENT_TIMESTAMP`.
