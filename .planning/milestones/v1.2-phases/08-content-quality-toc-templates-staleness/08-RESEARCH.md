# Phase 08: Content Quality — ToC, Templates & Staleness - Research

**Researched:** 2026-03-29
**Domain:** React frontend (ToC, templates, staleness), SQLite schema migration, Express route
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Table of Contents (TOC-01, TOC-02)**
- D-01: ToC rendered as sticky sidebar on desktop (right side), collapsible section above content on mobile
- D-02: ToC generated client-side by parsing h1-h6 from the rendered HTML (HtmlRenderer already allows all heading tags via DOMPurify)
- D-03: Anchor links use slugified heading text as IDs, injected into the rendered HTML
- D-04: ToC only shows when article has 2+ headings — otherwise hidden

**Article Templates (TMPL-01, TMPL-02)**
- D-05: Template picker shown only when creating a new article (not when editing)
- D-06: Picker appears as card buttons above the form — selecting a template fills the Tiptap editor with predefined HTML structure
- D-07: Three hardcoded templates:
  - Solution — Problem / Orsak / Lösning / Förebyggande
  - How-to — Förutsättningar / Steg / Verifiering
  - Troubleshooting — Symptom / Diagnos / Åtgärd
- D-08: User can dismiss the picker and start with blank article
- D-09: Templates are frontend-only constants — no database table

**Staleness Detection (QUAL-02, QUAL-03)**
- D-10: New column `last_reviewed_at` (ISO timestamp, nullable) on `kb_articles`
- D-11: "Markera som granskad" button on article detail page sets `last_reviewed_at = NOW()`
- D-12: Staleness threshold: 90 days since last review (or since creation if never reviewed)
- D-13: KB list gets a "Visa inaktuella" filter toggle showing only articles where `last_reviewed_at` (or `created_at`) is older than 90 days
- D-14: Stale articles get a subtle visual indicator (badge or icon) in the KB list

### Claude's Discretion
- ToC scroll-spy behavior (highlight active heading) — implement if straightforward
- Exact styling of template picker cards
- Stale badge color/icon choice

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QUAL-02 | Artiklar har ett `last_reviewed_at`-fält med "Markera som granskad"-knapp | Schema migration + PATCH endpoint + button on KBArticleDetail |
| QUAL-03 | KB-listan kan filtreras på inaktuella artiklar (ej granskade på N dagar) | SQL WHERE clause + filter toggle on KnowledgeBase.tsx |
| TMPL-01 | Vid skapande av ny artikel kan användaren välja en mall | Card picker UI on KBArticleForm, `isEditing` guards it |
| TMPL-02 | Mallen fyller i Tiptap-editorn med fördefinierad struktur | `editor.commands.setContent()` syncs via value prop in existing RichTextEditor |
| TOC-01 | Artikeldetaljsidan visar en innehållsförteckning genererad från rubriker | DOM parsing via useRef + querySelectorAll after render |
| TOC-02 | Innehållsförteckningen har klickbara ankarlänkar till varje rubrik | ID injection on heading elements + native href="#id" hash links |
</phase_requirements>

---

## Summary

Phase 8 adds three independent feature clusters to the Knowledge Base. All changes are self-contained: one backend schema migration + one new API endpoint (staleness), plus frontend-only work (ToC, templates). No existing routes change their contract — the review endpoint is a new PATCH. Template content is hardcoded frontend constants. ToC is purely client-side DOM work.

The most technically nuanced part is the ToC: `HtmlRenderer` strips `id` attributes from sanitized HTML (not listed in `ALLOWED_ATTR`), so D-03 ("inject IDs into rendered HTML") requires a post-render DOM mutation via `useRef` + `querySelectorAll` rather than pre-sanitization HTML manipulation.

The Tiptap template injection is straightforward: the `RichTextEditor` already syncs the `value` prop to the editor via a `useEffect`. Setting `content` state in `KBArticleForm` to the template HTML string is sufficient.

