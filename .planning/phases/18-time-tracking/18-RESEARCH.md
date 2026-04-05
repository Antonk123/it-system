# Phase 18: Time Tracking - Research

**Researched:** 2026-04-05
**Domain:** SQLite time logging, free-text duration parsing, React Query CRUD, Recharts bar chart
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Free-text duration parsing — single input that parses '1h 30m', '90min', '1.5h', '45m', '1t 30m' to integer minutes
- **D-02:** Time entry form lives in a dedicated sidebar section ("Tid") in ticket detail, similar to KBLinksSection. Compact, always visible.
- **D-03:** Total time summary and individual entry list styling — consistent with existing sidebar sections (KB Links pattern). (Claude's Discretion for exact styling)
- **D-04:** Reports Tid tab: bar chart of time per category + table of top 10 tickets by time spent. No extra charts.
- **D-05:** Shared date range filter — uses existing year/month pickers at top of Reports page. No separate filter.
- **D-06:** Store duration as integer minutes in DB. Display as formatted "Xh Ym" in UI.
- **D-07:** No user_id column on time_entries — single-user system.

### Claude's Discretion

- Time display styling (total summary + entry list layout)
- Entry list: duration, date, optional note per entry
- Delete button on hover (established pattern from KB links)

### Deferred Ideas (OUT OF SCOPE)

- **TIME-F01:** Live start/stop timer on ticket detail
- **TIME-F02:** Quick-select chip buttons for common durations (15m, 30m, 1h)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TIME-01 | User can log time on a ticket (duration in minutes + optional note) | Free-text parsing to integer minutes; POST /api/time-entries/:ticketId |
| TIME-02 | User can view list of time logs on a ticket with date and note | GET /api/time-entries/:ticketId; TimeSection list display |
| TIME-03 | User can delete a time log entry | DELETE /api/time-entries/:id; hover-reveal X button mutation |
| TIME-04 | User can see total time spent on a ticket in ticket detail | SUM(duration_minutes) in list query; formatDuration display |
| TIME-05 | User can view time breakdown by category in Reports ("Tid" tab) | SQL GROUP BY category; Recharts BarChart; new "tid" TabsTrigger |
| TIME-06 | User can view top tickets by time spent in Reports | SQL ORDER BY total_minutes DESC LIMIT 10; table display |
</phase_requirements>

---

## Summary

Phase 18 is a well-scoped feature addition: a new `time_entries` DB table, a backend CRUD route plus a reports query, a new `TimeSection` sidebar component following the KBLinksSection pattern, and a new "Tid" tab in Reports reusing existing Recharts infrastructure.

All five integration points are established patterns in the codebase. The genuinely novel work is: (1) the free-text duration parser (a pure utility function), (2) the `time_entries` table migration, and (3) the reports SQL query that aggregates time per category and per ticket. Everything else mirrors an existing component or route.

The date range filter for the Tid tab shares the existing `selectedYear` / `selectedMonth` state in `Reports.tsx` — no new state or UI needed. The Reports backend already accepts `year` and `month` query params; the new time-analytics endpoint must follow the same pattern.

**Primary recommendation:** Model TimeSection directly on KBLinksSection (React Query, useMutation, cache invalidation, hover-reveal delete). Add the duration parser as a pure utility function. Add the DB migration in `connection.ts` following the idempotent `ensureXxx` pattern.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | existing | Synchronous SQLite queries | Already used throughout server |
| @tanstack/react-query | existing | Server state, mutations, cache invalidation | All data fetching in project |
| recharts | existing | BarChart in Reports | Already imported in Reports.tsx |
| sonner | existing | Toast notifications | Used project-wide for feedback |
| lucide-react | existing | Icons (Clock, Trash2, Plus) | Consistent icon library |
| shadcn/ui | existing | Input, Button, Badge, Card | All UI primitives |
| date-fns | existing | Date formatting for entry timestamps | Already used in Reports.tsx |

No new dependencies required — everything needed is already installed.

---

## Architecture Patterns

### Recommended Project Structure

New files to create:
```
src/
  components/
    TimeSection.tsx          # Sidebar section (mirrors KBLinksSection)
  hooks/
    useTimeEntries.ts        # React Query hook for time entries CRUD
  lib/
    duration.ts              # Free-text duration parser + formatter
server/src/
  routes/
    time-entries.ts          # CRUD endpoints for time entries
```

Modifications to existing files:
```
src/
  pages/Reports.tsx          # Add "Tid" TabsTrigger + TabsContent
  lib/api.ts                 # Add TimeEntry typed methods
  types/ticket.ts            # Add TimeEntry / TimeEntryRow interfaces
server/src/
  db/connection.ts           # Add ensureTimeEntriesTable(), call in initializeDatabase()
  routes/reports.ts          # Add GET /time-summary endpoint
  index.ts                   # Mount /api/time-entries route
```

### Pattern 1: DB Migration (idempotent ensureXxx)

All new tables in this project are added via idempotent functions in `connection.ts`. Follow the established pattern:

```typescript
// server/src/db/connection.ts

const ensureTimeEntriesTable = () => {
  if (tableExists('time_entries')) return;
  db.prepare(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
      note TEXT CHECK(note IS NULL OR length(note) <= 500),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_time_entries_ticket ON time_entries(ticket_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_time_entries_created ON time_entries(created_at DESC)').run();
  console.log('Created missing table: time_entries');
};

// Add 'time_entries' to VALID_TABLE_NAMES Set (same object at top of file)
// Add ensureTimeEntriesTable() call inside initializeDatabase()
```

**Critical:** Add `'time_entries'` to the `VALID_TABLE_NAMES` Set at the top of `connection.ts`. The `columnExists()` guard will throw "unknown table" if this is missed.

### Pattern 2: Express Route File

The route file follows the project pattern — named Router export, `authenticate` middleware, synchronous better-sqlite3 queries, `randomUUID` for IDs:

```typescript
// server/src/routes/time-entries.ts
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

// GET /:ticketId — list entries + total (TIME-02, TIME-04)
router.get('/:ticketId', authenticate, (req: AuthRequest, res) => {
  const { ticketId } = req.params;
  const entries = db.prepare(`
    SELECT id, duration_minutes, note, created_at
    FROM time_entries
    WHERE ticket_id = ?
    ORDER BY created_at DESC
  `).all(ticketId);

  const row = db.prepare(`
    SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes
    FROM time_entries WHERE ticket_id = ?
  `).get(ticketId) as { total_minutes: number };

  res.json({ entries, total_minutes: row.total_minutes });
});

// POST /:ticketId — create entry (TIME-01)
router.post('/:ticketId', authenticate, (req: AuthRequest, res) => {
  const { ticketId } = req.params;
  const { duration_minutes, note } = req.body;
  if (!duration_minutes || typeof duration_minutes !== 'number' || duration_minutes <= 0) {
    res.status(400).json({ error: 'duration_minutes must be a positive integer' });
    return;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO time_entries (id, ticket_id, duration_minutes, note) VALUES (?, ?, ?, ?)
  `).run(id, ticketId, Math.round(duration_minutes), note || null);
  res.status(201).json({ id, ticket_id: ticketId, duration_minutes, note: note || null });
});

