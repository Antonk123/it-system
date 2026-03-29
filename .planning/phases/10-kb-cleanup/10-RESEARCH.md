# Phase 10: KB Cleanup - Research

**Researched:** 2026-03-30
**Domain:** React/TypeScript frontend removal, Express/SQLite backend cleanup, JWT token refresh fix
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Database Cleanup (CLEAN-01, CLEAN-02, CLEAN-04)**
- D-01: Full removal of view_count — strip from all API endpoints, UI display, and queries. Column stays in existing DBs (no table rebuild migration) but is omitted from `schema.sql` for fresh installs.
- D-02: Drop the "Populara artiklar" section AND its API endpoint. No replacement metric — section is gone.
- D-03: Drop the "Senast uppdaterade" section AND its API endpoint. Both UI and backend query removed entirely.

**Template Removal (CLEAN-03)**
- D-04: Remove "Losenordsaterstellning" and "Ny anvandare" from seed data AND add a migration that deletes these rows from the live DB.
- D-05: Before deleting templates, null out `template_id` on any tickets that reference them. No orphaned foreign keys.

**Token Refresh (CLEAN-05)**
- D-06: "Inactive for 7+ days" means 7 days since last authenticated API call. Any API request resets the clock.
- D-07: The current pain point is access token expiring too fast and silent refresh not catching it. Fix: ensure refresh token interceptor works reliably and extend access token / refresh token lifetimes appropriately.
- D-08: When refresh token is truly expired (7+ days inactive), silently redirect to `/login` — no error toast. Login after long absence is expected, not an error.

**Verification**
- D-09: Verification via code review (grep for removed references) + manual spot-check on live app after deploy. No automated test assertions needed.
- D-10: No data export before removal. View counts and template definitions can be deleted without backup.

### Claude's Discretion
- Access token and refresh token expiry durations — Claude picks values that satisfy the 7-day inactivity requirement
- Order of removals (which CLEAN-XX to tackle first)
- Whether to combine related removals into single commits or keep them atomic

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLEAN-01 | Remove KB view counter (view_count column, API increment, display) | view_count is in: KbArticleRow interface in api.ts, kb_articles table (via ensureKbV2Columns migration), GET /api/kb/articles/:id increments it, GET /api/kb/public/:token increments it, KBArticleDetail.tsx displays it, KnowledgeBase.tsx uses it in popularArticles computation |
| CLEAN-02 | Remove "Senast uppdaterade" section from KB home | Lives entirely in KnowledgeBase.tsx: recentlyUpdated useMemo (lines 111-114) and JSX block (lines 386-404). No dedicated API endpoint — uses existing articles list, frontend-only removal. |
| CLEAN-03 | Remove default unused templates | Templates seeded in ensureTicketTemplatesTable() with hardcoded IDs template-1 (Losenordsaterstellning) and template-2 (Ny anvandare). seed-templates.ts also creates same-named templates with uuid IDs. Migration must delete by name, not just ID. |
| CLEAN-04 | Remove "Populara artiklar" section from KB home | Lives in KnowledgeBase.tsx: popularArticles useMemo (lines 116-123) and JSX block (lines 407-428). Uses TrendingUp icon. No dedicated backend endpoint — computed client-side, frontend-only removal. |
| CLEAN-05 | Fix silent token refresh so user never sees login screen unless inactive for 7+ days | Root bug confirmed: tokenRefresh.ts registers an Axios interceptor, but api.ts uses native fetch — the interceptor never fires. Fix requires wiring 401-retry logic into ApiClient.request() in api.ts, plus implementing rolling refresh tokens on the backend. |
</phase_requirements>

---

## Summary

Phase 10 is a pure cleanup phase: remove dead KB features and fix a token refresh bug. Every item has clearly bounded scope.

The KB removals (CLEAN-01 through CLEAN-04) are straightforward frontend and backend deletions with no behavioral changes to surviving features. The most surgical risk is view_count removal: the column is added via ensureKbV2Columns() migration (not schema.sql), is selected in multiple SQL queries in kb.ts, appears in the KbArticleRow TypeScript interface in api.ts, and is displayed in KBArticleDetail.tsx. Every one of these touch-points must be cleaned.

