# Phase 5: Automation — Recurring Tickets & Dashboard Queues - Research

**Researched:** 2026-03-28
**Domain:** Node.js cron scheduling, SQLite migrations, React localStorage state, React Query
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Simple intervals only — daily, weekly (pick weekday), monthly (pick day of month). No cron syntax exposed to users.

**D-02:** Backend uses `node-cron` (already installed) — single recurring-ticket scheduler job, same pattern as `autoCloseScheduler.ts` and `reminderScheduler.ts`.

**D-03:** Template contains: title, description, priority, category, tags. Each auto-created ticket is a full ticket with these values.

**D-04:** Templates stored in new `recurring_templates` SQLite table with: schedule config, template fields, active/paused flag, last_run timestamp, next_run timestamp.

**D-05:** Users can pause, edit, and delete recurring schedules. Paused schedules skip execution.

**D-06:** New "Återkommande" page accessible from sidebar navigation. Lists all schedules: name, interval, status (active/paused), next run, last run.

**D-07:** History via expandable row — last 5-10 created tickets as clickable links. No separate detail page.

**D-08:** Create/edit form is a dialog or slide-over on the same page. Reuses priority select, category select, tag multi-select.

**D-09:** Dashboard queue = reference to a saved filter view (from `useFilterViews` hook). Card shows filter view name, count, clickable to ticket list with that filter active.

**D-10:** Queue definitions stored in localStorage. New `useDashboardQueues` hook. No DB migration needed for queues.

**D-11:** Queues section replaces the current hardcoded aging groups. KPI cards and critical alert bar remain above.

**D-12:** Users can add, reorder, and remove queues. "Add queue" opens a picker of existing saved filter views.

### Claude's Discretion

- Exact responsive layout for queue cards on mobile
- Animation/transition for expandable history rows
- Scheduler polling interval (every minute vs hourly)
- Empty state design for "Återkommande" page and queue section
- How to handle queue count fetching (batch API call vs individual queries)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RECUR-01 | User can create a recurring ticket template with a schedule (daily/weekly/monthly) | D-01 through D-04: locked schema, simple interval UI, dialog form |
| RECUR-02 | System auto-creates tickets via background scheduler | D-02: node-cron scheduler, existing autoCloseScheduler pattern |
| RECUR-03 | User can pause, edit, and delete recurring schedules | D-05, D-06: management page with status toggle, dialog edit |
| RECUR-04 | User can see history of tickets created per schedule | D-07: expandable row showing last 5-10 tickets from recurring_ticket_history table |
| DASH-01 | Dashboard shows saved queues with live ticket count | D-09, D-11: localStorage queues referencing FilterView IDs, batch count API |
| DASH-02 | User can create, edit, and delete dashboard queues | D-10, D-12: useDashboardQueues hook, filter view picker dialog |
| DASH-03 | Each queue shows count and navigates to filtered ticket list | D-09: count from API, navigate to /tickets with filter params from applyView |
</phase_requirements>

---

## Summary

Phase 5 introduces two self-contained automation features that both build heavily on existing project patterns. The recurring ticket scheduler follows the exact same architecture as `autoCloseScheduler.ts` — a `node-cron` job registered at server startup, a new `recurring_templates` SQLite table, and a dedicated `server/src/routes/recurring.ts` for CRUD. The planner should treat this as a direct extension of the existing scheduler pattern, not a new architecture.

Dashboard queues are entirely frontend-only. They reference existing `FilterView` records from `useFilterViews` and store queue order/selection in a new localStorage key via `useDashboardQueues`. The only backend work needed is a new `/api/tickets/count` endpoint (or batch endpoint) so queue cards can display live counts without fetching full ticket lists. The aging groups block in `Dashboard.tsx` is replaced wholesale with the queue section.

**Primary recommendation:** Implement in two independent tracks — backend (scheduler + migration + routes) and frontend (recurring page + dashboard queue section). These tracks have no dependency on each other and can be planned as separate waves.

---

## Standard Stack

