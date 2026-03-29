---
phase: 08-content-quality-toc-templates-staleness
verified: 2026-03-29T16:30:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Click 'Markera som granskad' on an article with no prior review date"
    expected: "Button label changes to 'Granskad {today's date}' and a success toast appears"
    why_human: "Optimistic state update and toast require live browser interaction"
  - test: "Open a KB article with 2+ headings on a desktop viewport"
    expected: "Sticky ToC sidebar appears on the right side; scrolling past a heading highlights the corresponding ToC entry"
    why_human: "IntersectionObserver scroll-spy behaviour and sticky positioning require a running browser"
  - test: "Open a KB article with 2+ headings on a mobile viewport (< lg breakpoint)"
    expected: "Sticky sidebar is hidden; a collapsed 'Innehåll' details/summary element appears above the article content"
    why_human: "Responsive breakpoint rendering requires browser"
  - test: "Click a ToC anchor link"
    expected: "Page scrolls to the corresponding heading smoothly"
    why_human: "Anchor scroll-target IDs are injected via post-render DOM mutation — requires live DOM"
  - test: "Create a new KB article and select the 'Lösning' template"
    expected: "Tiptap editor fills with Problem/Orsak/Lösning/Förebyggande structure and template picker disappears"
    why_human: "Tiptap editor sync via internal useEffect and template picker dismissal need browser interaction"
  - test: "Enable 'Visa inaktuella' toggle on the KB list"
    expected: "Only articles not reviewed (or created) in the last 90 days are shown; each shows an amber 'Inaktuell' badge"
    why_human: "Stale calculation depends on real article data and client-side date arithmetic; confirm in a live environment"
---

# Phase 8: Content Quality — ToC, Templates, Staleness Verification Report

