# 0002 — Hashed refresh tokens with reuse detection

Status: Accepted (2026-10-09)

## Context

Refresh tokens were stored in plaintext in `refresh_tokens.token`, accepted from the request
body as well as the cookie, and rotated without any record of which token replaced which. A
database read (backup file, SQL injection, a leaked dump) therefore yielded live sessions, and
a stolen token that had already been rotated could not be told apart from an unknown one.
Password changes did not invalidate access tokens already issued.

## Decision

- Store only `SHA-256(token)` in `refresh_tokens.token` (`hashRefreshToken`,
  `server/src/routes/auth.ts`). The raw value exists only in the HttpOnly cookie.
- Read the refresh token **from the cookie only** (`readRefreshToken`); the request body is
  ignored.
- Rotate on every refresh and record the successor in `refresh_tokens.replaced_by`
  (migration `089`). Presenting an already-rotated token revokes the **whole family** by
  following `replaced_by` (`revokeRefreshFamily`) and writes a `refresh_token_reuse` audit row.
  Exception: a rotated token shown again within `REFRESH_ROTATION_GRACE_MS` (10 s) while its
  successor is still unused is treated as two browser tabs racing and answered with a fresh
  access token but no new cookie.
- Access tokens carry the user's `token_version` (migration `088`); changing or resetting the
  password bumps it and makes outstanding access tokens invalid immediately
  (`server/src/config/passport.ts`).
- Migration `085` deletes all existing (plaintext) refresh tokens once.

## Consequences

- **Every user is logged out once at deploy** (the plaintext rows cannot match a hash).
- A database leak no longer yields usable refresh tokens; a replayed stolen token ends the
  thief's session *and* the victim's, which is the intended signal to log in again.
- The grace window is a deliberate small hole for multi-tab races; shorten it rather than
  removing it, or tabs will log each other out.
- Refresh and login throttling count only failures (`skipSuccessfulRequests`), plus a
  per-account lockout, so the rotation endpoint can be called every 15 minutes per tab without
  eating the budget.
- Tests: `server/src/routes/auth.test.ts`, `server/src/db/cleanup-refresh-tokens.test.ts`.
