# Phase 09: Discoverability & Workflow — Research

**Researched:** 2026-03-29
**Domain:** React frontend + SQLite/better-sqlite3 backend — KB cross-references, popular articles, keyboard shortcuts, URL query params
**Confidence:** HIGH

## Summary

Phase 9 adds four distinct features to the KB system, all of which build directly on existing patterns in the codebase. The work is frontend-heavy, with one modest schema addition (the `kb_article_links` join table) and four new backend endpoints. No new libraries are required.

The popular articles section is a pure frontend composition: derive a sorted, filtered slice from already-loaded articles data, just like `recentlyUpdated` is already derived in `KnowledgeBase.tsx`. The cross-reference system needs a join table and bidirectional query, but the schema pattern is identical to `kb_article_tags`. The link picker UX has a live reference in `KBLinksSection.tsx` using shadcn Command + Popover. The `/` keyboard shortcut follows a standard React `useEffect` + `document.addEventListener('keydown')` pattern with an `inputRef`. The ticket-to-KB creation uses React Router `useSearchParams` to read pre-fill values — a pattern already used in `TicketList.tsx` and `UserList.tsx`.

**Primary recommendation:** Decompose into two plans — Plan 1: backend schema + API (kb_article_links table, CRUD endpoints, popular query); Plan 2: frontend (KnowledgeBase popular section, KBArticleDetail "Se även" panel, KBArticleForm link picker + query-param pre-fill, TicketDetail "Skapa KB-artikel" button, `/` shortcut). This keeps each plan focused and independently verifiable.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Popular Articles (DISC-02)**
- D-01: "Populära artiklar" section on KB home page, below "Senast uppdaterade" section
- D-02: Shows top 5 articles sorted by `view_count` descending
- D-03: Only articles with `view_count > 0` qualify; section hidden if none qualify
- D-04: Same card/list style as "Senast uppdaterade" for visual consistency
- D-05: Only published articles shown (exclude drafts)

**Cross-References — "Se även" (DISC-03, DISC-04)**
- D-06: New `kb_article_links` join table with `source_article_id` and `target_article_id` columns
- D-07: Bidirectional display: if A links to B, B's detail page also shows A in its "Se även" panel
- D-08: Storage is directional (only one row per link), but queries fetch both directions
- D-09: Link picker in article edit form: search/autocomplete dropdown to find and add related articles (similar UX to existing tag input)
- D-10: "Se även" panel displayed on article detail page below article content, above linked tickets section
- D-11: Each cross-ref shown as clickable link with article title and type badge

**Keyboard Shortcut — `/` (WF-02)**
- D-12: Global keyboard shortcut: pressing `/` focuses the KB search input on the KnowledgeBase page
- D-13: Shortcut suppressed when user is focused on text input, textarea, or contenteditable element
- D-14: No visual indicator needed — but search input can show a subtle kbd hint

**Ticket-to-KB Creation (WF-03)**
- D-15: "Skapa KB-artikel" button placed in the KBLinksSection area on ticket detail page
- D-16: Button navigates to KBArticleForm with query params: `?title={ticket.title}&article_type=solution`
- D-17: KBArticleForm reads query params to pre-fill title and article_type fields
- D-18: After article creation, optionally auto-link the new article back to the source ticket

### Claude's Discretion
- Exact styling of the "Se även" panel (cards vs simple links)
- Whether the popular section uses a different icon than "Senast uppdaterade"
- Search/autocomplete component implementation details for link picker
- Whether to show a small `⌘/` or just `/` kbd hint near the search input

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISC-02 | KB home shows "Populära artiklar" section based on view_count | Derived from already-loaded articles via useMemo; no extra API call needed |
| DISC-03 | Article detail shows "Se även" cross-references | New `kb_article_links` table; bidirectional query at GET /kb/articles/:id/links |
| DISC-04 | User can add/remove "Se även" links during article edit | Link picker (Command+Popover pattern from KBLinksSection); POST/DELETE /kb/articles/:id/links/:targetId |
| WF-02 | Keyboard shortcut `/` focuses KB search field | useEffect + document.addEventListener('keydown'); ref forwarded to search Input |
| WF-03 | From ticket detail, create KB article pre-filled with ticket title and type | useSearchParams in KBArticleForm; navigate with query string from TicketDetail/KBLinksSection |
</phase_requirements>

---

## Standard Stack

### Core (no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React Router DOM | already installed | `useSearchParams` for query param pre-fill | Already used in TicketList, UserList |
| shadcn/ui Command + Popover | already installed | Link picker autocomplete | Already used in KBLinksSection for ticket-to-KB linking |
| shadcn/ui Badge | already installed | Article type badge in Se även panel | Already used everywhere |
| better-sqlite3 | already installed | New kb_article_links table via connection.ts migration | All schema migrations go through connection.ts |
| lucide-react | already installed | Icons for new sections | All icons come from lucide-react |