**Phase Goal:** Make the KB a trustworthy reference with structured content, templates for consistency, and staleness detection.
**Verified:** 2026-03-29T16:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Article detail page shows 'Markera som granskad' button that updates last_reviewed_at timestamp | VERIFIED | `handleMarkReviewed` at KBArticleDetail.tsx:150, calls `api.reviewKbArticle(id)`, optimistic update at line 155, button text at line 314-316 |
| 2  | KB list shows 'Visa inaktuella' toggle that filters to articles not reviewed in 90+ days | VERIFIED | `Switch` + `Label "Visa inaktuella"` at KnowledgeBase.tsx:337-338; staleFilter passed to `getKbArticles` at line 65; `@stale` SQL param in both FTS and standard branches of kb.ts |
| 3  | Stale articles display an amber 'Inaktuell' badge in the KB list | VERIFIED | `isStale` helper at KnowledgeBase.tsx:83; amber badge with `AlertTriangle` icon at line 422-425 |
| 4  | Never-reviewed articles fall back to created_at for staleness calculation | VERIFIED | `COALESCE(a.last_reviewed_at, a.created_at)` in both SQL branches (kb.ts:176, 192); `isStale` uses `article.last_reviewed_at \|\| article.created_at` (KnowledgeBase.tsx:84) |
| 5  | Article detail page shows a table of contents sidebar on desktop when article has 2+ headings | VERIFIED | `aside.hidden.lg:block.w-52` guarded by `tocItems.length >= 2` at KBArticleDetail.tsx:367-368 |
| 6  | ToC is a collapsible section above content on mobile | VERIFIED | `details.lg:hidden` guarded by `tocItems.length >= 2` at KBArticleDetail.tsx:333-334 |
| 7  | Clicking a ToC entry scrolls to the corresponding heading via anchor link | VERIFIED | `href={\`#${item.id}\`}` at lines 342 and 376; headings receive IDs via `el.setAttribute('id', slug)` at line 86 (post-render DOM mutation, bypasses DOMPurify) |
| 8  | ToC is hidden when article has fewer than 2 headings | VERIFIED | `tocItems.length >= 2` guard present on both mobile and desktop renders (2 occurrences confirmed) |
| 9  | New article form shows a template picker with 3 template cards | VERIFIED | `ARTICLE_TEMPLATES` const with ids `solution`, `how-to`, `troubleshooting` at KBArticleForm.tsx:14-36 |
| 10 | Selecting a template fills the Tiptap editor with predefined Swedish-language structure | VERIFIED | `onClick={() => { setContent(tmpl.body); setTemplateDismissed(true); }}` at KBArticleForm.tsx:184; proper Swedish characters confirmed (Lösning, Instruktion, Felsökning) |
| 11 | Template picker can be dismissed to start with blank article | VERIFIED | "Hoppa över" button at KBArticleForm.tsx:173 calls `setTemplateDismissed(true)` |
| 12 | Template picker is not shown when editing an existing article | VERIFIED | `!isEditing && !templateDismissed` guard at KBArticleForm.tsx:167 |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/db/connection.ts` | ensureKbReviewColumn migration | VERIFIED | `const ensureKbReviewColumn` at line 465; `ensureKbReviewColumn()` call at line 526 inside `initializeDatabase()` |
| `server/src/routes/kb.ts` | PATCH /api/kb/articles/:id/review endpoint + stale filter SQL | VERIFIED | `router.patch('/articles/:id/review', ...)` at line 356; `julianday('now') - julianday(COALESCE(...))` at lines 176 and 192 |
| `src/lib/api.ts` | reviewKbArticle + stale param + last_reviewed_at on KbArticleRow | VERIFIED | `async reviewKbArticle(id: string)` at line 796; `stale?: boolean` in getKbArticles params at line 781; `last_reviewed_at?: string \| null` on KbArticleRow at line 1141 |
| `src/pages/KnowledgeBase.tsx` | Stale filter toggle and stale badge | VERIFIED | `staleFilter` state at line 39; Switch toggle at line 337; amber `Inaktuell` badge at line 422; `hasActiveFilters` includes `staleFilter` at line 102 |
| `src/pages/KBArticleDetail.tsx` | Markera som granskad button + ToC sidebar | VERIFIED | Review button at line 310; `tocItems` state, `contentRef`, `slugify`, `IntersectionObserver`, `sticky top-24` all present; `max-w-4xl` outer container at line 182 |
| `src/pages/KBArticleForm.tsx` | Template picker with 3 hardcoded templates | VERIFIED | `ARTICLE_TEMPLATES` const array at line 14; `templateDismissed` state at line 51; template picker UI guarded by `!isEditing && !templateDismissed` at line 167 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `KBArticleDetail.tsx` | `/api/kb/articles/:id/review` | `api.reviewKbArticle(id)` | WIRED | Called at line 154; response used to update article state at line 155 |
| `KnowledgeBase.tsx` | `/api/kb/articles?stale=1` | `api.getKbArticles({ stale: true })` | WIRED | `staleFilter` added to params at KnowledgeBase.tsx:65; `qs.set('stale', '1')` in api.ts:787 |
| `server/src/routes/kb.ts` | `kb_articles.last_reviewed_at` | `COALESCE(a.last_reviewed_at, a.created_at)` | WIRED | `stale: stale \|\| null` bound in both .all() calls (lines 178, 194); SQL WHERE clause uses `@stale` correctly |
| `KBArticleDetail.tsx ToC links` | heading elements in rendered HTML | `href=#slug` pointing to IDs set by DOM mutation | WIRED | `el.setAttribute('id', slug)` at line 86; `href={\`#${item.id}\`}` on both mobile (line 342) and desktop (line 376) |
| `KBArticleForm.tsx template picker` | RichTextEditor value prop | `setContent(tmpl.body)` updating state that RichTextEditor syncs | WIRED | `setContent(tmpl.body)` at line 184; `templateDismissed` set true to dismiss picker |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `KnowledgeBase.tsx` amber badge | `isStale(article)` | `article.last_reviewed_at \|\| article.created_at` from API response | Yes — real DB column returned by GET /api/kb/articles | FLOWING |
| `KBArticleDetail.tsx` review button label | `article.last_reviewed_at` | PATCH response updates article state; initial load from GET /api/kb/articles/:id | Yes — column in DB, returned in SELECT | FLOWING |
| `KBArticleDetail.tsx` ToC items | `tocItems` | Post-render DOM query on actual rendered headings in `contentRef` | Yes — derived from live DOM, not hardcoded | FLOWING |
| `KBArticleForm.tsx` editor content | `content` state | `setContent(tmpl.body)` on template select | Yes — predefined HTML bodies in ARTICLE_TEMPLATES const | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration function defined in connection.ts | `grep -c "ensureKbReviewColumn" server/src/db/connection.ts` | 2 (defined + called) | PASS |
| PATCH review endpoint exists in kb.ts | `grep -c "router.patch.*review" server/src/routes/kb.ts` | 1 | PASS |
| Stale SQL in both FTS and standard branches | `grep -c "julianday.*COALESCE" server/src/routes/kb.ts` | 2 | PASS |
| TypeScript compiles without errors | `npx tsc --noEmit` | No output (clean) | PASS |
| All 4 feature commits exist in git history | `git log --oneline 15595b3 3c3ab5b 0bbf030 d3a73b6` | All 4 found | PASS |
| ToC hidden-in-print classes present | `grep -c "print:hidden" src/pages/KBArticleDetail.tsx` | 3 (print button + 2 ToC elements) | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| QUAL-02 | 08-01-PLAN.md | Artiklar har ett `last_reviewed_at`-fält med "Markera som granskad"-knapp | SATISFIED | Migration, PATCH endpoint, and review button all implemented and wired |
| QUAL-03 | 08-01-PLAN.md | KB-listan kan filtreras på inaktuella artiklar (ej granskade på N dagar) | SATISFIED | staleFilter toggle wired to `?stale=1` param; SQL uses julianday COALESCE with 90-day threshold |
| TMPL-01 | 08-02-PLAN.md | Vid skapande av ny artikel kan användaren välja en mall (t.ex. Solution, How-to) | SATISFIED | 3-card template picker shown for new articles only, guarded by `!isEditing && !templateDismissed` |
| TMPL-02 | 08-02-PLAN.md | Mallen fyller i Tiptap-editorn med fördefinierad struktur | SATISFIED | `setContent(tmpl.body)` wires selection to editor; RichTextEditor syncs via value prop |
| TOC-01 | 08-02-PLAN.md | Artikeldetaljsidan visar en innehållsförteckning genererad från rubriker i artikeln | SATISFIED | Post-render DOM query extracts h1-h6, slugify builds IDs, tocItems state drives rendering |
| TOC-02 | 08-02-PLAN.md | Innehållsförteckningen har klickbara ankarlänkar till varje rubrik | SATISFIED | `href={\`#${item.id}\`}` on each ToC link; IDs injected via DOM mutation to match DOMPurify-rendered headings |