The token refresh fix (CLEAN-05) requires resolving a fundamental mismatch: the tokenRefresh.ts Axios interceptor is registered at startup in main.tsx, but api.ts uses the native fetch API throughout. The interceptor therefore never fires on any API call. The fix requires wiring refresh logic into the fetch-based ApiClient.request() method — detecting a 401 response, attempting a token refresh via /api/auth/refresh, and retrying the original request. Additionally, the refresh token lifetime must be made rolling (7 days from last use, not from creation) to satisfy D-06.

**Primary recommendation:** Execute removals first (CLEAN-01 to CLEAN-04) since they are purely additive deletions, then fix CLEAN-05 as an isolated change. Keep template migration (CLEAN-03) in its own commit due to the data-layer step.

---

## Standard Stack

### Core (already in project — no new dependencies needed)

| Library | Version in Use | Purpose |
|---------|---------------|---------|
| React + TypeScript | 18.x | Frontend component removal |
| better-sqlite3 | current | Migration SQL for template deletion |
| lucide-react | current | TrendingUp + Eye icons to remove |
| fetch (native) | browser | API client transport |

No new libraries are needed for this phase. All removals use existing patterns.

---

## Architecture Patterns

### Pattern 1: Feature Removal Layer Order

Removals follow a consistent layered order in this codebase:

1. Backend: Remove SQL query / route handler (kb.ts)
2. Backend: Remove TypeScript interface field (kb.ts KbArticleRow)
3. Frontend: Remove api.ts client method (if dedicated endpoint existed)
4. Frontend: Remove TypeScript interface field from KbArticleRow in api.ts
5. Frontend: Remove component/JSX
6. Frontend: Remove unused imports (TrendingUp, Eye)

### Pattern 2: Idempotent Migration (established project pattern)

All server/src/db/connection.ts migrations check before acting:

```typescript
// Established pattern
const ensureXxx = () => {
  if (tableExists('some_table')) return; // idempotent guard
  db.exec(`...`);
};
```

The template deletion migration is simpler — UPDATE and DELETE are safe to run multiple times (nulling already-null FKs and deleting already-deleted rows are both no-ops):

```typescript
const ensureDefaultTemplatesRemoved = () => {
  // Null out FK references first (D-05)
  db.prepare(`
    UPDATE tickets SET template_id = NULL
    WHERE template_id IN (
      SELECT id FROM ticket_templates
      WHERE name IN ('Losenordsaterstellning', 'Ny anvandare')
    )
  `).run();
  // Delete by name to catch both hardcoded IDs and uuid-ID seed variants
  db.prepare(`
    DELETE FROM ticket_templates
    WHERE name IN ('Losenordsaterstellning', 'Ny anvandare')
  `).run();
};
```

template_fields and template_checklists have ON DELETE CASCADE to ticket_templates, so they clean up automatically.

### Pattern 3: Token Refresh Fix — Wiring into ApiClient.request()

The root bug: setupTokenRefreshInterceptor() is an Axios interceptor. ApiClient.request() uses fetch. These two systems never interact.

The fix lives in ApiClient.request() in src/lib/api.ts. The method already accepts isRetry as its third parameter. Add a 401-handling block BEFORE consuming the response body (response.json() can only be called once):

```typescript
// Add inside ApiClient.request() before the existing error handling
if (!response.ok) {
  // Handle 401: attempt silent token refresh before consuming body
  if (response.status === 401 && !isRetry) {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
        const refreshRes = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (refreshRes.ok) {
          const data = await refreshRes.json() as { accessToken: string; refreshToken?: string };
          this.setToken(data.accessToken);
          if (data.refreshToken) this.setRefreshToken(data.refreshToken);
          return this.request<T>(endpoint, options, true);
        }
      } catch {
        // swallow refresh errors — fall through to redirect
      }
    }
    // Refresh token absent or expired — silent redirect, no toast (D-08)
    this.clearToken();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  // Existing CSRF retry logic
  const error = await response.json().catch(() => ({ error: 'Request failed' }));
  if (response.status === 403 && !isRetry && this.isCsrfError(error)) {
    this.csrfToken = null;
    return this.request<T>(endpoint, options, true);
  }
  throw new Error(error.error || error.message || 'Request failed');
}
```