// DELETE /:ticketId/:id — delete one entry (TIME-03)
router.delete('/:ticketId/:id', authenticate, (req: AuthRequest, res) => {
  const { ticketId, id } = req.params;
  const result = db.prepare(
    'DELETE FROM time_entries WHERE id = ? AND ticket_id = ?'
  ).run(id, ticketId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  res.status(204).end();
});

export default router;
```

Mount in `server/src/index.ts`:
```typescript
import timeEntryRoutes from './routes/time-entries.js';
// ...
app.use('/api/time-entries', timeEntryRoutes);
```

### Pattern 3: Reports Time-Summary Endpoint

Add to `server/src/routes/reports.ts` (not to the CRUD route file):

```typescript
// GET /time-summary — aggregate for Reports Tid tab (TIME-05, TIME-06)
router.get('/time-summary', authenticate, (req: AuthRequest, res) => {
  const { year, month } = req.query as { year?: string; month?: string };

  const filterConditions: string[] = [];
  const filterParams: string[] = [];

  if (year && year !== 'all') {
    filterConditions.push("strftime('%Y', te.created_at) = ?");
    filterParams.push(year);
  }
  if (month && month !== 'all') {
    const monthNum = parseInt(month, 10);
    const paddedMonth = String(monthNum + 1).padStart(2, '0');
    filterConditions.push("strftime('%m', te.created_at) = ?");
    filterParams.push(paddedMonth);
  }

  const where = filterConditions.length > 0
    ? `WHERE ${filterConditions.join(' AND ')}`
    : '';

  // TIME-05: minutes per category (LEFT JOIN handles uncategorised tickets)
  const byCategory = db.prepare(`
    SELECT COALESCE(c.label, 'Okategoriserad') as category,
           COALESCE(SUM(te.duration_minutes), 0) as total_minutes
    FROM time_entries te
    JOIN tickets t ON te.ticket_id = t.id
    LEFT JOIN categories c ON t.category_id = c.id
    ${where}
    GROUP BY t.category_id
    ORDER BY total_minutes DESC
  `).all(...filterParams) as { category: string; total_minutes: number }[];

  // TIME-06: top 10 tickets by total time
  const topTickets = db.prepare(`
    SELECT t.id, t.title, COALESCE(SUM(te.duration_minutes), 0) as total_minutes
    FROM time_entries te
    JOIN tickets t ON te.ticket_id = t.id
    ${where}
    GROUP BY te.ticket_id
    ORDER BY total_minutes DESC
    LIMIT 10
  `).all(...filterParams) as { id: string; title: string; total_minutes: number }[];

  res.json({ byCategory, topTickets });
});
```

### Pattern 4: Duration Parser

Pure function with no dependencies. Handles all D-01 formats plus Swedish 't':

```typescript
// src/lib/duration.ts

/**
 * Parse a human-readable duration string to total minutes.
 * Accepted formats:
 *   '1h 30m', '1t 30m'  — hours + minutes (h or t for timme)
 *   '1h30m', '1t30m'    — no space between
 *   '1.5h', '1.5t'      — decimal hours
 *   '90m', '90min'      — minutes only
 *   '90'                — plain integer (treated as minutes)
 * Returns null if the string cannot be parsed or resolves to 0.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  // Decimal hours: '1.5h', '1.5t', '2h', '2t'
  const decimalMatch = s.match(/^(\d+(?:\.\d+)?)\s*[ht]$/);
  if (decimalMatch) {
    const mins = Math.round(parseFloat(decimalMatch[1]) * 60);
    return mins > 0 ? mins : null;
  }

  // Combined hours+minutes: '1h 30m', '1t 30m', '1h30m', '1t30m'
  const combinedMatch = s.match(/^(\d+)\s*[ht]\s*(\d+)\s*m(?:in)?$/);
  if (combinedMatch) {
    const mins = parseInt(combinedMatch[1]) * 60 + parseInt(combinedMatch[2]);
    return mins > 0 ? mins : null;
  }

  // Minutes only: '90m', '90min', '45m'
  const minutesMatch = s.match(/^(\d+)\s*m(?:in)?$/);
  if (minutesMatch) {
    const mins = parseInt(minutesMatch[1]);
    return mins > 0 ? mins : null;
  }

  // Plain integer (assume minutes): '90', '45'
  const plainMatch = s.match(/^(\d+)$/);
  if (plainMatch) {
    const mins = parseInt(plainMatch[1]);
    return mins > 0 ? mins : null;
  }

  return null;
}

/** Format integer minutes to display string. '1h 30m', '2h', '45m' */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
```

### Pattern 5: React Query Hook

```typescript
// src/hooks/useTimeEntries.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const timeEntryKeys = {
  all: ['time-entries'] as const,
  ticket: (ticketId: string) => ['time-entries', ticketId] as const,
};