### Core (already installed — zero new dependencies needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-cron | existing | Cron job scheduling | Already used by 2 schedulers; proven in this codebase |
| better-sqlite3 | existing | Database queries | All server DB access uses this synchronous driver |
| @tanstack/react-query | existing | Data fetching + cache | All existing hooks use useQuery/useMutation |
| uuid (v4) | existing | ID generation for new records | Used in all DB insert operations |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | existing | Icons for Återkommande page | All nav/UI icons; RepeatClock or RefreshCw for recurring |
| shadcn/ui Dialog | existing | Create/edit form modal | Used by FilterViewManager, CommentItem forms |
| shadcn/ui Card | existing | Queue cards, schedule list cards | Used throughout Dashboard |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| localStorage queues (D-10) | DB table + API | DB approach persists across devices/browsers but requires migration; localStorage matches filter-views pattern exactly |
| Batch count API | Individual count query per queue | Individual queries: simpler to implement but N+1 requests; batch preferred |
| Expandable row (D-07) | Separate detail page | Dedicated page adds routing complexity; expandable row keeps UX in one place |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Recommended Project Structure (new files only)
```
server/src/
├── lib/
│   └── recurringScheduler.ts       # New scheduler (mirrors autoCloseScheduler.ts)
├── routes/
│   └── recurring.ts                # CRUD: templates, pause/resume, history
└── db/
    └── connection.ts               # Add ensureRecurringTemplatesTable() here

src/
├── pages/
│   └── Recurring.tsx               # "Återkommande" management page
├── hooks/
│   ├── useRecurringTemplates.ts    # React Query CRUD hook
│   └── useDashboardQueues.ts       # localStorage queue management hook
└── components/
    └── dashboard/
        └── QueueCard.tsx           # Single queue count card
```

### Pattern 1: Scheduler Registration (mirrors existing)
**What:** Export a `startRecurringScheduler()` function, call it in `server/src/index.ts` unconditionally (unlike reminder scheduler which requires SMTP).
**When to use:** Recurring scheduler has no external dependencies — always enabled.
**Example:**
```typescript
// server/src/lib/recurringScheduler.ts
import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';

export function startRecurringScheduler(): void {
  // Run every minute to check for due schedules
  cron.schedule('* * * * *', () => {
    try {
      processRecurringTemplates();
    } catch (error) {
      console.error('Recurring scheduler error:', error);
    }
  });
  console.log('✅ Recurring ticket scheduler started (checking every minute)');
}

function processRecurringTemplates(): void {
  const now = new Date().toISOString();
  // Select only active templates where next_run <= now
  const due = db.prepare(`
    SELECT * FROM recurring_templates
    WHERE is_active = 1 AND next_run <= ?
  `).all(now);

  for (const template of due) {
    try {
      createTicketFromTemplate(template);
    } catch (error) {
      console.error(`Failed to create ticket for template ${template.id}:`, error);
    }
  }
}
```