### No New Installations Required

All required UI components, routing utilities, and database drivers are already in the project. This phase is purely additive — new components, new table, new routes, new API methods.

---

## Architecture Patterns

### Recommended Plan Split

```
Plan 1: Backend — schema + API (09-01)
  - ensureKbArticleLinksTable() migration in connection.ts
  - GET  /kb/articles/:id/links      (fetch bidirectional cross-refs)
  - POST /kb/articles/:id/links      (add link)
  - DELETE /kb/articles/:id/links/:targetId  (remove link)
  - api.ts client methods

Plan 2: Frontend — all four features (09-02)
  - KnowledgeBase.tsx: popular section + `/` shortcut
  - KBArticleDetail.tsx: "Se även" panel
  - KBArticleForm.tsx: link picker + useSearchParams pre-fill
  - KBLinksSection.tsx: "Skapa KB-artikel" button
```

### Pattern 1: Popular Articles — useMemo Derivation

Popular articles should be derived from the already-loaded `articles` array using `useMemo`, exactly like `recentlyUpdated` is derived today. No extra API call is needed since `view_count` is already returned on every `KbArticleRow`.

```typescript
// Source: KnowledgeBase.tsx existing pattern (lines 97-100)
const popularArticles = useMemo(
  () =>
    [...articles]
      .filter(a => a.view_count > 0)
      .sort((a, b) => b.view_count - a.view_count)
      .slice(0, 5),
  [articles]
);
```

The section renders only when `!hasActiveFilters && popularArticles.length > 0`, placed below the "Senast uppdaterade" section (after the existing `recentlyUpdated` block, before the full article list).

### Pattern 2: kb_article_links Schema Migration

Follows the exact same pattern as `ensureKbArticleTagsTable()` in connection.ts.

Table definition:

```sql
CREATE TABLE IF NOT EXISTS kb_article_links (
  id TEXT PRIMARY KEY,
  source_article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  target_article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_article_id, target_article_id)
);
CREATE INDEX IF NOT EXISTS idx_kb_article_links_source ON kb_article_links(source_article_id);
CREATE INDEX IF NOT EXISTS idx_kb_article_links_target ON kb_article_links(target_article_id);
```

Wrap in `ensureKbArticleLinksTable()` and call it at the end of `initializeDatabase()`.

### Pattern 3: Bidirectional Cross-Reference Query

Decision D-08 mandates directional storage but bidirectional display. The backend GET route fetches both directions with a UNION:

```sql
SELECT a.id, a.title, a.article_type, kl.id as link_id
FROM kb_article_links kl
JOIN kb_articles a ON a.id = kl.target_article_id
WHERE kl.source_article_id = @articleId AND a.status = 'published'
UNION
SELECT a.id, a.title, a.article_type, kl.id as link_id
FROM kb_article_links kl
JOIN kb_articles a ON a.id = kl.source_article_id
WHERE kl.target_article_id = @articleId AND a.status = 'published'
ORDER BY a.title ASC
```

The DELETE endpoint handles both directions:

```sql
DELETE FROM kb_article_links
WHERE (source_article_id = @a AND target_article_id = @b)
   OR (source_article_id = @b AND target_article_id = @a)
```

### Pattern 4: Se även Link Picker (Command + Popover)

`KBLinksSection.tsx` (lines 1-203) already implements exactly this pattern: a Popover wrapping a Command component with search, filtering out already-linked articles, and calling an API on selection. Reuse this approach in `KBArticleForm.tsx` for the cross-reference picker.

Key differences from KBLinksSection:
- Current article itself must be excluded from candidates (add `a.id !== currentArticleId` to filter)
- Links managed separately from the article save action (add/remove immediately via API, same as KBLinksSection)
- Link picker only shown in edit mode — new articles have no ID until created

**Recommended flow for edit mode:**
1. On mount (edit mode), call `GET /kb/articles/:id/links` to load existing cross-refs
2. Picker adds via `POST /kb/articles/:id/links`, removes via `DELETE /kb/articles/:id/links/:targetId`
3. Changes are immediate — no "save links" button needed

**For new article creation:** omit the picker entirely. After creation, user is redirected to the detail page and can navigate to edit mode to add cross-refs.

### Pattern 5: Keyboard Shortcut `/`

Attach a `keydown` listener to `document` via `useEffect` in `KnowledgeBase.tsx`, check `event.key === '/'`, verify the event target is not an input/textarea/contenteditable element (D-13), then call `.focus()` on a ref attached to the search Input.