No orphaned requirements — all 6 phase IDs are claimed in PLAN frontmatter and verified.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/pages/KBArticleForm.tsx` | 205, 215, 233, 272, 283 | `placeholder=` attribute | INFO | These are standard HTML form input placeholders, not stub implementations. Not a concern. |
| `src/pages/KnowledgeBase.tsx` | 272, 296, 304, 317, 327 | `placeholder=` attribute | INFO | Same — form input placeholders, not stubs. |

No blockers or warnings found.

---

### Human Verification Required

#### 1. Review Button State Transition

**Test:** Open any KB article and click "Markera som granskad"
**Expected:** Button label changes immediately to "Granskad {today's date}" and a green success toast appears; re-opening the article shows the same reviewed date
**Why human:** Optimistic state update and toast notification require live browser interaction

#### 2. Desktop ToC Sidebar with Scroll-Spy

**Test:** Open a KB article that contains at least 2 headings on a desktop viewport (>= 1024px wide)
**Expected:** A sticky ToC sidebar appears on the right side of the article content; as you scroll past headings the corresponding ToC entry is highlighted in the primary color
**Why human:** IntersectionObserver and sticky positioning require a running browser

#### 3. Mobile ToC Collapsible

**Test:** Open the same article on a mobile/narrow viewport (< 1024px)
**Expected:** The right-side sidebar is not visible; a collapsible "Innehåll" summary/details element appears above the article body and expands when clicked
**Why human:** Responsive CSS breakpoints require browser rendering

#### 4. ToC Anchor Scroll

**Test:** Click any entry in the ToC sidebar or mobile ToC
**Expected:** The page scrolls to the corresponding heading element
**Why human:** Anchor targets are injected by a post-render useEffect; the DOM linkage cannot be verified statically

#### 5. Template Picker End-to-End

**Test:** Navigate to "Ny artikel" and select the "Instruktion" template
**Expected:** The Tiptap editor fills with Förutsättningar / Steg / Verifiering structure, the template picker disappears, and editing an existing article never shows the picker
**Why human:** Tiptap value-prop sync and picker dismissal require browser interaction

#### 6. Stale Filter in Context

**Test:** Enable "Visa inaktuella" toggle in the KB list
**Expected:** Only articles whose last_reviewed_at (or created_at if never reviewed) is older than 90 days appear; each card shows the amber "Inaktuell" badge; the toggle counts in hasActiveFilters so "Senast uppdaterade" section is hidden
**Why human:** Stale results depend on real article ages in the database — must be confirmed with live data

---

### Gaps Summary

No gaps. All 12 observable truths are verified, all 6 artifacts pass all four verification levels (exists, substantive, wired, data-flowing), all 5 key links are confirmed wired, all 6 requirement IDs are satisfied, TypeScript compiles clean, and all 4 feature commits exist in git history.

Phase goal achieved: the KB is a trustworthy reference with staleness detection (QUAL-02, QUAL-03), article templates (TMPL-01, TMPL-02), and navigable table of contents (TOC-01, TOC-02).

---

_Verified: 2026-03-29T16:30:00Z_
_Verifier: Claude (gsd-verifier)_
