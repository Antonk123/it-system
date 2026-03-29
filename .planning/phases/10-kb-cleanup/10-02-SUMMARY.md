---
phase: 10-kb-cleanup
plan: 02
subsystem: auth
tags: [jwt, refresh-tokens, fetch, axios, token-rotation, silent-refresh]

requires:
  - phase: existing-codebase
    provides: ApiClient with fetch-based request(), JWT login/refresh endpoint, refresh_tokens table

provides:
  - Silent 401-retry logic wired into ApiClient.request() using fetch (not Axios)
  - Rolling refresh tokens on /refresh endpoint (delete old, insert new with fresh 7-day expiry)
  - Dead Axios interceptor (tokenRefresh.ts) removed
  - Access token lifetime reduced to 15 minutes

affects: [auth, api-client, token-management]

tech-stack:
  added: []
  patterns:
    - "401-retry with isRetry guard in ApiClient.request() — prevents infinite retry loops"
    - "Rolling refresh token pattern — single-use tokens, fresh expiry on each use"
    - "Silent session expiry — redirect to /login with no toast on stale refresh token"

key-files:
  created: []
  modified:
    - src/lib/api.ts
    - src/main.tsx
    - server/src/routes/auth.ts
  deleted:
    - src/lib/tokenRefresh.ts

key-decisions:
  - "Deleted tokenRefresh.ts entirely — Axios interceptor never fired because api.ts uses fetch, not axios"
  - "401 check placed BEFORE response.json() consumption — response body can only be consumed once"
  - "Access token shortened to 15 minutes — acceptable since silent refresh now works transparently"
  - "Rolling refresh token: delete-and-reinsert pattern makes each refresh token single-use"

patterns-established:
  - "Silent auth: no toast on session expiry, just /login redirect"
  - "isRetry=true guard prevents infinite 401 refresh loops"

requirements-completed: [CLEAN-05]

duration: 10min
completed: 2026-03-29
---

# Phase 10 Plan 02: Silent Token Refresh & Rolling Refresh Tokens Summary

**Silent 401-retry wired into fetch-based ApiClient with rolling refresh tokens (delete-old + insert-new) and 15-minute access tokens**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-29T22:45:00Z
- **Completed:** 2026-03-29T22:52:47Z
- **Tasks:** 2
- **Files modified:** 3 (plus 1 deleted)

## Accomplishments

- 401 responses in ApiClient.request() now trigger a silent fetch-based refresh attempt and retry — user never sees login screen unless inactive 7+ days
- Refresh tokens are rolling: each /refresh call deletes the consumed token and issues a new one with fresh 7-day expiry
- Dead Axios interceptor (tokenRefresh.ts, 154 lines) deleted — it never fired since api.ts uses fetch, not axios
- Access token lifetime reduced from 1h to 15m — safe because silent refresh handles re-auth transparently

## Task Commits

1. **Task 1: Wire 401-retry into ApiClient.request(), remove dead Axios interceptor** - `7947382` (feat)
2. **Task 2: Make refresh tokens rolling on the backend** - `5fb0d7b` (feat)

## Files Created/Modified

- `src/lib/api.ts` - Added 401-handling block before response body consumption; refresh-and-retry on success, silent /login redirect on failure
- `src/main.tsx` - Removed setupTokenRefreshInterceptor() import and call
- `src/lib/tokenRefresh.ts` - DELETED (dead Axios interceptor)
- `server/src/routes/auth.ts` - ACCESS_TOKEN_EXPIRY '1h' → '15m'; /refresh handler: UPDATE last_used_at replaced with DELETE old + INSERT new rolling token; response now includes new refreshToken

## Decisions Made

- **Delete tokenRefresh.ts entirely**: The Axios interceptor it contained never executed because the app's API client uses fetch, not axios. Keeping it would be misleading dead code.
- **401 check before response.json()**: The response body can only be read once. The 401 block must appear before any `response.json()` call to avoid a "body already consumed" error on the error path.
- **Access token at 15 minutes**: With silent refresh working, there is no UX reason to keep 1h tokens. 15m limits exposure window if a token leaks.
- **Rolling token = delete-old + insert-new**: Single-use refresh tokens mean a stolen token can only be used once before it becomes invalid. The fresh insert resets the 7-day window.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Silent token refresh is fully operational; frontend and backend are in sync
- Any API activity within 7 days keeps the session alive indefinitely
- Ready for any remaining phase 10 plans or phase transition

---
*Phase: 10-kb-cleanup*
*Completed: 2026-03-29*
