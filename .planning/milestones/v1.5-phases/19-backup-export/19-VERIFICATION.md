---
phase: 19-backup-export
verified: 2026-04-05T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
re_verification: false
human_verification:
  - test: "Click the 'Ladda ned backup' button in Settings and verify a ZIP file downloads"
    expected: "Browser downloads 'it-ticket-backup-YYYY-MM-DD.zip'; a success toast appears with filename and file size in MB"
    why_human: "File download behavior and toast rendering require a live browser session"
  - test: "Open the downloaded ZIP and inspect its contents"
    expected: "ZIP contains 'data/database.sqlite' (a valid SQLite file) and a 'data/uploads/' directory with any existing uploaded files"
    why_human: "Cannot verify ZIP contents without actually running the endpoint against a live database"
  - test: "Verify the backup endpoint rejects unauthenticated requests"
    expected: "GET /api/backup without a valid JWT returns 401"
    why_human: "Requires a live server to test middleware behavior"
---

# Phase 19: Backup & Export Verification Report

**Phase Goal:** Users can download a safe, complete backup of the system from the Settings page
**Verified:** 2026-04-05
**Status:** human_needed (all automated checks pass; human browser test needed to confirm download and ZIP contents)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can click a backup button in Settings and receive a ZIP file download | VERIFIED | `handleBackup` in Settings.tsx fetches `/api/backup`, converts response to blob, triggers `<a>.click()` download |
| 2 | The downloaded ZIP contains a WAL-consistent SQLite snapshot (not raw file copy) | VERIFIED | `backup.ts` line 23: `await db.backup(tmpFile)` — better-sqlite3's `.backup()` API checkpoints WAL before copying |
| 3 | The downloaded ZIP contains all files from data/uploads/ | VERIFIED | `backup.ts` line 40: `archive.directory(UPLOAD_DIR, 'data/uploads')` behind an `existsSync` guard |
| 4 | The ZIP filename follows the pattern it-ticket-backup-YYYY-MM-DD.zip | VERIFIED | Backend sets `Content-Disposition` header with `it-ticket-backup-${dateStr}.zip`; frontend also constructs identical filename for `<a>.download` |
| 5 | A success toast appears with filename and file size after download starts | VERIFIED | `toast.success(\`Backup skapad — ${filename} (${sizeMB} MB)\`)` fires after `URL.revokeObjectURL` |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/routes/backup.ts` | GET /api/backup endpoint returning ZIP stream | VERIFIED | 66 lines; WAL backup, archiver ZIP, auth middleware, cleanup — fully substantive |
| `src/pages/Settings.tsx` | Backup & Export collapsible section with download button | VERIFIED | Section at line 1116–1150; Collapsible+Card pattern matches existing sections |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/pages/Settings.tsx` | `/api/backup` | `fetch(\`${baseUrl}/backup\`)` with Bearer token | WIRED | Line 253; response consumed as blob (line 257); download triggered |
| `server/src/routes/backup.ts` | `db.backup()` | better-sqlite3 async backup API | WIRED | Line 23; `await db.backup(tmpFile)` |
| `server/src/index.ts` | `server/src/routes/backup.ts` | `import backupRoutes` + `app.use('/api/backup', backupRoutes)` | WIRED | Line 33 (import) and line 190 (mount) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `backup.ts` | `tmpFile` (SQLite snapshot) | `db.backup(tmpFile)` — live database | Yes — WAL-checkpointed database file | FLOWING |
| `backup.ts` | archive stream | `archive.file()` + `archive.directory()` + `archive.finalize()` | Yes — reads real files from disk | FLOWING |
| `Settings.tsx` | `blob` | `response.blob()` from `/api/backup` response | Yes — binary data from server | FLOWING |
| `Settings.tsx` | `sizeMB` | `blob.size / (1024 * 1024)` | Yes — computed from actual blob | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| backup.ts has default export (Router) | `grep "export default router" server/src/routes/backup.ts` | Found at line 65 | PASS |
| index.ts mounts backup route | `grep "app.use.*api/backup.*backupRoutes" server/src/index.ts` | Found at line 190 | PASS |
| archiver in package-lock.json (will install on Docker) | `grep -c archiver server/package-lock.json` | 17 matches | PASS |
| Frontend TypeScript compiles without errors | `tsc --noEmit` (frontend) | No output (clean) | PASS |
| Server TypeScript compiles without errors | `tsc --noEmit` (server) | 2 errors in backup.ts (see anti-patterns) | FAIL — local only |
| Git commits exist | `git log --oneline` | `ac0297e` (backend) and `44804fa` (frontend) | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BKUP-01 | 19-01-PLAN.md | User can download a zip containing the SQLite database and uploaded files | SATISFIED | `archive.file(tmpFile, { name: 'data/database.sqlite' })` + `archive.directory(UPLOAD_DIR, 'data/uploads')` in backup.ts |
| BKUP-02 | 19-01-PLAN.md | Backup uses safe SQLite snapshot (not raw file copy) | SATISFIED | `await db.backup(tmpFile)` uses better-sqlite3's WAL-checkpointing backup API — not a raw file copy |

**Orphaned requirements check:** REQUIREMENTS.md maps only BKUP-01 and BKUP-02 to Phase 19. Both are claimed by 19-01-PLAN.md. No orphans.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `server/src/routes/backup.ts` | 49 | `archive.on('error', (err) => {` — `err` has implicit `any` type under strict TS | Warning | `tsc --noEmit` fails locally until `npm install` resolves `@types/archiver`; **no runtime impact** — tsx skips type checking in Docker |
| `server/src/routes/backup.ts` | 4 | `import archiver from 'archiver'` — module not found locally | Warning | `archiver` and `@types/archiver` are in `package.json` and `package-lock.json` but NOT installed in local `node_modules/`. Docker build runs `npm install` so this is NOT a deployment blocker; local dev requires `cd server && npm install` |

**Note:** The SUMMARY.md claim "TypeScript compile: no errors in backup.ts" is incorrect as of local verification. The errors are a consequence of `npm install` not being run locally after adding the dependency, not a code defect.

---

### Human Verification Required

#### 1. End-to-End Download Test

**Test:** Log in to the app, navigate to Settings, expand the "Backup & Export" section, click "Ladda ned backup".
**Expected:** Browser downloads a file named `it-ticket-backup-YYYY-MM-DD.zip` and a success toast appears showing the filename and size in MB.
**Why human:** Browser file download and toast rendering cannot be verified without a live session.

#### 2. ZIP Content Integrity Check

**Test:** Open the downloaded ZIP file and inspect its contents.
**Expected:** ZIP contains `data/database.sqlite` (a valid, openable SQLite file) and `data/uploads/` directory containing any previously uploaded attachments.
**Why human:** Requires running the endpoint against a live database to verify actual ZIP contents.

#### 3. Authentication Gate

**Test:** Send `GET /api/backup` (or open the URL in a browser tab while logged out).
**Expected:** Server returns 401 Unauthorized; no ZIP download occurs.
**Why human:** Requires a live server to test middleware behavior end-to-end.

---

### Gaps Summary

No gaps blocking goal achievement. All five observable truths are verified in the codebase. The only action item before declaring the phase fully complete is running `npm install` in the `server/` directory on the local dev machine (the Docker server will install correctly via its Dockerfile `RUN npm install` step). Human verification items above confirm the end-to-end download behavior, which cannot be verified programmatically.

---

_Verified: 2026-04-05_
_Verifier: Claude (gsd-verifier)_