export const useTimeEntries = (ticketId: string) => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: timeEntryKeys.ticket(ticketId),
    queryFn: () => api.getTimeEntries(ticketId),
  });

  const addEntry = useMutation({
    mutationFn: (payload: { duration_minutes: number; note?: string }) =>
      api.createTimeEntry(ticketId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeEntryKeys.ticket(ticketId) });
      toast.success('Tid loggad');
    },
    onError: (error: any) => toast.error(error.message || 'Kunde inte logga tid'),
  });

  const deleteEntry = useMutation({
    mutationFn: (entryId: string) => api.deleteTimeEntry(ticketId, entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeEntryKeys.ticket(ticketId) });
      toast.success('Tidpost borttagen');
    },
    onError: () => toast.error('Kunde inte ta bort tidpost'),
  });

  return {
    entries: data?.entries ?? [],
    totalMinutes: data?.total_minutes ?? 0,
    isLoading,
    addEntry: addEntry.mutate,
    deleteEntry: deleteEntry.mutate,
    isAdding: addEntry.isPending,
    isDeleting: deleteEntry.isPending,
  };
};
```

### Pattern 6: TimeSection Component Layout

Component props: `{ ticketId: string }`. Follows KBLinksSection's `div.space-y-3` outer wrapper:

```
Header row:
  Clock icon | "Tid" label | total formatted badge (e.g. "2h 30m")

Entry list (when entries exist):
  each entry = div.group with:
    - left: duration badge (bold) + date text + note text (muted)
    - right: X button (opacity-0 group-hover:opacity-100)

Empty state:
  "Ingen tid loggad" muted text

--- border-t border-dashed separator ---