### Pattern 4: Rolling Refresh Token on Backend

Current: /api/auth/refresh updates last_used_at but keeps the original expires_at (fixed expiry from login). A user active daily will be forced to re-login after 7 days.

Fix: delete the consumed refresh token and issue a new one with fresh 7-day expiry on each successful refresh:

```typescript
// In POST /api/auth/refresh, replace the UPDATE last_used_at line with:
db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(tokenRow.id);
const newRefreshToken = generateRefreshToken();
const newRefreshTokenId = uuidv4();
const newExpiresAt = getRefreshTokenExpiry(); // 7 days from now
db.prepare(`INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`)
  .run(newRefreshTokenId, tokenRow.user_id, newRefreshToken, newExpiresAt);

// Return the new refresh token in response:
res.json({
  accessToken,
  token: accessToken,
  refreshToken: newRefreshToken,
});
```

### Recommended Token Expiry Values (Claude's Discretion)

- Access token: 15m — short enough to limit exposure, long enough that normal navigation doesn't constantly trigger refreshes
- Refresh token: 7 days rolling (resets on each /refresh call)

This satisfies D-06: any authenticated API call within 7 days keeps the session alive.

### Anti-Patterns to Avoid

- **DROP COLUMN on view_count**: SQLite support for DROP COLUMN requires version 3.35+ (2021). The decision (D-01) correctly avoids this by leaving the column in place on live DBs and omitting it from schema.sql for fresh installs. Do not add an ALTER TABLE migration.
- **Relying on Axios interceptor post-fix**: Once the 401-retry logic is in ApiClient.request(), the Axios interceptor in tokenRefresh.ts is entirely bypassed for all application requests. Do not add new logic to the interceptor; it may be left in place or removed.
- **Toast on expired session redirect**: D-08 is explicit — silent redirect. Do not call toast.error() before window.location.href = '/login'.
- **Deleting templates by hardcoded ID only**: template-1 and template-2 are the hardcoded IDs, but seed-templates.ts also creates same-named templates with UUID IDs. Delete by name.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Rolling refresh token | Custom clock manipulation on last_used_at | Delete-and-reinsert on each /refresh call |
| Template deletion with FK safety | Complex conditional pre-checks | UPDATE tickets SET template_id = NULL first, then DELETE — runs safely multiple times |
| view_count omission on fresh installs | Separate drop-column migration | Omit from schema.sql per D-01 |

---

## Common Pitfalls

### Pitfall 1: view_count in Six Places Across Three Files

**What goes wrong:** Removing the TypeScript interface field flags explicit TypeScript references, but SQL string literals are invisible to the compiler and continue selecting/incrementing the column silently.

**All confirmed touch-points:**
- `server/src/routes/kb.ts` line 164: FTS search query SELECTs a.view_count
- `server/src/routes/kb.ts` line 183: non-FTS query SELECTs a.view_count
- `server/src/routes/kb.ts` line 213: single article query SELECTs a.view_count
- `server/src/routes/kb.ts` line 225: UPDATE ... SET view_count = view_count + 1
- `server/src/routes/kb.ts` line 230: res.json includes view_count: article.view_count + 1
- `server/src/routes/kb.ts` line 574: public article query SELECTs a.view_count
- `server/src/routes/kb.ts` line 584: UPDATE view_count in public route
- `server/src/routes/kb.ts` line 588: res.json includes view_count + 1 in public route
- `src/lib/api.ts` line 1154: KbArticleRow interface field
- `src/pages/KBArticleDetail.tsx` lines 309-312: Eye icon + visningar display
- `src/pages/KnowledgeBase.tsx` lines 116-123: popularArticles useMemo filters by view_count > 0

**Warning signs:** view_count still in API responses after frontend removal.

### Pitfall 2: Two Sources of the Same Template Names