```typescript
// Source: standard React pattern, verified against codebase patterns
const searchInputRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== '/') return;
    const target = e.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
    e.preventDefault();
    searchInputRef.current?.focus();
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, []);
```

Pass `ref={searchInputRef}` to the existing search `<Input>`. The existing Input renders a plain `<input>` element, so the ref works directly.

Optional kbd hint: render `<kbd>` element inside the search container. The search Input already has `pl-9` for the Search icon; add `pr-8` and position a `<kbd>` on the right.

### Pattern 6: Ticket-to-KB Creation (useSearchParams)

`KBArticleForm.tsx` currently has no query param reading. Add `useSearchParams` from react-router-dom (already imported in other pages). Use lazy `useState` initializers to read query params at mount, avoiding a flash:

```typescript
// Source: UserList.tsx line 54 pattern
import { useSearchParams } from 'react-router-dom';
const [searchParams] = useSearchParams();

const [title, setTitle] = useState(() => searchParams.get('title') ?? '');
const [articleType, setArticleType] = useState(
  () => searchParams.get('article_type') ?? 'none'
);
const [templateDismissed, setTemplateDismissed] = useState(
  () => !!(searchParams.get('title') || searchParams.get('article_type'))
);
const sourceTicketId = searchParams.get('ticket_id');
// After api.createKbArticle succeeds:
// if (sourceTicketId) await api.linkKbArticleToTicket(sourceTicketId, created.id);
```

The "Skapa KB-artikel" button goes in `KBLinksSection.tsx`. The component currently only receives `ticketId`; it also needs `ticketTitle` to construct the navigation URL. **Add `ticketTitle?: string` as a prop** and pass it from `TicketDetail.tsx` where `ticket.title` is already available. `KBLinksSection` is only rendered in one place (TicketDetail.tsx line 583), so the prop change is low-risk.

Navigation target:
```
/kb/new?title={encodeURIComponent(ticketTitle)}&article_type=solution&ticket_id={ticketId}
```

### Recommended Project Structure Changes

```
src/
├── pages/
│   ├── KnowledgeBase.tsx      — +popular section, +/ shortcut, +searchInputRef
│   ├── KBArticleDetail.tsx    — +Se även panel (new section, no layout change)
│   └── KBArticleForm.tsx      — +link picker (edit mode only), +useSearchParams pre-fill
├── components/
│   └── KBLinksSection.tsx     — +Skapa KB-artikel button, +ticketTitle prop
└── lib/
    └── api.ts                 — +4 cross-ref methods

server/src/
├── db/
│   └── connection.ts          — +ensureKbArticleLinksTable()
└── routes/
    └── kb.ts                  — +3 cross-ref endpoints
```

### Anti-Patterns to Avoid

- **Separate API call for popular articles**: `view_count` is already on every article row in the existing list response. Do not add a dedicated `/kb/articles/popular` endpoint — derive from loaded data.
- **Storing cross-refs bidirectionally (two rows)**: D-08 explicitly says one row per link. Don't insert both `(A→B)` and `(B→A)` — handle bidirectionality in the query.
- **Blocking the `/` shortcut on the wrong elements**: Check `tagName` (input, textarea) AND `isContentEditable` for the Tiptap editor. Missing `isContentEditable` breaks the shortcut inside the rich text editor.
- **Query param pre-fill via useEffect**: Use `useState` lazy initializer instead. A `useEffect` that sets state from query params causes a render flash and can conflict with the edit-mode article loading effect.
- **Showing the link picker on new article creation**: The new article has no ID yet, so cross-refs cannot be saved until the article is created. Limit the picker to edit mode only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Autocomplete search for link picker | Custom dropdown | shadcn Command + Popover | Already in KBLinksSection — copy the pattern |
| Keyboard shortcut | Custom hook | `document.addEventListener` in useEffect | Standard, no library needed |
| URL param reading | Manual `location.search` parsing | `useSearchParams` from react-router-dom | Already used in project, handles encoding |
| Schema migration | Raw SQL in route files | `ensureX()` functions in connection.ts | Every table in this project uses this pattern |

---

## Common Pitfalls

### Pitfall 1: Bidirectional Delete Logic

**What goes wrong:** DELETE `/kb/articles/:id/links/:targetId` only deletes where `source_article_id = id`. If the link was originally stored as `(targetId → id)`, the delete silently does nothing (0 rows changed), leaving a ghost link.

**Why it happens:** Links are stored directionally; the caller doesn't know which direction was used at creation time.

**How to avoid:** The DELETE SQL must match both orderings using `OR`:
```sql
WHERE (source_article_id = @a AND target_article_id = @b)
   OR (source_article_id = @b AND target_article_id = @a)
```