Input area:
  duration Input (placeholder "1h 30m, 90m, 45...") + note Input (optional)
  + "Logga tid" Button
  + inline validation message if parseDuration returns null
```

### Pattern 7: Reports Tid Tab

Add after the existing "taggar" tab in `Reports.tsx`:

```tsx
// In TabsList (after taggar):
<TabsTrigger value="tid">Tid</TabsTrigger>

// New TabsContent:
<TabsContent value="tid" className="space-y-5 mt-5">
  <TimeSummaryTab year={selectedYear} month={selectedMonth} />
</TabsContent>
```

`TimeSummaryTab` is a new component (separate file preferred for readability given Reports.tsx is already large). It accepts `year` and `month` as props, fetches via `useQuery` calling `api.getTimeReportsSummary(year, month)`, and renders:
1. `ResponsiveContainer` + `BarChart` using the existing `COLORS` array — category on X axis, minutes on Y
2. A `<table>` (or shadcn Card list) of top 10 tickets with ticket title + formatted duration

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date formatting | custom formatter | `date-fns format()` | Already imported in Reports; handles locale edge cases |
| Bar chart | custom SVG chart | Recharts `BarChart` | Already in Reports.tsx; zero additional bundle cost |
| API request boilerplate | raw fetch | `api.request<T>()` | Handles auth, CSRF, 401 refresh automatically |
| Toast notifications | custom alerts | `sonner toast` | Consistent UX throughout app |
| Query cache management | manual state | React Query invalidation | Prevents stale data; established pattern |
| UUID generation | custom id | `randomUUID()` from Node crypto | Already used in all route files |

---

## Common Pitfalls

### Pitfall 1: VALID_TABLE_NAMES Set not updated
**What goes wrong:** Any future `columnExists('time_entries', ...)` call throws "unknown table", crashing `initializeDatabase()`.
**Why it happens:** The guard Set is an allowlist — new tables must be added explicitly.
**How to avoid:** Add `'time_entries'` to the `VALID_TABLE_NAMES` Set in `connection.ts` in the same commit as `ensureTimeEntriesTable`.
**Warning signs:** Server startup crash with "unknown table" message.

### Pitfall 2: Route not mounted in server/index.ts
**What goes wrong:** Frontend gets 404 on all time-entry API calls.
**Why it happens:** Every route file must be imported and mounted in `index.ts`.
**How to avoid:** Add `import timeEntryRoutes from './routes/time-entries.js'` and `app.use('/api/time-entries', timeEntryRoutes)` to `index.ts`.

### Pitfall 3: parseDuration accepts '0' — API rejects with 400
**What goes wrong:** User types '0m', frontend sends request, API returns 400, generic error toast.
**Why it happens:** DB constraint is `CHECK(duration_minutes > 0)`.
**How to avoid:** Validate `parsedMinutes !== null && parsedMinutes > 0` in TimeSection before firing mutation. Show inline "Ange en giltig tid (t.ex. 30m eller 1h 30m)" message.

### Pitfall 4: Reports endpoint ignores date filter
**What goes wrong:** Tid tab shows all-time data even when year/month filter is selected.
**Why it happens:** Forgetting to pass `year` and `month` query params from `Reports.tsx` state.
**How to avoid:** `api.getTimeReportsSummary(year, month)` must receive the same `selectedYear` / `selectedMonth` values used by `useReportsSummary`.

### Pitfall 5: INNER JOIN drops uncategorised tickets from category chart
**What goes wrong:** Time entries on tickets with no category silently disappear from the bar chart.
**Why it happens:** `JOIN categories c ON t.category_id = c.id` excludes NULL category_id rows.
**How to avoid:** Use `LEFT JOIN categories c ON t.category_id = c.id` with `COALESCE(c.label, 'Okategoriserad')`.

### Pitfall 6: Query key mismatch prevents cache refresh
**What goes wrong:** After logging or deleting time, the sidebar list does not update.
**Why it happens:** `invalidateQueries` key must exactly match the `useQuery` key.
**How to avoid:** Use only `timeEntryKeys.ticket(ticketId)` for both — never hardcode strings separately.

### Pitfall 7: Reports.tsx duplicate import
**What goes wrong:** Adding `Clock` icon to Reports.tsx that already imports `Clock` from lucide-react causes a lint warning or duplicate import.
**Why it happens:** Reports imports many icons already; `Clock` may already be present.
**How to avoid:** Check existing imports in Reports.tsx before adding. `Clock` is currently NOT in the import (verified from line 24 of Reports.tsx) — the current icon list is `BarChart3, PieChartIcon, Calendar, Ticket, Clock, CheckCircle, AlertTriangle, Users, Scale, Download, Printer`. `Clock` IS present. TimeSummaryTab component handles its own imports.

---

## Code Examples

### Integration point: TicketDetail.tsx sidebar addition

Add below the KBLinksSection block (around line 614):

```tsx
{/* Tid — Time Tracking */}
<div className="pt-4 border-t">
  <TimeSection ticketId={ticket.id} />
