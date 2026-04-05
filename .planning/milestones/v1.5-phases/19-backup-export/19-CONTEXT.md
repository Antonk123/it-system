# Phase 19: Backup & Export - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can download a safe, complete backup of the system (SQLite database + uploaded files) as a ZIP from the Settings page. No restore UI, no scheduled backups, no cloud storage — just a manual download button.

</domain>

<decisions>
## Implementation Decisions

### Backup Trigger UX
- **D-01:** Dedicated "Backup & Export" section in Settings page — not buried at the bottom, its own visual section
- **D-02:** ZIP file named `it-ticket-backup-{YYYY-MM-DD}.zip` with date stamp
- **D-03:** Button shows spinner during generation, success toast with file size when download starts

### Backup Contents
- **D-04:** ZIP contains only the SQLite database snapshot and all files from `data/uploads/` — no config, no manifest, no extras
- **D-05:** ZIP internal structure: Claude's discretion (flat mirror of `data/` structure recommended)

### Safety & Performance
- **D-06:** Small single-user system — no streaming, chunking, or size safeguards needed. Simple in-memory ZIP generation is fine.
- **D-07:** Backup endpoint requires JWT authentication (existing `authenticateToken` middleware)

### Claude's Discretion
- ZIP internal folder structure (D-05) — pick whatever mirrors the data directory cleanly

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Database & Storage
- `server/src/db/connection.ts` — DB_PATH definition, SQLite connection setup (WAL mode)
- `server/src/routes/attachments.ts` — UPLOAD_DIR definition (`data/uploads/`), file storage patterns

### Frontend
- `src/pages/Settings.tsx` — Existing Settings page where backup section will be added

### Requirements
- `.planning/REQUIREMENTS.md` §Backup & Export — BKUP-01, BKUP-02 acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/src/db/connection.ts` — Exports DB instance; `DB_PATH` points to `data/database.sqlite`
- `server/src/routes/attachments.ts` — `UPLOAD_DIR` resolves to `data/uploads/`; multer setup shows file handling patterns
- `server/src/middleware/auth.ts` — `authenticateToken` middleware for protecting the endpoint
- `src/pages/Settings.tsx` — Existing Settings page to add backup section to

### Established Patterns
- Express routes in `server/src/routes/` follow domain-based grouping
- Frontend uses React Query hooks for data fetching
- Toast notifications via shadcn/ui toast system
- better-sqlite3 synchronous API (`.backup()` method available for WAL-safe snapshots)

### Integration Points
- New route: `GET /api/backup` (or similar) — mounted in `server/src/index.ts`
- Settings page: new section component added to `src/pages/Settings.tsx`
- Download trigger: `api.get('/backup', { responseType: 'blob' })` pattern

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Key constraint: SQLite backup must use WAL-consistent snapshot (BKUP-02), not raw file copy — `better-sqlite3`'s `.backup()` API is the natural fit.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-backup-export*
*Context gathered: 2026-04-05*