**What goes wrong:** connection.ts ensureTicketTemplatesTable() inserts templates with hardcoded IDs template-1 (Losenordsaterstellning) and template-2 (Ny anvandare). The standalone seed script seed-templates.ts (run separately) creates additional templates with the SAME names but UUID-based IDs. A live DB that had seed-templates.ts run against it has two rows for each name. Deleting only template-1 and template-2 leaves the uuid-ID variants.

**How to avoid:** Delete by name:
```sql
DELETE FROM ticket_templates WHERE name IN ('Losenordsaterstellning', 'Ny anvandare');
```

Also remove the seed-templates.ts entries for these two templates, and remove the fields seeded for "Ny anvandare" in ensureTemplateFieldsTable() (which looks up by name and adds fields).

### Pitfall 3: Axios Interceptor Is Dead Code for All App Requests

**What goes wrong:** Developer sees setupTokenRefreshInterceptor() called in main.tsx and assumes token refresh is working. In fact, api.ts uses fetch() throughout request() and uploadFile(). The Axios interceptor never intercepts any application request.

**Evidence confirmed from code:**
- main.tsx line 5: imports setupTokenRefreshInterceptor from ./lib/tokenRefresh
- main.tsx line 8: calls setupTokenRefreshInterceptor()
- api.ts ApiClient.request(): uses fetch(...), not axios(...)
- api.ts ApiClient.uploadFile(): uses fetch(...), not axios(...)
- Zero axios call sites in api.ts

**How to avoid:** Implement 401-retry in ApiClient.request() using fetch. Do not modify tokenRefresh.ts.

### Pitfall 4: response.json() Can Only Be Called Once

**What goes wrong:** The current api.ts error-handling block calls response.json() after checking !response.ok. If the 401-handling block runs first and tries to read the body for diagnostics, then the existing CSRF-retry block cannot read it again.

**How to avoid:** Check response.status === 401 BEFORE calling response.json(). The 401 branch handles redirect/retry without needing the body content.

### Pitfall 5: No Dedicated Backend Endpoints for "Senast uppdaterade" or "Populara artiklar"

**What goes wrong:** Searching for /api/kb/articles/recent or /api/kb/articles/popular to delete wastes time — these routes do not exist.

**Confirmed from kb.ts full read:** No popular or recent endpoint. Both sections are computed client-side in KnowledgeBase.tsx from the existing articles fetch. Removal is frontend-only.

### Pitfall 6: ensureTemplateFieldsTable() Has a "Ny anvandare" Code Block

**What goes wrong:** After deleting the "Ny anvandare" template, the block in ensureTemplateFieldsTable() that adds fields for "Ny anvandare" will run on fresh installs, look up by name, find nothing (template was deleted), and silently do nothing. On live installs it is already a no-op. However, leaving the dead code block adds confusion.

**How to avoid:** Remove the "Ny anvandare" fields block from ensureTemplateFieldsTable() as part of CLEAN-03. The "Hardvarubestallning" block can stay.

---

## Code Examples

### Remove view_count increment — kb.ts single article route

```typescript
// Remove from GET /api/kb/articles/:id:
// Line 225: db.prepare('UPDATE kb_articles SET view_count = view_count + 1 WHERE id = ?').run(req.params.id);
// Line 230: change res.json({ ...article, view_count: article.view_count + 1, tags });
//       to: res.json({ ...article, tags });
```

### Remove view_count from SQL SELECT statements — kb.ts

Remove `, a.view_count` from the SELECT clause in:
- The FTS search query (around line 164)
- The non-FTS list query (around line 183)
- The single article query (around line 213)
- The public article query (around line 574)

### Remove view_count display — KBArticleDetail.tsx

```tsx
// Remove this block (lines 309-312):
<div className="flex items-center gap-1.5">
  <Eye className="w-4 h-4" />
  <span>{article.view_count} {article.view_count === 1 ? 'visning' : 'visningar'}</span>
</div>
// Also remove Eye from lucide-react import on line 3
```

### Remove Senast uppdaterade — KnowledgeBase.tsx