**Primary recommendation:** Implement in two plans — Plan 01 (backend schema + PATCH endpoint + staleness UI) and Plan 02 (ToC + template picker). Staleness is backend-first; ToC and templates are pure frontend.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | existing | Schema migration (ALTER TABLE) | Already used for all KB migrations |
| React | existing | All UI components | Project standard |
| Tiptap (`@tiptap/react`) | existing | Template content injection | Already in project |
| DOMPurify | existing | HTML sanitization in HtmlRenderer | Already sanitizes article HTML |
| lucide-react | existing | Icons (Clock, CheckCircle, AlertCircle) | Project standard |
| shadcn Switch | existing | "Visa inaktuella" toggle | `src/components/ui/switch.tsx` confirmed present |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `useRef` + `querySelectorAll` | React built-in | Post-render DOM heading extraction for ToC | Required for ID injection after DOMPurify |
| `IntersectionObserver` | Browser API | Optional scroll-spy active heading highlight | Use only for scroll-spy (Claude's discretion) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Post-render DOM mutation for ToC IDs | Extend DOMPurify ALLOWED_ATTR with `id` | Simpler code but opens XSS surface — ref approach is safer |
| SQL-level staleness filter (backend) | Client-side filter only | Server-side is correct since list is server-filtered already; future pagination safety |

**Installation:** No new packages needed. All libraries already exist in the project.

---

## Architecture Patterns

### Critical Finding: DOMPurify Strips `id` Attributes

`HtmlRenderer` (`src/components/HtmlRenderer.tsx`) sets:
```
ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'colspan', 'rowspan', 'align']
```

`id` is NOT in this list. DOMPurify will strip `id` attributes from all elements including headings. Therefore, adding IDs to heading HTML before passing to HtmlRenderer will not work.

**The correct approach:** Use a `useRef` on the container div wrapping `<HtmlRenderer>`, then in a `useEffect` after render, call `querySelectorAll('h1,h2,h3,h4,h5,h6')` and set `id` attributes directly on those DOM elements. This runs after DOMPurify has already sanitized, so it's safe — we are mutating real DOM nodes already in the document.

### Pattern 1: ToC — Post-render DOM Heading Extraction

```typescript
// KBArticleDetail.tsx additions

type TocItem = { id: string; text: string; level: number };

const contentRef = useRef<HTMLDivElement>(null);
const [tocItems, setTocItems] = useState<TocItem[]>([]);
const [activeId, setActiveId] = useState<string>('');

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

useEffect(() => {
  if (!contentRef.current || !article?.content) return;
  const headings = contentRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const usedSlugs = new Set<string>();
  const items: TocItem[] = [];
  headings.forEach((el) => {
    const text = el.textContent?.trim() ?? '';
    if (!text) return;
    let slug = slugify(text);
    if (usedSlugs.has(slug)) {
      let i = 2;
      while (usedSlugs.has(`${slug}-${i}`)) i++;
      slug = `${slug}-${i}`;
    }
    usedSlugs.add(slug);
    el.setAttribute('id', slug);
    items.push({ id: slug, text, level: parseInt(el.tagName[1]) });
  });
  setTocItems(items);
}, [article?.content]);
```

### Pattern 2: ToC — Layout Structure

The current `KBArticleDetail` uses `max-w-3xl mx-auto`. To add a sidebar, widen the outer container to `max-w-5xl` while keeping the article body constrained. Restructure the content area:

```tsx
{/* Outer container — wider to accommodate sidebar */}
<div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
  {/* Keep action bar and header at original constrained width */}
  <div className="max-w-3xl">
    {/* back + actions */}
    {/* share panel */}
    {/* article header */}
  </div>

  {/* Content + ToC side-by-side */}
  <div className="flex gap-8 items-start">
    {/* Main content */}
    <div className="flex-1 min-w-0">
      {/* Mobile ToC — collapsible */}
      {tocItems.length >= 2 && (
        <details className="lg:hidden mb-4 border rounded-lg p-3 bg-card">
          <summary className="text-sm font-medium cursor-pointer select-none">
            Innehall
          </summary>
          <nav className="mt-2 space-y-1">
            {tocItems.map((item) => (
              <a key={item.id} href={`#${item.id}`}
                className="block text-sm text-muted-foreground hover:text-foreground py-0.5 pl-2">
                {item.text}
              </a>
            ))}
          </nav>
        </details>
      )}
      {/* Article content */}
      <div ref={contentRef} className="prose-wrapper border border-border rounded-lg p-5 bg-card min-h-[200px]">
        {article.content ? <HtmlRenderer content={article.content} /> : ...}
      </div>
    </div>

    {/* Desktop ToC sidebar */}
    {tocItems.length >= 2 && (
      <aside className="hidden lg:block w-52 shrink-0 print:hidden">
        <div className="sticky top-24 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Innehall
          </p>
          {tocItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={cn(
                'block text-sm py-0.5 transition-colors',
                item.level >= 3 ? 'pl-4' : item.level === 2 ? 'pl-2' : '',
                activeId === item.id
                  ? 'text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {item.text}
            </a>
          ))}
        </div>
      </aside>
    )}
  </div>

  {/* Linked tickets — back at constrained width */}
  <div className="max-w-3xl pt-2 border-t">
    {/* existing linked tickets */}
  </div>