### Pattern 2: DB Migration via ensureXxx() in connection.ts
**What:** Add `ensureRecurringTemplatesTable()` function following the exact pattern of `ensureTicketRemindersTable()` — check `tableExists()`, create if absent, call at end of `initializeDatabase()`.
**When to use:** Every new table in this project uses this guard pattern, not raw ALTER TABLE.
**Example:**
```typescript
// In server/src/db/connection.ts
const ensureRecurringTemplatesTable = () => {
  if (tableExists('recurring_templates')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      tags TEXT DEFAULT '[]',          -- JSON array of tag IDs
      interval_type TEXT NOT NULL CHECK(interval_type IN ('daily','weekly','monthly')),
      interval_day INTEGER,            -- 0-6 for weekly (ISO weekday), 1-31 for monthly
      is_active INTEGER DEFAULT 1,
      last_run TEXT,
      next_run TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_templates_next_run
      ON recurring_templates(is_active, next_run);
  `);
  console.log('Created recurring_templates table');

  // Separate history table — avoids embedding JSON in the template row
  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_ticket_history (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_history_template
      ON recurring_ticket_history(template_id, created_at DESC);
  `);
  console.log('Created recurring_ticket_history table');
};
```

### Pattern 3: useDashboardQueues Hook (mirrors useFilterViews)
**What:** localStorage-backed hook storing an ordered list of FilterView IDs pinned to the Dashboard.
**When to use:** Queue definitions never need server-side persistence (D-10).
**Example:**
```typescript
// src/hooks/useDashboardQueues.ts
const STORAGE_KEY = 'dashboard-queues';

export interface DashboardQueue {
  id: string;            // same as FilterView.id
  filterViewId: string;  // reference to useFilterViews entry
}

export function useDashboardQueues() {
  const [queues, setQueues] = useState<DashboardQueue[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queues));
  }, [queues]);

  const addQueue = useCallback((filterViewId: string) => { ... }, []);
  const removeQueue = useCallback((id: string) => { ... }, []);
  const reorderQueues = useCallback((newOrder: DashboardQueue[]) => { ... }, []);

  return { queues, addQueue, removeQueue, reorderQueues };
}
```

### Pattern 4: Queue Count Fetching — Batch API
**What:** Single POST to `/api/tickets/counts` that accepts an array of filter objects and returns `{ [filterKey]: count }`. This avoids N+1 requests when 5+ queues are on screen.
**When to use:** Every Dashboard mount triggers count refresh.
**Alternative (simpler):** Add `?countOnly=true` support to existing `GET /api/tickets` — returns `{ count: N }` instead of full ticket list. Call once per queue via React Query with individual query keys (allows per-queue stale management). For typical use (2-5 queues), individual queries are fine.

**Recommendation (discretion area):** Individual `GET /api/tickets?countOnly=true&...filters` per queue, cached by React Query with a 30-second stale time. Simpler to implement, consistent with existing ticket query pattern. Switch to batch only if performance is a concern with many queues.

### Pattern 5: next_run Calculation
**What:** When a scheduler fires or a template is created/edited, compute the next ISO timestamp.
**Why critical:** Incorrect `next_run` calculation means schedules either skip or double-fire.
**Logic:**
```typescript
function computeNextRun(
  intervalType: 'daily' | 'weekly' | 'monthly',
  intervalDay?: number, // weekday (0=Sun..6=Sat) or day-of-month (1-31)
  fromDate: Date = new Date()
): Date {
  const next = new Date(fromDate);

  if (intervalType === 'daily') {
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0); // Midnight next day
  } else if (intervalType === 'weekly') {
    const target = intervalDay ?? 1; // Default Monday
    const current = next.getDay();
    const daysUntil = (target - current + 7) % 7 || 7; // Always at least 1 day ahead
    next.setDate(next.getDate() + daysUntil);
    next.setHours(0, 0, 0, 0);
  } else if (intervalType === 'monthly') {
    const targetDay = intervalDay ?? 1;
    next.setMonth(next.getMonth() + 1);
    next.setDate(Math.min(targetDay, getDaysInMonth(next)));
    next.setHours(0, 0, 0, 0);
  }

  return next;
}
```

### Anti-Patterns to Avoid
- **Storing tags as a relational join table for templates:** Tags are IDs-as-JSON in `recurring_templates.tags` column — simpler, no additional join table needed, consistent with the small number of tags per template.
- **Running scheduler logic inside the route handler:** Never trigger `processRecurringTemplates()` from an API route. Scheduler fires independently via cron.
- **Querying all tickets to compute queue counts on the frontend:** Always use a dedicated count endpoint. Do not fetch 1000+ tickets into Dashboard.tsx for counting — this is already a performance smell in the current aging groups implementation.
- **Storing queue counts in localStorage:** Counts must be live from the API; only the queue _definition_ (which filter view is pinned) lives in localStorage.
- **Using cron expressions passed from user input:** D-01 is locked to simple intervals. `node-cron` expressions are computed server-side from `interval_type` + `interval_day`, never user-provided strings.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron scheduling | Custom setInterval loop | `node-cron` (already installed) | Handles DST, missed fires on restart, cron syntax |
| Dialog forms | Custom modal overlay | shadcn `Dialog` | Already used throughout: FilterViewManager, CommentItem |
| UUID generation | Math.random() strings | `uuid` v4 (already installed) | Collision-safe, consistent with all other DB inserts |
| Tag multi-select | Custom dropdown | Existing tag select component in ticket form | Already handles tag creation and multi-select |
| Priority select | Custom select | Existing priority select in ticket form | Consistent UI, already has all 4 priority values |
| Queue ordering | Custom drag-and-drop | Simple up/down arrow buttons | Drag-and-drop is high complexity for low-value UX in an internal tool; arrow buttons are sufficient |

**Key insight:** Every building block for this phase already exists in the codebase. The work is assembly, not construction.

---

## Common Pitfalls

### Pitfall 1: next_run Drift on Missed Fires
**What goes wrong:** If the server is down when a schedule fires, on restart the scheduler immediately processes all overdue templates. If `next_run` is updated to `now + interval`, the next real-world fire is correct. But if the code sets `next_run = last_run + interval` using the stored `last_run`, missed fires accumulate.
**Why it happens:** Computing `next_run` relative to the old `next_run` vs. relative to the current time.
**How to avoid:** After a template fires, compute `next_run` using `computeNextRun(type, day, new Date())` — always from _now_, not from the last intended fire time. This means a delayed fire results in a normal-interval delay, not an immediate re-fire.
**Warning signs:** Templates firing twice in rapid succession after a server restart.

### Pitfall 2: Monthly Schedule Edge Case — Day 31
**What goes wrong:** A schedule set to "31st of month" will fail in February, April, June, September, November.
**Why it happens:** `new Date(year, month, 31)` overflows to the next month in JavaScript.
**How to avoid:** Use `Math.min(targetDay, getDaysInMonth(next))` in `computeNextRun`. This clamps day 31 to the last valid day of the month.
**Warning signs:** Tickets created on wrong date or `next_run` jumping unexpectedly forward.

### Pitfall 3: Queue Count Stale on Dashboard
**What goes wrong:** User creates a ticket, navigates to Dashboard — queue count still shows old value.
**Why it happens:** React Query cache not invalidated after ticket mutations.
**How to avoid:** When `useRecurringTemplates` or any ticket mutation completes, call `queryClient.invalidateQueries(['tickets', 'counts'])`. Dashboard queue count queries should use `staleTime: 30_000` (30 seconds), not infinity.
**Warning signs:** Count shown on Dashboard doesn't match count on ticket list page.

### Pitfall 4: Tags in recurring_templates Desync
**What goes wrong:** A tag stored in `recurring_templates.tags` JSON is deleted. New tickets created from the template reference a non-existent tag ID.
**Why it happens:** `recurring_templates.tags` is a JSON column — no FK constraint enforces referential integrity.
**How to avoid:** In `createTicketFromTemplate()`, filter out any tag IDs that no longer exist in the `tags` table before inserting into `ticket_tags`. Log a warning but don't fail the ticket creation.
**Warning signs:** Ticket creation fails with FK constraint on `ticket_tags`, or silently creates tickets with missing tags.

### Pitfall 5: CSRF Token Required for Mutations
**What goes wrong:** POST/PUT/DELETE to `/api/recurring` fails with 403 EBADCSRFTOKEN.
**Why it happens:** The project uses csrf-csrf double-submit pattern on all state-changing routes.
**How to avoid:** All mutations in `useRecurringTemplates` must use the project's `api` client (which handles CSRF via `getCsrfToken()`), not raw `fetch`.
**Warning signs:** 403 responses on all POST/PUT/DELETE to the new recurring routes.

### Pitfall 6: useFilterViews is Context-Bound
**What goes wrong:** `useDashboardQueues` tries to call `applyView()` from `useFilterViews`, but `useFilterViews` uses `useSearchParams` which requires a Router context.
**Why it happens:** `useFilterViews` ties navigation to the hook state. `Dashboard.tsx` already wraps in `<Layout>` which is inside the Router.
**How to avoid:** `useDashboardQueues` only stores queue _definitions_ (IDs). When a queue card is clicked, the Dashboard component reads the FilterView from a shared `useFilterViews()` call and navigates via `navigate('/tickets?' + buildFilterParams(view))`. Do not attempt to call `applyView` from the queue card click handler directly — navigate instead.
**Warning signs:** React hook errors about invalid Router context, or filter state not applied on ticket list.

---

## Code Examples

Verified patterns from existing codebase:

### Scheduler Registration in index.ts
```typescript
// Source: server/src/index.ts lines 42-61 (existing pattern)
// Add after startAutoCloseScheduler() call:
import { startRecurringScheduler } from './lib/recurringScheduler.js';
// ...
startRecurringScheduler(); // Always enabled, no SMTP dependency
```

### Route Registration in index.ts
```typescript
// Source: server/src/index.ts lines 164-180 (existing pattern)
import recurringRoutes from './routes/recurring.js';
// ...
app.use('/api/recurring', recurringRoutes);
```

### Sidebar Nav Item Addition
```typescript
// Source: src/components/Layout.tsx lines 16-44
// Add to navItems array (after 'Alla ärenden' or before 'Rapporter'):
import { RefreshCw } from 'lucide-react'; // Or RepeatClock if available
{
  path: '/recurring',
  icon: RefreshCw,
  label: 'Återkommande'
}
```

### DB Table Check Pattern
```typescript
// Source: server/src/db/connection.ts lines 319-335 (ensureTicketHistoryTable)
const ensureRecurringTemplatesTable = () => {
  if (tableExists('recurring_templates')) return;
  db.exec(`CREATE TABLE IF NOT EXISTS recurring_templates ( ... )`);
  console.log('Created recurring_templates table');
};
// Called at end of initializeDatabase() function
```

### React Query Mutation Pattern
```typescript
// Source: src/hooks/useTickets.ts (general pattern)
const createTemplate = useMutation({
  mutationFn: (data: CreateTemplateInput) =>
    api.post<RecurringTemplate>('/recurring', data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['recurring'] });
    toast.success('Återkommande schema skapat');
  },
  onError: () => toast.error('Kunde inte skapa schema'),
});
```

### FilterView applyView for Queue Navigation
```typescript
// Source: src/hooks/useFilterViews.ts lines 166-245
// In Dashboard.tsx queue card click:
const { views, applyView } = useFilterViews();
const navigate = useNavigate();

const handleQueueClick = (filterViewId: string) => {
  const view = views.find(v => v.id === filterViewId);
  if (view) {
    applyView(view, 'ticketlist'); // Sets URL params AND activeViewId
    navigate('/tickets');
  }
};
```

---

## Runtime State Inventory

This phase introduces new DB tables and localStorage keys. No renames or migrations of existing data.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — new `recurring_templates` and `recurring_ticket_history` tables created fresh | Schema creation only, no data migration |
| Live service config | None | — |
| OS-registered state | None | — |
| Secrets/env vars | None — scheduler has no external dependencies | — |
| Build artifacts | None | — |

New localStorage keys introduced:
- `dashboard-queues` — list of pinned FilterView IDs, written by `useDashboardQueues`

Existing `filter-views` localStorage key (from `useFilterViews`) is read-only from this phase's perspective — queues reference existing views by ID but do not modify them.

---

## Environment Availability

Step 2.6: SKIPPED — phase is purely code changes within the existing Docker/Node.js stack. No new external services, CLIs, or runtimes required. `node-cron` is already installed and verified in production.

---

## Open Questions

1. **Scheduler polling interval (Claude's Discretion)**
   - What we know: `reminderScheduler.ts` runs every minute (`* * * * *`). `autoCloseScheduler.ts` runs daily (`30 2 * * *`).
   - What's unclear: For recurring tickets, daily/weekly/monthly schedules don't need per-minute precision. However, per-minute polling is already established and has negligible overhead.
   - Recommendation: Run every minute like the reminder scheduler. The `next_run` timestamp check is a single indexed SELECT — cost is trivial.

2. **Queue count API design (Claude's Discretion)**
   - What we know: Existing `GET /api/tickets` returns paginated data with a total count in the response. Adding `?countOnly=true&limit=0` could return just `{ total: N }`.
   - What's unclear: Whether individual queries (one React Query key per queue) or a batch endpoint is better.
   - Recommendation: Extend existing `GET /api/tickets` to support `countOnly=true` parameter — returns `{ count: N }` with no ticket data. Each queue calls this independently. This reuses all existing filter logic and React Query caching. No new endpoint needed.

3. **Tags JSON column in recurring_templates vs join table**
   - What we know: The ticket creation flow uses a `ticket_tags` join table. If a recurring template stores tag IDs as JSON, they must be expanded on ticket creation.
   - What's unclear: None — this is fully understood.
   - Recommendation: JSON column in `recurring_templates.tags` (e.g., `'["tag-id-1","tag-id-2"]'`). On ticket creation, parse and insert into `ticket_tags`. This is simpler than a dedicated join table for a table that will have few rows.

---

## Sources

### Primary (HIGH confidence)
- `server/src/lib/autoCloseScheduler.ts` — Reference scheduler implementation read directly
- `server/src/lib/reminderScheduler.ts` — Reference async scheduler with error handling read directly
- `server/src/index.ts` — Scheduler and route registration pattern read directly
- `server/src/db/connection.ts` — Full migration pattern (`ensureXxxTable`) read directly
- `server/src/db/schema.sql` — Existing table structure read directly
- `src/hooks/useFilterViews.ts` — localStorage hook pattern read directly
- `src/types/filterView.ts` — FilterView type definition read directly
- `src/pages/Dashboard.tsx` — Aging groups block to be replaced, KPI section to retain
- `src/components/Layout.tsx` — navItems array structure for sidebar addition
- `server/src/routes/templates.ts` — Express router + authenticate middleware pattern

### Secondary (MEDIUM confidence)
- node-cron documentation patterns verified against existing usage in codebase

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and in use
- Architecture: HIGH — every pattern is directly derived from existing code in the codebase
- Pitfalls: HIGH — derived from reading actual implementation code, not general assumptions
- Scheduler timing: MEDIUM — polling interval is Claude's discretion, not locked

**Research date:** 2026-03-28
**Valid until:** 2026-06-28 (stable stack, internal codebase)