```typescript
// Remove useMemo (lines 111-114):
const recentlyUpdated = useMemo(
  () => [...articles].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5),
  [articles]
);
// Remove JSX block (lines 386-404): the entire "Recently updated section" div
// Remove Clock from lucide-react import if unused elsewhere
```

### Remove Populara artiklar — KnowledgeBase.tsx

```typescript
// Remove useMemo (lines 116-123):
const popularArticles = useMemo(
  () =>
    [...articles]
      .filter(a => a.status === 'published' && a.view_count > 0)
      .sort((a, b) => b.view_count - a.view_count)
      .slice(0, 5),
  [articles]
);
// Remove JSX block (lines 407-428): the entire "Popular articles section" div
// Remove TrendingUp from lucide-react import on line 3
```

### Template deletion migration — connection.ts

```typescript
const ensureDefaultTemplatesRemoved = () => {
  // Null FK references first (D-05) — safe to run multiple times
  db.prepare(`
    UPDATE tickets SET template_id = NULL
    WHERE template_id IN (
      SELECT id FROM ticket_templates
      WHERE name IN ('Losenordsaterstellning', 'Ny anvandare')
    )
  `).run();
  // Delete templates by name — catches both hardcoded IDs and uuid-ID seed variants
  // ON DELETE CASCADE removes associated template_fields and template_checklists
  db.prepare(`
    DELETE FROM ticket_templates
    WHERE name IN ('Losenordsaterstellning', 'Ny anvandare')
  `).run();
};

// Add to initializeDatabase() AFTER ensureTicketTemplatesTable():
// ensureDefaultTemplatesRemoved();
```

---

## Runtime State Inventory

This is a removal/cleanup phase with no entity renames. Runtime state inventory is not applicable.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is code/config-only changes. No external dependencies beyond the existing Docker-hosted SQLite database, which is accessed at runtime by the server process.

---

## Open Questions

1. **Does the live DB have tickets with template_id pointing to template-1 or template-2?**
   - What we know: The migration nulls template_id before deleting — safe regardless of count.
   - Recommendation: No action needed; migration handles it per D-10.

2. **Are there tickets pointing at uuid-ID variants of the same-named templates from seed-templates.ts?**
   - What we know: The migration deletes by name and nulls FKs by subquery — catches all variants.
   - Recommendation: Confirmed handled by the name-based approach.

3. **Should tokenRefresh.ts be deleted after the fix?**
   - What we know: It becomes dead code for all application requests after CLEAN-05 lands.
   - Recommendation: Discretionary per Claude's Discretion scope. Removing it reduces confusion; leaving it is harmless. Recommend removal for clarity.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection of all files listed in CONTEXT.md canonical_refs
- `server/src/routes/kb.ts` — full read, all view_count touch-points line-identified
- `server/src/routes/auth.ts` — full read, token constants and refresh endpoint confirmed
- `src/lib/tokenRefresh.ts` — full read, Axios interceptor confirmed, dead-code status confirmed
- `src/lib/api.ts` — confirmed fetch usage throughout, KbArticleRow interface, isRetry parameter
- `server/src/db/connection.ts` — full read, template IDs confirmed, migration chain confirmed
- `server/src/db/seed-templates.ts` — full read, duplicate same-named templates confirmed
- `src/pages/KnowledgeBase.tsx` — full read, line numbers for both sections confirmed
- `src/pages/KBArticleDetail.tsx` — full read, view_count display location confirmed
- `src/main.tsx` — confirmed setupTokenRefreshInterceptor() call
- `src/contexts/AuthContext.tsx` — confirmed no refresh logic present
- `server/src/db/schema.sql` — confirmed view_count NOT in schema.sql (added via migration only)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, existing project only
- Architecture patterns: HIGH — all code read directly, patterns confirmed from source
- Pitfalls: HIGH — identified from direct code inspection with line numbers, not speculation
- Token refresh diagnosis: HIGH — Axios vs fetch mismatch confirmed from both main.tsx and api.ts

**Research date:** 2026-03-30
**Valid until:** 2026-04-30