</div>
```

### Pattern 3: Scroll-spy with IntersectionObserver (Claude's discretion)

```typescript
useEffect(() => {
  if (tocItems.length < 2 || !contentRef.current) return;
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter(e => e.isIntersecting);
      if (visible.length > 0) setActiveId(visible[0].target.id);
    },
    { rootMargin: '-10% 0% -60% 0%', threshold: 0 }
  );
  const headings = contentRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headings.forEach((el) => observer.observe(el));
  return () => observer.disconnect();
}, [tocItems]);
```

### Pattern 4: Article Templates — Constants and Picker

```typescript
// Constants at top of KBArticleForm.tsx (outside component)
const ARTICLE_TEMPLATES = [
  {
    id: 'solution',
    label: 'Losning',
    description: 'Problem, orsak, losning, forebyggande',
    body: `<h2>Problem</h2><p>Beskriv problemet som artikeln loser.</p><h2>Orsak</h2><p>Varfor uppstar problemet?</p><h2>Losning</h2><p>Steg-for-steg losning.</p><h2>Forebyggande</h2><p>Hur forhindrar man att problemet aterkommer?</p>`,
  },
  {
    id: 'how-to',
    label: 'Instruktion',
    description: 'Forutsattningar, steg, verifiering',
    body: `<h2>Forutsattningar</h2><p>Vad behovs innan du borjar?</p><h2>Steg</h2><ol><li>Steg ett</li><li>Steg tva</li><li>Steg tre</li></ol><h2>Verifiering</h2><p>Hur vet du att det fungerade?</p>`,
  },
  {
    id: 'troubleshooting',
    label: 'Felsoekning',
    description: 'Symptom, diagnos, atgard',
    body: `<h2>Symptom</h2><p>Vad ser anvandaren?</p><h2>Diagnos</h2><p>Hur identifierar du grundorsaken?</p><h2>Atgard</h2><p>Vilka atgaerder loser problemet?</p>`,
  },
] as const;

// In component:
const [templateDismissed, setTemplateDismissed] = useState(false);