</div>
```

### api.ts additions (Time Entries section)

```typescript
// Time Entries
async getTimeEntries(ticketId: string) {
  return this.request<{ entries: TimeEntryRow[]; total_minutes: number }>(
    `/time-entries/${ticketId}`
  );
}

async createTimeEntry(ticketId: string, payload: { duration_minutes: number; note?: string }) {
  return this.request<TimeEntryRow>(`/time-entries/${ticketId}`, {
    method: 'POST',
    body: payload,
  });
}

async deleteTimeEntry(ticketId: string, entryId: string) {
  return this.request<null>(`/time-entries/${ticketId}/${entryId}`, {
    method: 'DELETE',
  });
}

async getTimeReportsSummary(year: string, month: string) {
  return this.request<{
    byCategory: { category: string; total_minutes: number }[];
    topTickets: { id: string; title: string; total_minutes: number }[];
  }>(`/reports/time-summary?year=${year}&month=${month}`);
}
```

### Type additions for src/types/ticket.ts

```typescript
export interface TimeEntryRow {
  id: string;
  duration_minutes: number;
  note: string | null;
  created_at: string;
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Inline SQL in connection.ts for all tables | Idempotent ensureXxx() functions, called from initializeDatabase() | New table = new ensureXxx function + one call |
| Direct fetch() in components | ApiClient.request<T>() with auth + CSRF | All new API methods go through api.ts |
| useState for server data | React Query useQuery/useMutation | Cache invalidation handles refresh automatically |

---

## Environment Availability

Step 2.6: SKIPPED — phase is purely code/config changes using the existing stack. No new external dependencies, CLIs, or services required.

---

## Validation Architecture

`nyquist_validation` is explicitly `false` in `.planning/config.json` — this section is skipped per instructions.

---

## Open Questions

1. **Swedish comma-decimal '1,5t'**
   - What we know: D-01 specifies dot-decimal formats only ('1.5h').
   - What's unclear: Whether Swedish users might type comma decimal.
   - Recommendation: Support dot decimal only. Add comma variant only if user requests it.

2. **Note length limit**
   - What we know: No explicit limit stated in requirements.
   - Recommendation: Apply `CHECK(note IS NULL OR length(note) <= 500)` in the DB schema. Frontend can show a char count or trim at 500.

3. **Reports bar chart Y-axis label**
   - What we know: Data is in minutes, but 'Xh Ym' is the display format.
   - Recommendation: Use a custom Recharts `tickFormatter` on YAxis: `(v) => formatDuration(v)`. Same pattern as existing Reports tooltips.

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection — `server/src/db/connection.ts` — idempotent migration pattern, VALID_TABLE_NAMES, initializeDatabase call order
- Direct codebase inspection — `src/components/KBLinksSection.tsx` — sidebar section template (React Query, mutations, hover-reveal delete)
- Direct codebase inspection — `src/pages/Reports.tsx` — Tabs structure, COLORS array, Recharts BarChart/ResponsiveContainer usage, date filter state
- Direct codebase inspection — `server/src/routes/reports.ts` — date-filter WHERE clause pattern, SQLite strftime usage
- Direct codebase inspection — `src/lib/api.ts` — ApiClient method naming and request<T> patterns
- Direct codebase inspection — `server/src/index.ts` — route mounting pattern
- Direct codebase inspection — `.planning/codebase/CONVENTIONS.md` and `STRUCTURE.md` — naming conventions and file placement

### Secondary (MEDIUM confidence)

- Duration parsing regex patterns — standard JavaScript regex verified manually against all specified D-01 input formats

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified present in project, no new installs
- Architecture / migration pattern: HIGH — copied directly from working code in connection.ts
- Route pattern: HIGH — matches existing reports.ts and kb.ts route files exactly
- Duration parser: HIGH — pure function with no external dependencies; regex verified against spec
- Pitfalls: HIGH — derived from reading actual code paths (VALID_TABLE_NAMES guard, index.ts mount list, Reports.tsx filter state)
- Reports integration: HIGH — Tabs structure verified in Reports.tsx source

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable stack; no fast-moving dependencies)