**Warning signs:** Removing a cross-ref from the picker has no visible effect; the link reappears after page reload.

### Pitfall 2: Self-Referencing Links

**What goes wrong:** The link picker allows the user to link an article to itself.

**Why it happens:** The filtering logic excludes already-linked articles but not the current article itself.

**How to avoid:** In the link picker's `availableArticles` filter, add `a.id !== currentArticleId` to the exclusion condition.

### Pitfall 3: `/` Shortcut Fires in Tiptap Editor

**What goes wrong:** User is typing in the article content editor; pressing `/` (common slash command in rich text editors) triggers the search focus instead.

**Why it happens:** The Tiptap editor renders a `div[contenteditable="true"]`, which `tagName !== 'input'` doesn't catch.

**How to avoid:** Check both `tag === 'input' || tag === 'textarea' || target.isContentEditable`. The `isContentEditable` check covers Tiptap.

### Pitfall 4: Template Picker Shown Over Pre-Filled Form

**What goes wrong:** User clicks "Skapa KB-artikel" from TicketDetail, arrives at the form with title pre-filled, but the template picker overlay appears.

**Why it happens:** `templateDismissed` defaults to `false` regardless of query params.

**How to avoid:** Initialize `templateDismissed` state with a lazy function that returns `true` when `article_type` or `title` query params are present.

### Pitfall 5: Popular Section Shows During Filter-Active State

**What goes wrong:** User applies a filter; "Populära artiklar" shows top-5 articles unrelated to the active filter.

**Why it happens:** Section shown unconditionally.

**How to avoid:** Gate the section on `!hasActiveFilters`, same as "Senast uppdaterade" (established behavior at KnowledgeBase.tsx line 361).

---

## Se även Panel Layout (KBArticleDetail)

Decision D-10: "below article content, above linked tickets section". Current content order in `KBArticleDetail.tsx`:

```
1. Back + actions bar
2. Share panel (conditional)
3. Article header (title, metadata, tags)
4. Content + ToC side-by-side
5. [NEW] Se även panel     ← insert here, with border-t + max-w-3xl
6. Linked Tickets panel    (currently starts at line 393)
```

Use the same `border-t` + `max-w-3xl pt-2` wrapper as the Linked Tickets panel for visual consistency.

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Fetch popular articles via dedicated endpoint | Derive from already-loaded list data via useMemo | No extra network call; view_count already in KbArticleRow |
| Bidirectional link storage (2 rows) | Directional storage + bidirectional query (UNION) | Less storage, no duplication or consistency issue |

---

## Open Questions

1. **Cross-ref picker during new article creation**
   - What we know: New articles have no ID until after `api.createKbArticle` resolves.
   - What's unclear: Desired UX — hide the section, show a disabled hint, or redirect to edit after creation.
   - Recommendation: Omit the picker during creation; show a note "Redigera artikeln för att lägga till Se även-kopplingar" or simply exclude the section. Simpler and avoids a two-step create-then-link flow.

2. **KBLinksSection prop change impact**
   - What we know: `KBLinksSection` only takes `ticketId` today; needs `ticketTitle` for the new button.
   - Recommendation: Add `ticketTitle?: string` prop. Verified: only one render site (TicketDetail.tsx line 583). Safe change.

---

## Environment Availability

Step 2.6: SKIPPED — phase is code/config changes only; no external dependencies beyond the existing Docker container runtime.

---

## Validation Architecture

`workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`. This section is omitted.

---

## Sources

### Primary (HIGH confidence)
- Direct source code reading: `KnowledgeBase.tsx`, `KBArticleDetail.tsx`, `KBArticleForm.tsx`, `KBLinksSection.tsx`, `TicketDetail.tsx` — all patterns verified in running code
- `server/src/routes/kb.ts` — backend route patterns, SQL query style, error handling conventions
- `server/src/db/connection.ts` — migration pattern via `ensureX()` functions, `kb_article_tags` as direct model for `kb_article_links`
- `src/lib/api.ts` — API client method conventions, request/response shapes
- `.planning/phases/09-*/09-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- React Router v6 `useSearchParams` — confirmed in use at `TicketList.tsx` line 29 and `UserList.tsx` line 54
- shadcn Command + Popover autocomplete — confirmed in `KBLinksSection.tsx` lines 6-18 and 106-155

### Tertiary (LOW confidence)
- None. All claims are backed by direct codebase inspection.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against actual imports and installed packages
- Architecture: HIGH — all patterns derived from existing codebase, not assumed
- Pitfalls: HIGH — identified by analyzing actual code paths, not from general knowledge

**Research date:** 2026-03-29
**Valid until:** Stable — no external dependencies; valid until codebase structure changes