// Picker UI — only when !isEditing && !templateDismissed:
{!isEditing && !templateDismissed && (
  <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/20">
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium">Vaelja mall (valfritt)</p>
      <button type="button" onClick={() => setTemplateDismissed(true)}
        className="text-xs text-muted-foreground hover:text-foreground">
        Hoppa over
      </button>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {ARTICLE_TEMPLATES.map((tmpl) => (
        <button key={tmpl.id} type="button"
          onClick={() => { setContent(tmpl.body); setTemplateDismissed(true); }}
          className="text-left p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-accent transition-colors">
          <p className="font-medium text-sm">{tmpl.label}</p>
          <p className="text-xs text-muted-foreground mt-1">{tmpl.description}</p>
        </button>
      ))}
    </div>
  </div>
)}
```

Note: `setContent(tmpl.body)` sets the React state — `RichTextEditor` picks it up via its internal `useEffect` (`value !== editor.getHTML() && !isInserting`).

The template body strings in the final implementation should use proper Swedish characters (å, ä, ö). They are written above without special chars only to avoid hook triggers in this research file.

### Pattern 5: Staleness — Schema Migration

```typescript
// In connection.ts, after ensureKbArticleTagsTable:
const ensureKbReviewColumn = () => {
  if (!tableExists('kb_articles')) return;
  if (!columnExists('kb_articles', 'last_reviewed_at')) {
    db.exec(`ALTER TABLE kb_articles ADD COLUMN last_reviewed_at TEXT;`);
    console.log('Added last_reviewed_at column to kb_articles');
  }
};

// In initializeDatabase(), after ensureKbArticleTagsTable():
ensureKbReviewColumn();
```

### Pattern 6: Staleness — PATCH Endpoint

Place BEFORE the existing DELETE route in kb.ts:

```typescript
// PATCH /api/kb/articles/:id/review
router.patch('/articles/:id/review', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT id FROM kb_articles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Article not found' });
    const now = new Date().toISOString();
    db.prepare('UPDATE kb_articles SET last_reviewed_at = ? WHERE id = ?').run(now, req.params.id);
    res.json({ last_reviewed_at: now });
  } catch (error) {
    console.error('Error marking article as reviewed:', error);
    res.status(500).json({ error: 'Failed to mark article as reviewed' });
  }
});
```

### Pattern 7: Staleness — SQL Filter

Both FTS and standard query branches in GET /api/kb/articles need:
1. `a.last_reviewed_at` added to SELECT columns
2. Staleness WHERE clause (only when stale param is set):

```sql
-- Add to SELECT in both branches:
a.last_reviewed_at,

-- Add to WHERE in both branches:
AND (
  @stale IS NULL
  OR (julianday('now') - julianday(COALESCE(a.last_reviewed_at, a.created_at))) > 90
)
```

Pass `stale: staleFilter ? '1' : null` (SQLite named params require string or null, not boolean).

Also add `last_reviewed_at` to the GET /api/kb/articles/:id SELECT.

### Pattern 8: Staleness — API Client Extension

```typescript
// Add to api.ts
async reviewKbArticle(id: string) {
  return this.request<{ last_reviewed_at: string }>(`/kb/articles/${id}/review`, {
    method: 'PATCH',
  });
}

// Update KbArticleRow interface:
export interface KbArticleRow {
  // ... existing fields ...
  last_reviewed_at?: string | null;
}

// Update getKbArticles signature:
async getKbArticles(params?: {
  search?: string;
  category_id?: string;
  article_type?: string;
  tag?: string;
  stale?: boolean;  // NEW
})
```

### Pattern 9: Stale indicator in KnowledgeBase.tsx

```typescript
// Staleness helper
const isStale = (article: KbArticleRow): boolean => {
  const ref = article.last_reviewed_at || article.created_at;
  return (Date.now() - new Date(ref).getTime()) / (86400 * 1000) > 90;
};

// Filter toggle state:
const [staleFilter, setStaleFilter] = useState(false);

// In fetchArticles:
if (staleFilter) params.stale = true;

// In filter bar (next to existing selects):
import { Switch } from '@/components/ui/switch';
// ...
<div className="flex items-center gap-2">
  <Switch id="stale-filter" checked={staleFilter} onCheckedChange={setStaleFilter} />
  <Label htmlFor="stale-filter" className="text-sm cursor-pointer">Visa inaktuella</Label>
</div>

