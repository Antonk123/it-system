# Requirements: IT Ticket System — Milestone 1

**Defined:** 2026-03-22
**Core Value:** Every ticket gets tracked, resolved, and documented — nothing falls through the cracks and solutions are reusable.

## v1 Requirements

### Reports

- [x] **RPT-01**: Reports analytics compute on the full ticket dataset via a dedicated backend endpoint (currently computed client-side on paginated data — produces wrong charts)
- [ ] **RPT-02**: Category breakdown chart showing ticket counts per category
- [ ] **RPT-03**: Open vs. closed trend overlay on the existing timeline chart
- [ ] **RPT-04**: Print-optimized CSS on reports page so browser print-to-PDF produces a clean output

### Knowledge Base

- [ ] **KB-01**: KB search uses SQLite FTS5 virtual table (replacing current LIKE queries) with snippet highlighting in results
- [ ] **KB-02**: FTS5 indexing strips HTML tags before indexing so Tiptap markup does not pollute search tokens
- [ ] **KB-03**: API endpoint `GET /api/kb/articles/:id/tickets` returns tickets linked to a KB article
- [ ] **KB-04**: "Linked Tickets" panel visible in KB article detail page
- [ ] **KB-05**: KB articles have an optional `article_type` field (e.g. "how-to" or "solution"); existing articles default to null

### Archive

- [ ] **ARCH-01**: Archive page supports filtering by closed date range (from/to date pickers)
- [ ] **ARCH-02**: Database index on `(status, closed_at)` for fast archive queries

## v2 Requirements

### Reports

- **RPT-V2-01**: CSV export includes full ticket detail (not just summary columns)
- **RPT-V2-02**: Scheduled email digest with weekly report summary

### Knowledge Base

- **KB-V2-01**: KB article versioning / edit history
- **KB-V2-02**: KB article tagging independent of ticket tags

### Archive

- **ARCH-V2-01**: Bulk export of archived tickets as CSV
- **ARCH-V2-02**: Auto-purge archived tickets older than N years (configurable)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-user / team features | Single-user system — no team collaboration needed |
| OAuth / SSO | Email + password sufficient |
| Mobile native app | PWA via browser is sufficient |
| Real-time updates / websockets | Single user, polling or manual refresh is fine |
| PDF download button | Print dialog is sufficient; avoids @react-pdf/renderer dependency |
| Resolved tickets in archive | User decision: resolved stays in main list; archive = closed only |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RPT-01 | Phase 1 | Complete |
| RPT-02 | Phase 1 | Pending |
| RPT-03 | Phase 1 | Pending |
| RPT-04 | Phase 1 | Pending |
| KB-01 | Phase 2 | Pending |
| KB-02 | Phase 2 | Pending |
| KB-03 | Phase 2 | Pending |
| KB-04 | Phase 2 | Pending |
| KB-05 | Phase 2 | Pending |
| ARCH-01 | Phase 3 | Pending |
| ARCH-02 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after initial definition*