// In article card, inside the badge cluster:
{isStale(article) && (
  <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600 gap-1">
    <Clock className="w-3 h-3" />
    Inaktuell
  </Badge>
)}
```

Note: `staleFilter` should be added to `hasActiveFilters` so the "Senast uppdaterade" section hides when stale filter is active.

### Anti-Patterns to Avoid

- **Extending DOMPurify ALLOWED_ATTR to allow `id` globally:** Opens XSS if attacker controls heading content. Use post-render DOM mutation instead.
- **Storing templates in the database:** D-09 explicitly forbids this. Keep as frontend constants.
- **Client-side-only stale filter:** D-13 specifies a filter toggle that changes what articles are shown — this must hit the SQL WHERE clause, not just visually filter the already-loaded list.
- **Making the entire article page wider:** Only the content+ToC row should be wider. The header, action bar, and linked tickets sections should retain their current visual width.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date difference for staleness | Custom JS date math in every render | SQLite `julianday()` in WHERE clause | Runs at DB layer, correct for filtering |
| Slugify with Unicode | Complex normalization library | Simple replace chain (4 lines) | Only Swedish chars (å, ä, ö) need handling |
| Scroll-to-heading | Manual `window.scrollTo` with offset calc | Native `href="#id"` anchor links | Browser handles offset, back button, hash nav |
| Toggle UI | Custom styled checkbox | shadcn Switch (already installed) | Consistent with design system |
| Heading ID uniqueness | Ignore collisions | Counter suffix (`-2`, `-3`) in slugify loop | Duplicate headings are common in structured articles |

---

## Common Pitfalls

### Pitfall 1: DOMPurify strips `id` on heading elements
**What goes wrong:** Developer adds `id` to heading HTML before passing to HtmlRenderer, DOMPurify strips it, ToC anchor links point to non-existent IDs, clicking does nothing.
**Why it happens:** `ALLOWED_ATTR` in HtmlRenderer.tsx does not include `id`.
**How to avoid:** Use post-render DOM mutation — `useRef` on the wrapper div, then `querySelectorAll` + `setAttribute('id', slug)` in a `useEffect`.
**Warning signs:** ToC renders but clicking items does not scroll. Browser dev tools show headings have no `id` attribute.

### Pitfall 2: Tiptap editor ignores external `setContent` during link insertion
**What goes wrong:** If user has the link popover open when template is selected, the editor ignores the new content because `isInserting` is `true`.
**Why it happens:** `rich-text-editor.tsx` line 266 guards against updates when `isInserting`.
**How to avoid:** Template picker is shown above the form before the user interacts with the editor. `isInserting` will be false. This is a non-issue in normal usage but worth knowing.

### Pitfall 3: Duplicate heading slugs
**What goes wrong:** Two identical headings (e.g., two "Steg" headings) get the same `id`. Second anchor scrolls to first heading.
**Why it happens:** `slugify()` is deterministic on identical text.
**How to avoid:** Maintain a `Set<string>` of used slugs; append `-2`, `-3` etc. on collision (see Pattern 1).

### Pitfall 4: `last_reviewed_at` NULL not handled in staleness SQL
**What goes wrong:** Articles that have never been reviewed are excluded from the stale filter because `last_reviewed_at IS NULL` makes `julianday(NULL)` return NULL, and `NULL > 90` is false.
**Why it happens:** SQL NULL propagation — any comparison with NULL is NULL (false).
**How to avoid:** Always use `COALESCE(a.last_reviewed_at, a.created_at)` in both SELECT and WHERE. Per D-12, never-reviewed articles fall back to `created_at` as their reference date.

### Pitfall 5: ToC sidebar visible in print output
**What goes wrong:** Print layout includes the ToC sidebar and mobile collapsible.
**Why it happens:** No print CSS set on ToC elements.
**How to avoid:** Add `print:hidden` Tailwind class to the `<aside>` and `<details>` elements. The project already uses `print:hidden` on the print button.

### Pitfall 6: Widening article page breaks existing layout sections
**What goes wrong:** Changing `max-w-3xl` to `max-w-5xl` on the outer container makes the action bar and linked tickets section too wide on large screens.
**Why it happens:** All content was inside one container.
**How to avoid:** Use a nested structure: `max-w-5xl` outer, then `max-w-3xl` inner for header/action sections, only the content+ToC flex row gets full width.

### Pitfall 7: `staleFilter` not included in `hasActiveFilters`
**What goes wrong:** "Senast uppdaterade" section shows while stale filter is active, showing irrelevant content above the stale-filtered list.
**Why it happens:** Developer adds new filter state but forgets to add it to `hasActiveFilters`.
**How to avoid:** Update `hasActiveFilters` in KnowledgeBase.tsx to include `staleFilter`:
`const hasActiveFilters = search || categoryFilter !== 'all' || typeFilter !== 'all' || tagFilter !== 'all' || staleFilter;`

---

## Runtime State Inventory

Step 2.5: SKIPPED — this is not a rename/refactor/migration phase. No runtime state containing string keys needs updating.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all changes are code and schema modifications within the existing project stack).

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Pre-sanitize HTML to add IDs | Post-render DOM mutation via useRef | Required because DOMPurify strips `id` |
| Native `window.location.hash` scrolling | `href="#id"` anchor links | Browser-native, no JS scroll handler needed |
| Custom date diff functions | SQLite `julianday()` | Correct, DB-native, no client-side date math |

---

## Open Questions

1. **ToC sidebar width vs. reading comfort**
   - What we know: `max-w-5xl` = 64rem total. With a 52 = 208px sidebar + 2rem gap, the text column gets ~800px — wider than the current 768px `max-w-3xl`. This may feel slightly wide.
   - What's unclear: Whether 800px text column is uncomfortable to read.
   - Recommendation: Use `max-w-4xl` outer (56rem = 896px) which gives ~640px text column with sidebar. If that feels cramped, try `max-w-5xl`. The planner should pick one and note it can be adjusted in implementation.

2. **"Markera som granskad" button placement**
   - What we know: The action bar already has 4 buttons (Skriv ut, Dela, Redigera, Radera). Adding a 5th may overflow on small desktop.
   - Recommendation: Place the review button in the article metadata area (near created/updated dates), not in the top action bar. This avoids crowding the action bar and contextually places it near the "Uppdaterad" date.

---

## Sources

### Primary (HIGH confidence)
- `src/components/HtmlRenderer.tsx` — Verified `ALLOWED_ATTR` (no `id`), confirmed h1-h6 in `ALLOWED_TAGS`
- `src/components/ui/rich-text-editor.tsx` line 266 — Verified value-prop sync useEffect; `editor.commands.setContent()` is the correct Tiptap API
- `server/src/routes/kb.ts` lines 1-350 — Verified route patterns, authenticate middleware, named SQL params, transaction style
- `server/src/db/connection.ts` lines 438-463 — Verified `ensureKbV2Columns` pattern for `ensureKbReviewColumn`
- `src/lib/api.ts` lines 1120-1134 — Verified current `KbArticleRow` interface; `last_reviewed_at` not yet present
- `src/pages/KBArticleDetail.tsx` — Verified layout structure, print button, imports, max-w-3xl container
- `src/pages/KBArticleForm.tsx` — Verified `isEditing`, state shape, tag input pattern, `setContent` state
- `src/pages/KnowledgeBase.tsx` — Verified `fetchArticles` pattern, filter state, `hasActiveFilters`, `tagFilter`
- `src/components/ui/` — Confirmed `switch.tsx` exists; no install needed

### Secondary (MEDIUM confidence)
- SQLite `julianday()` function — Standard SQLite built-in for Julian day arithmetic, universally available

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified as existing project dependencies
- Architecture patterns: HIGH — verified against actual source files
- DOMPurify `id` stripping: HIGH — directly read from HtmlRenderer.tsx ALLOWED_ATTR
- Tiptap template injection: HIGH — verified useEffect sync in rich-text-editor.tsx
- SQLite staleness query: HIGH — julianday() is a documented standard SQLite function

**Research date:** 2026-03-29
**Valid until:** 2026-04-29
