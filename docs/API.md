# IT-Ticket — API Endpoint Reference

> **Verified against code on 2026-10-09** (branch `audit-fixes`, after the backend
> audit commit `33d4a9c`). Built from the Express routers in `server/src/routes/`
> and the route mounts in `server/src/app.ts`. **Update it whenever routes change**
> (new endpoint, changed auth chain, changed input/response shape). The
> machine-readable contract is `docs/openapi.yaml`; CI
> (`scripts/check-openapi-coverage.mjs`) fails if a mounted route is missing there.
> Accuracy over exhaustive prose — where a request input or response shape was not
> trivially inferable from the handler it is omitted rather than invented.

All paths are relative to the server origin (e.g. `https://helpdesk.example.com`).
All API routes are mounted under `/api`. Responses are JSON unless noted (file
downloads return binary with `Content-Disposition: attachment`).

---

## Auth model

Authentication is resolved per-request in `server/src/middleware/auth.ts` and
`server/src/config/passport.ts`.

| Mechanism | How | Notes |
|-----------|-----|-------|
| **JWT access token** | `Authorization: Bearer <jwt>` | 15-min lifetime, HS256, verified by passport-jwt. Subject = user id. |
| **Refresh token** | HttpOnly `refreshToken` cookie (cookie only — never read from the body) | Rolling/rotating, stored hashed (SHA-256). Reuse of an already-rotated token revokes the whole token family. Used only by `POST /api/auth/refresh` and `/logout`. See `docs/adr/0002-hashed-refresh-tokens-with-reuse-detection.md`. |
| **API key** | `Authorization: Bearer itk_live_<key>` | SHA-256 hashed, constant-time compared. Scopes: `read` (default), `write` and `admin`. A key without `write` is rejected with **403** on any `POST/PUT/PATCH/DELETE`. A key without `admin` is rejected with **403** on every admin-gated endpoint, *even when the key's owner is an admin* — the key is the credential and its scope can only narrow access, never widen it. Only a request that itself carries `admin` scope (or a logged-in admin session) may create a key with `admin`. API-key requests are tried **before** JWT. |
| **CSRF** | `x-csrf-token` header + `csrf-token` cookie (double-submit) | Required for all cookie-authenticated mutations (`POST/PUT/PATCH/DELETE`). **Exempt:** API-key requests (`Bearer itk_live_…`), `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, and everything under `/api/public/`. Fetch a token from `GET /api/csrf-token`. |

### Middleware vocabulary used in the tables

| Label | Meaning |
|-------|---------|
| `authenticate` | Requires a valid JWT **or** API key. Sets `req.user`. |
| `requireAdmin` | Requires `req.user.role === 'admin'` (run after `authenticate`). |
| `canAccessTicket(write)` (in-handler) | Per-ticket **write** check inside the handler: admin, assignee, creator, **or the ticket is unassigned** (`server/src/lib/ticketAccess.ts`). Not a route middleware. Reads never call it — see *Ticket access policy*. |
| `public/none` | No authentication required. |
| `loginRateLimiter` | 5 **failed** requests / 15 min / IP (successful logins are not counted), plus a per-account lockout after 10 failures / 15 min (`429` with `Retry-After`). |
| `refreshRateLimiter` | 60 failed requests / 15 min / IP (successful refreshes are not counted). |
| `forgotPasswordRateLimiter` | 5 requests / 15 min / IP. |
| `resetPasswordRateLimiter` | 10 failed requests / 15 min / IP. |
| `changePasswordRateLimiter` | 5 requests / 15 min / IP. |
| `oidcLoginRateLimiter` | 20 requests / 15 min / IP. |
| `oidcCallbackRateLimiter` | 20 requests / 15 min / IP (429 svaras som redirect till `/login?sso_error=failed` eftersom callbacken är en browser-navigation). |
| `writeRateLimiter` | 60 requests / min / IP. Separately, every mutating `/api` call is capped at 300 / 5 min per user or API key (app-level, `app.ts`). |
| `publicWriteRateLimiter` | 5 requests / min / IP. |
| `publicBrandingReadRateLimiter` | 120 requests / min / IP. |
| `kbPortalRateLimiter` | 120 requests / min / IP. |
| `sharePublicRateLimiter` | 30 requests / min / IP. |
| `backupDownloadLimiter` | 10 requests / 15 min / IP. |
| `restoreLimiter` | 5 requests / 15 min / IP. |
| `upload` (multer) | File upload; size/MIME limits noted per route. |

> **Note on rate limiters:** these are in-memory and per-instance (single-instance app).
> `optionalAuth` is referenced in the audit spec but does **not** exist in the current
> middleware — no route uses it.

### Unauthenticated (public) endpoints

These are the only endpoints reachable without credentials:

- `GET /api/health`, `GET /api/csrf-token`
- `GET /api/public/templates`, `GET /api/public/categories`, `GET /api/public/branding`, `GET /api/public/branding/logo` (rate-limited)
- `POST /api/public/tickets` (rate-limited; honeypot + minimum fill time)
- `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout` (logout needs no access token), `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- `GET /api/kb/public/:token`, `GET /api/kb/images/:filename`
- `GET /api/kb/portal/:token/categories`, `GET /api/kb/portal/:token/articles`, `GET /api/kb/portal/:token/articles/:articleId` (rate-limited, olistad portal)
- `GET /api/shares/public/:token`, `GET /api/shares/public/file/:token/:attachmentId` (rate-limited)
- `GET /api/auth/oidc/enabled`, `GET /api/auth/oidc/login` (rate-limited), `GET /api/auth/oidc/callback` (rate-limited) — the SSO handshake runs before any session exists, so it cannot require one

### Ticket access policy

One rule for tickets and all their sub-resources (comments, attachments,
checklists, links, shares, reminders, KB links): **every authenticated user may
read; writing requires admin, the ticket's assignee or creator, or the ticket
being unassigned** (self-service pickup). A failed write check returns `403`.
Ticket *deletion* and bulk delete are admin-only. Rationale and consequences:
`docs/adr/0001-unified-ticket-access-policy.md`. Admin means an effective admin:
an API key without `admin` scope never counts as admin.

---

## App-level (no router)

| Method | Path | Auth | Purpose | Response |
|--------|------|------|---------|----------|
| GET | `/api/health` | public/none | Liveness + DB reachability (`SELECT 1`) | `{ status, timestamp }`; 503 if DB unreachable |
| GET | `/api/csrf-token` | public/none | Issue a CSRF token for the SPA | `{ csrfToken }` |

---

## Auth — `/api/auth`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| POST | `/api/auth/login` | `loginRateLimiter` + per-account lockout + passport-local | Authenticate, issue access token + refresh cookie | body: `email`, `password` | `{ user: { id, email, role, mustChangePassword }, token, accessToken }` + HttpOnly `refreshToken` cookie; 401 invalid; 429 locked (`Retry-After`, `retryAfter`) |
| POST | `/api/auth/refresh` | `refreshRateLimiter` (no auth mw) | Rotate refresh token, issue new access token | `refreshToken` cookie (cookie only) | `{ accessToken, token }` + new cookie; 400 no cookie / 401 invalid, revoked, expired or reused |
| POST | `/api/auth/logout` | **public/none** (CSRF-exempt) | Revoke the cookie's refresh token, clear cookie. Works with an expired/absent access token | refresh token cookie | 204 |
| GET | `/api/auth/me` | `authenticate` | Current user | — | `{ user: { …, mustChangePassword } }` |
| POST | `/api/auth/change-password` | `authenticate` + `changePasswordRateLimiter` | Change own password (12-char policy); revokes every other session and all outstanding access tokens (`token_version`), keeps this one alive; clears `must_change_password` | body: `currentPassword`, `newPassword` | `{ message, accessToken, token }` + new refresh cookie; 400 (wrong current / policy)/404 |
| POST | `/api/auth/forgot-password` | `forgotPasswordRateLimiter` | Issue reset token + email link (enumeration-safe; mail is sent after the response) | body: `email` | generic `{ message }` (always 200) |
| POST | `/api/auth/reset-password` | `resetPasswordRateLimiter` | Reset password via token (12-char policy); revokes all refresh tokens | body: `token`, `newPassword` | `{ message }`; 400 invalid/expired |
| GET | `/api/auth/oidc/enabled` | public/none | Check if OIDC SSO is configured and get button label | — | `{ enabled, label, provider }` — `label` is `null` when SSO is off; `provider` is `"microsoft"` when the configured issuer's hostname is in Entra's host family, else `null` (always `null` when `enabled` is `false`) — derived from the issuer, never guessed from `label` |
| GET | `/api/auth/oidc/login` | public + `oidcLoginRateLimiter` | Start SSO: Authorization Code + PKCE (S256); state/nonce/verifier are stored in the short-lived HttpOnly `oidcTx` cookie (`SameSite=Lax`, path `/api/auth/oidc`, 10 min) | — | 302 redirect to the IdP; 503 if unconfigured, or if discovery fails or the issuer is rejected |
| GET | `/api/auth/oidc/callback` | public + `oidcCallbackRateLimiter` | Callback receiver — a browser navigation from the IdP, not an SPA call. Verifies `state`/`nonce`/PKCE plus the `id_token`'s `aud`, `exp`/`nbf` and `iss` (the JWS signature is **not** validated separately — see the token-validation note below), then signs in an **existing** account only | query: `code`, `state`; `oidcTx` cookie (required — no cookie means no in-flight transaction) | 302 to `/login?sso=1` plus a HttpOnly `refreshToken` cookie (the SPA then calls `POST /api/auth/refresh` for its access token), or to `/login?sso_error=unknown_user\|failed`; 503 if unconfigured |
| GET | `/api/auth/audit-log` | `authenticate` → `requireAdmin` | Paginated audit-log viewer (entries include `user_email`, `user_display_name`, `api_key_name`) | query: `limit`(≤200), `offset`, `entity_type`, `action` | `{ entries, total, limit, offset }` |

> **Password policy** (`server/src/lib/passwordPolicy.ts`): at least **12** characters,
> at most 72 bytes UTF-8, and at least 3 of 4 character classes (lower, upper, digit,
> other) *or* at least 16 characters. Applies to change-password, reset-password and
> admin-set passwords. Passwords are hashed with bcrypt cost 12 and re-hashed on login
> when the stored cost is lower. Accounts created by an admin carry
> `must_change_password = 1` until the owner changes it (`mustChangePassword` in the
> login and `/me` responses).

> **SSO token validation (`server/src/routes/auth.ts`).** The callback verifies
> `state`, `nonce` and PKCE against the `oidcTx` cookie, and the `id_token`'s
> `aud`, `exp`/`nbf` and `iss`. It does **not** separately validate the JWS
> signature against the IdP's JWKS — that would require
> `enableNonRepudiationChecks()` on the discovery config, which this code never
> calls. The trust comes from elsewhere: the token is fetched straight from the
> IdP's token endpoint over TLS using confidential-client authentication, which
> OIDC Core 3.1.3.7 item 6 accepts in place of signature validation for exactly
> this flow. `iss` (and, on Entra, `tid`) is then re-checked by our own code —
> see below.

> **SSO account rules (`server/src/lib/oidc.ts`).** OIDC authenticates, it never
> provisions. Before any account lookup the callback runs its **own** `iss` check
> against the issuer that discovery returned and — on Entra — compares the `tid`
> to the tenant named in that issuer, so exactly one tenant can ever authenticate.
> (The library's built-in `iss` check is not trusted on Entra: it derives the
> expected issuer from the token's own `tid` claim. See `.env.example`.)
>
> An identity is matched on the (`oidc_sub`, `oidc_iss`) pair — never on `sub`
> alone, which is unique only within an issuer. If that finds nothing, **exactly
> one** address is derived from the claims, and which claim is even eligible
> depends on whether the discovered issuer is Entra (has a tenant ID) or a
> generic OIDC provider:
>
> **On an Entra issuer**, in order of trust, compared case-insensitively
> against `users.email`:
>
> 1. `preferred_username`, if it is a string containing `@`. For a tenant
>    member this is normally the UPN, whose suffix Entra requires to be a
>    verified domain in the tenant — but "normally" is not "guaranteed":
>    Microsoft documents `preferred_username` as a mutable, unstable claim not
>    intended to be used as a key. Trusting it at all rests on Entra's
>    structural UPN guarantee, which is why this branch only runs for Entra
>    issuers in the first place.
> 2. otherwise `email`, and **only** when positively verified, i.e.
>    `xms_edov: true` or `email_verified: true`. An unverified `email` claim may
>    come from `otherMails`, which a tenant member can set themselves via
>    self-service registration — that is the nOAuth class of attack: a member
>    points their alternate address at an admin's address and links themselves to
>    the admin account. `xms_edov` is Microsoft's own countermeasure.
> 3. otherwise the attempt is refused for want of a usable address (`no_email`).
>
> **On a generic (non-Entra) OIDC issuer**, only `email` is ever tried, and
> only with `email_verified: true` — `preferred_username` is never consulted,
> because the rationale for trusting it (Entra's UPN-domain guarantee) does not
> hold for an arbitrary IdP; a generic IdP is held to the one verification
> proof OIDC itself defines. No match → refused (`no_email`).
>
> **There is no fallback in either case.** If the chosen address matches no
> account, the answer is `unknown_user` — no other claim is tried as a second
> chance, because that would reopen the hole (the attacker's preferred claim
> matches nothing, but their spoofed one does). The identity is linked to the
> account on the first successful match.
>
> Also refused, fail-closed: a `sub` that is not a non-empty string, an account
> already linked to a different identity, and an address that matches more than
> one account row. Guest accounts are refused when the token carries a `#EXT#`
> marker in `upn`, `preferred_username` or `email`, or `acct: 1` (1 = guest,
> 0 = tenant member) — but both `upn` and `acct` are **optional** claims that
> Entra only emits if the app registration asks for them, and a guest's
> `preferred_username` often carries their home-tenant address with no `#EXT#` at
> all. Treat the guest check as defence in depth, not as the guest barrier: the
> real barriers are that the account must already exist in IT-Ticket and that the
> enterprise application is configured with **Assignment required** in Entra
> (Enterprise applications → the app → Properties → *Assignment required?* →
> Yes, then assign only the intended users/groups) — see `.env.example`.
>
> Roles always come from the database row, never from a claim. Every refusal
> that reaches the claims-comparison step (`verifyOidcClaims`, i.e.
> `issuer_mismatch`/`tenant_mismatch`) or the account lookup is audit-logged as
> `login_failure`. One rejection is **not**: discovering an untrustworthy
> issuer itself (`getOidcIssuerIdentity` throwing on a placeholder issuer or on
> Microsoft's consumer tenant) happens *before* that comparison, is caught by
> the callback's outer error handler, and only reaches the application log —
> no audit entry is written for it. Protocol-level aborts (no/garbled `oidcTx`
> cookie, a token without `sub`) are also redirect-only, no audit entry. Only
> "no such account" surfaces as `/login?sso_error=unknown_user`; every other
> one of the eight reject reasons — including both audited and unaudited ones
> above — surfaces as the generic `/login?sso_error=failed`, so a probe cannot
> tell the cases apart.

---

## Users — `/api/users`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/users` | `authenticate` | List users (reduced for non-admins, full for admins — the admin shape adds `ssoLinked`, a boolean saying only *whether* the account is SSO-linked; `oidc_sub`/`oidc_iss` are never exposed) | — | `{ users }` |
| POST | `/api/users` | `authenticate` → `requireAdmin` | Create user (auto-gen password if omitted). The account always gets `must_change_password = 1`; an explicit password must satisfy the 12-char policy | body: `email`, `password?`, `role?`, `displayName?` | 201 `{ message, user, temporaryPassword? }`; 400/409 |
| PATCH | `/api/users/:id` | `authenticate` → `requireAdmin` | Update `role` / `displayName`, and/or unlink SSO. `clearSsoLink: true` nulls **both** `oidc_sub` and `oidc_iss` and revokes every refresh token the user holds, in one transaction — the point of unlinking is that the wrong person may be signed in, and that session's refresh token would otherwise keep rotating for up to 7 days. A refresh token revoked this way stops a *new* access token from being issued; it does not revoke an access token already handed out, which stays valid for up to 15 minutes after unlinking. `clearSsoLink: false` is a no-op | params: `id`; body: `role?`, `displayName?`, `clearSsoLink?` (boolean) | `{ message }`; 400 (incl. self-demote, non-boolean `clearSsoLink`, no updatable field supplied)/404 |
| DELETE | `/api/users/:id` | `authenticate` → `requireAdmin` | Delete user (blocks self-deletion). Tickets/comments the user owned are reassigned to the system user | params: `id` | `{ message }`; 400/404 |

---

## Tickets — `/api/tickets`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/tickets` | `authenticate` | List tickets (legacy flat array, or paginated, or count-only) | query: `page`, `limit`, `countOnly`, `sortBy`, `sortDir`, + filters (`status`, `priority`, `category`, `search`, `year`, `month`…) | `TicketRow[]` or `{ count }` or `{ data, pagination }` |
| POST | `/api/tickets/import/preview` | `authenticate` → `requireAdmin` → `upload.single('file')` (CSV, 10 MB) | Validate uploaded CSV rows | multipart `file` | `{ total, valid, invalid, duplicates, results[] }`; 400 |
| POST | `/api/tickets/import/confirm` | `authenticate` → `requireAdmin` | Bulk-insert tickets (all-or-nothing txn) | body: `tickets[]` | `{ success, created, failed, errors[] }`; 400 |
| GET | `/api/tickets/export` | `authenticate` | Export filtered tickets to XLSX | query: filters, `limit`(≤50000), `offset` | XLSX binary |
| GET | `/api/tickets/export-archive` | `authenticate` | Export closed/selected tickets (lightweight XLSX) | query: `ids` (csv) or filters | XLSX binary; 400 if empty `ids` |
| GET | `/api/tickets/dashboard-overview` | `authenticate` | Aging tickets + today counts + critical count | — | `{ agingTickets, todayCounts, criticalCount }` |
| GET | `/api/tickets/activity-feed` | `authenticate` | Recent ticket-history events | query: `limit`(≤50) | history-event array |
| GET | `/api/tickets/status-counts` | `authenticate` | Ticket counts per status | — | `{ open, in-progress, waiting, resolved, closed }` |
| GET | `/api/tickets/requester-open-counts` | `authenticate` | Non-closed ticket count per requester | — | `Record<requesterId, count>` |
| GET | `/api/tickets/upcoming-reminders` | `authenticate` | Unsent future reminders across all tickets (top 6) | — | reminder array |
| GET | `/api/tickets/:id` | `authenticate` | Get one ticket + custom fields | params: `id` | `{ ...ticket, field_values[] }`; 404 |
| POST | `/api/tickets` | `writeRateLimiter` → `authenticate` | Create ticket (+ custom fields, auto-priority, email, webhook) | body: `title`(req), `description`/`customFields`(one req), + optional fields | 201 `{ ...ticket, warnings? }`; 400 |
| GET | `/api/tickets/:id/history` | `authenticate` | Ticket change history (cap 500) | params: `id` | history-row array; 404 |
| PUT | `/api/tickets/bulk` | `writeRateLimiter` → `authenticate` (+ per-ticket write check) | Bulk-update status/priority/category/assignee (≤500, chunked, history rows per change); tickets the caller may not write land in `skipped` | body: `ids[]`, `updates{}` | `{ updated, skipped[] }`; 400 |
| POST | `/api/tickets/bulk-delete` | `writeRateLimiter` → `authenticate` → `requireAdmin` | Permanently delete many tickets + attachment files | body: `ids[]` | `{ deleted, alreadyGone? }`; 400 |
| PUT | `/api/tickets/:id` | `writeRateLimiter` → `authenticate` (+ `canAccessTicket(write)`) | Update ticket fields/custom fields; logs history, email, webhooks. `ticket.updated` fires only on a status change, with a trimmed payload (see Webhooks) | params: `id`; body: optional ticket fields + `customFields` | `{ ...ticket, warnings? }`; 400/403/404 |
| DELETE | `/api/tickets/:id` | `writeRateLimiter` → `authenticate` → `requireAdmin` | Permanently delete one ticket + attachment files | params: `id` | `{ message }`; 404 |
| POST | `/api/tickets/:id/reminders` | `authenticate` (+ `canAccessTicket(write)`) | Create a personal reminder (delivered to its creator by e-mail if SMTP is set and by push to that user's devices; send failures are retried up to 5 times) | params: `id`; body: `reminder_time`(future, req), `message`(≤500) | 201 reminder; 400/403/404 |
| GET | `/api/tickets/:id/reminders` | `authenticate` | List reminders for a ticket (all authenticated users) | params: `id` | reminder array; 404 |
| DELETE | `/api/tickets/:id/reminders/sent` | `authenticate` (+ `canAccessTicket(write)`) | Clear caller's own sent reminders | params: `id` | `{ deleted }`; 403/404 |
| DELETE | `/api/tickets/:id/reminders/:reminderId` | `authenticate` (+ owner-or-admin) | Cancel a specific reminder | params: `id`, `reminderId` | `{ message }`; 403/404 |

> **Design note:** all ticket *reads* (list, `GET /:id`, history, reminders and every
> sub-resource list) use `authenticate` only. Writes follow the unified ticket access
> policy above. `GET /api/tickets` returns a bare array (max 1000) without `page`/`limit`,
> `{ data, pagination }` with them, and `{ count }` with `countOnly=true`; allowed `limit`
> values are 10, 20, 25, 30, 50, 100 and 1000 (anything else falls back to 10).

---

## Comments — `/api/comments`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/comments/ticket/:ticketId` | `authenticate` | Non-deleted comments for a ticket, internal ones included (cap 500) | params: `ticketId` | `CommentRow[]`; 404 |
| POST | `/api/comments/ticket/:ticketId` | `authenticate` (+ `canAccessTicket(write)`) | Create comment (HTML sanitized; bumps ticket). `isInternal:false` emails the requester | params: `ticketId`; body: `content`(req, ≤20000), `isInternal`(default true) | 201 `CommentRow`; 400/401/403/404 |
| PUT | `/api/comments/:id` | `authenticate` (+ owner-or-admin) | Update comment content | params: `id`; body: `content` | `CommentRow`; 403/404 |
| DELETE | `/api/comments/:id` | `authenticate` (+ owner-or-admin) | Soft-delete comment | params: `id` | `{ message }`; 403/404 |

---

## Checklists — `/api/checklists`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| POST | `/api/checklists/progress` | `authenticate` | Batch progress (total/completed) for many tickets (read) | body: `ticketIds[]` | `Record<ticketId,{total,completed}>` |
| GET | `/api/checklists/ticket/:ticketId` | `authenticate` | Checklist items for a ticket | params: `ticketId` | item array |
| POST | `/api/checklists/ticket/:ticketId` | `authenticate` (+ `canAccessTicket(write)`) | Add one item | params: `ticketId`; body: `label`(req), `parent_id?`, `due_date?` | 201 item; 400/403/404 |
| POST | `/api/checklists/ticket/:ticketId/bulk` | `authenticate` (+ `canAccessTicket(write)`) | Bulk add items (`labels[]` or `items[]`) | params: `ticketId`; body: `labels[]`/`items[]` | 201 item array; 400/403/404 |
| PUT | `/api/checklists/:id` | `authenticate` (+ `canAccessTicket(write)` via item) | Update item | params: `id`; body: `label`/`completed`/`due_date`/`parent_id` | item; 403/404 |
| DELETE | `/api/checklists/:id` | `authenticate` (+ `canAccessTicket(write)` via item) | Hard-delete item | params: `id` | `{ message }`; 403/404 |

---

## Checklist templates — `/api/checklist-templates`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/checklist-templates` | `authenticate` | List templates with items | — | template array |
| POST | `/api/checklist-templates` | `authenticate` → `requireAdmin` | Create template + items (transactional) | body: `name`(req), `description?`, `items[]`(req) | 201 template; 400/409 |
| PUT | `/api/checklist-templates/:id` | `authenticate` → `requireAdmin` | Update template (replaces items if given) | params: `id`; body: `name?`, `description?`, `items?` | template; 404/409 |
| DELETE | `/api/checklist-templates/:id` | `authenticate` → `requireAdmin` | Delete template | params: `id` | `{ message }`; 404 |
| POST | `/api/checklist-templates/:id/apply` | `authenticate` (+ `canAccessTicket(write)`) | Apply template items to a ticket (txn) | params: `id`; body: `ticketId`(req) | 201 checklist rows; 400/403/404 |

---

## Links — `/api/links`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/links/ticket/:ticketId` | `authenticate` | All links for a ticket (bidirectional) | params: `ticketId` | `TicketLinkWithDetails[]` |
| POST | `/api/links/ticket/:ticketId` | `authenticate` (+ `canAccessTicket(write)` on source **and** target) | Create link between two tickets | params: `ticketId`; body: `targetTicketId`(req), `linkType`(default `related`) | 201 link; 400/401/403/404/409 |
| DELETE | `/api/links/:id` | `authenticate` (+ `canAccessTicket(write)` on either ticket) | Delete a link | params: `id` | `{ message }`; 401/403/404 |

> Valid `linkType` values: `related`, `blocks`, `blocked_by`, `duplicate`, `parent`, `child`.

---

## Shares — `/api/shares`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/shares/ticket/:ticketId` | `authenticate` | Get existing active share token + expiry | params: `ticketId` | `{ share_token: string\|null, expires_at: string\|null }` |
| POST | `/api/shares/ticket/:ticketId` | `authenticate` (+ `canAccessTicket(write)`) | Create share link (idempotent) with optional expiry. **Links always expire** — default 30 days, `expiresInDays` 1–365 | params: `ticketId`; body: `expiresInDays?` (int, 1–365, default 30) | `{ share_token, expires_at }` (200 existing / 201 new); 400 if invalid days/403/404 |
| DELETE | `/api/shares/ticket/:ticketId` | `authenticate` (+ `canAccessTicket(write)`) | Delete share link | params: `ticketId` | `{ message }`; 403/404 |
| GET | `/api/shares/public/:token` | `sharePublicRateLimiter` (public) | Public read of a shared ticket (strips internal `notes`); fails if expired | params: `token` | `{ ticket, requester, attachments[], checklistItems[], share_expires_at }`; 404 if invalid/expired |
| GET | `/api/shares/public/file/:token/:attachmentId` | `sharePublicRateLimiter` (public) | Serve an attachment for a shared ticket (fails if expired); forced download | params: `token`, `attachmentId` | file download; 404 if invalid/expired/file missing |

---

## Attachments — `/api/attachments`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/attachments/ticket/:ticketId` | `authenticate` | List attachment metadata (+ url) | params: `ticketId` | `AttachmentRow[]` |
| POST | `/api/attachments/ticket/:ticketId` | `authenticate` (+ multer `upload.single('file')` 10 MB + MIME/extension allowlist + magic-byte + `canAccessTicket(write)` + per-ticket cap 50) | Upload one file. **SVG is not accepted** (neither `image/svg+xml` nor `.svg`); the file is removed again if a later check fails | params: `ticketId`; multipart `file` | 201 attachment (+ url); 400/403/404 |
| GET | `/api/attachments/file/:id` | `authenticate` | Download a file (forced attachment, never inline; UTF-8 filenames) | params: `id` | file download; 404 |
| DELETE | `/api/attachments/:id` | `authenticate` (+ `canAccessTicket(write)` via attachment) | Delete attachment (row then file) | params: `id` | `{ message }`; 403/404 |

---

## Knowledge base — `/api/kb`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/kb/categories` | `authenticate` | List categories + published-article counts | — | category array |
| POST | `/api/kb/categories` | `authenticate` → `requireAdmin` | Create category | body: `name`(req), `color?` | 201 category; 400 |
| PUT | `/api/kb/categories/:id` | `authenticate` → `requireAdmin` | Update category | params: `id`; body: `name`, `color?` | category; 400/404 |
| DELETE | `/api/kb/categories/:id` | `authenticate` → `requireAdmin` | Delete category | params: `id` | `{ message }`; 404 |
| GET | `/api/kb/articles` | `authenticate` | List articles (FTS search/filters) + tags. Non-admins always see published only | query: `search?`, `category_id?`, `article_type?`, `tag?`, `stale?`, `status?` (`published`\|`draft`\|`all`, admin only), `fields=list` (replace `content` with a 300-char `preview`), `page?`, `limit?` (default 20, max 100) | article array; with `page`: `{ data, pagination: { page, limit, total } }` |
| GET | `/api/kb/articles/:id` | `authenticate` | Single article (admins see drafts) | params: `id` | `{ ...article, tags }`; 404 |
| GET | `/api/kb/articles/:id/tickets` | `authenticate` | Tickets linked to this article | params: `id` | ticket array |
| POST | `/api/kb/articles` | `authenticate` → `requireAdmin` | Create article (+FTS, tags; sanitizes HTML) | body: `title`(req), `category_id`(req), `content?`, `article_type?`, `tag_ids?`, `status?` | 201 article; 400 |
| PUT | `/api/kb/articles/:id` | `authenticate` → `requireAdmin` | Update article (+FTS resync, tags) | params: `id`; body: as create | article; 400/404 |
| PATCH | `/api/kb/articles/:id/review` | `authenticate` → `requireAdmin` | Mark article reviewed | params: `id` | `{ last_reviewed_at }`; 404 |
| DELETE | `/api/kb/articles/:id` | `authenticate` → `requireAdmin` | Delete article (+FTS, image cleanup) | params: `id` | `{ message }`; 404 |
| GET | `/api/kb/ticket/:ticketId` | `authenticate` | KB articles linked to a ticket (drafts only for admins) | params: `ticketId` | article array |
| POST | `/api/kb/ticket/:ticketId` | `authenticate` (+ `canAccessTicket(write)`; non-admins can link published articles only) | Link article to ticket | params: `ticketId`; body: `articleId` | 201 link; 400/403/404/409 |
| DELETE | `/api/kb/ticket/:ticketId/:articleId` | `authenticate` (+ `canAccessTicket(write)`) | Unlink article from ticket | params: `ticketId`, `articleId` | `{ message }`; 403/404 |
| GET | `/api/kb/articles/:id/links` | `authenticate` | Cross-reference list (published only) | params: `id` | linked-article array |
| POST | `/api/kb/articles/:id/links` | `authenticate` → `requireAdmin` | Create cross-link | params: `id`; body: `targetArticleId` | 201 link; 400/409 |
| DELETE | `/api/kb/articles/:id/links/:targetId` | `authenticate` → `requireAdmin` | Remove cross-link | params: `id`, `targetId` | `{ message }`; 404 |
| GET | `/api/kb/articles/:id/share` | `authenticate` → `requireAdmin` | Get the active (non-expired) share token | params: `id` | `{ share_token: string\|null }` |
| POST | `/api/kb/articles/:id/share` | `authenticate` → `requireAdmin` | Create share token for a published article (idempotent; an expired share is replaced) | params: `id`; body: `expiresInDays?` (int, 1–365; omit = no expiry) | `{ share_token }` (200 existing / 201 new); 400/404/409 for draft |
| DELETE | `/api/kb/articles/:id/share` | `authenticate` → `requireAdmin` | Revoke share token | params: `id` | `{ message }`; 404 |
| GET | `/api/kb/public/:token` | **public/none** | Public read-only shared published article | params: `token` | `{ ...article, tags }`; 404 |
| GET | `/api/kb/portal-share` | `authenticate` → `requireAdmin` | Get the single global KB portal token | — | `{ share_token: string\|null }` |
| POST | `/api/kb/portal-share` | `authenticate` → `requireAdmin` | Create/get the global KB portal token (idempotent, 128-bit) | — | `{ share_token }` (200 existing / 201 new) |
| DELETE | `/api/kb/portal-share` | `authenticate` → `requireAdmin` | Revoke the global portal token (idempotent) | — | 204 |
| GET | `/api/kb/portal/:token/categories` | **public/none** (`kbPortalRateLimiter`) | List non-empty categories with published-article counts | params: `token` | public category array; 404/429 |
| GET | `/api/kb/portal/:token/articles` | **public/none** (`kbPortalRateLimiter`) | List/search published article summaries only | params: `token`; query: `search?`, `category_id?` | public summary array; 404/429 |
| GET | `/api/kb/portal/:token/articles/:articleId` | **public/none** (`kbPortalRateLimiter`) | Read one published article through the portal | params: `token`, `articleId` | public article + tags; 404/429 |
| POST | `/api/kb/upload-image` | `authenticate` → `requireAdmin` (+ multer `uploadImage.single('image')` 10 MB, JPEG/PNG/GIF/WebP only, magic-byte) | Upload KB image | multipart `image` | 201 `{ url }`; 400 |
| GET | `/api/kb/images/:filename` | **public/none** | Serve KB image (kb- prefix, traversal-guarded) | params: `filename` | image file; 400/404 |

---

## Categories — `/api/categories`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/categories` | `authenticate` | List categories | — | `CategoryRow[]` |
| POST | `/api/categories` | `authenticate` → `requireAdmin` | Create category (derives slug from label) | body: `label` | 201 category; 400 |
| PUT | `/api/categories/reorder` | `authenticate` → `requireAdmin` | Reorder by id array | body: `ids[]` | category array; 400 |
| PUT | `/api/categories/:id` | `authenticate` → `requireAdmin` | Update label | params: `id`; body: `label` | category; 400/404 |
| DELETE | `/api/categories/:id` | `authenticate` → `requireAdmin` | Delete category | params: `id` | `{ message }`; 404 |

---

## Knowledge-base tags — `/api/tags`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/tags` | `authenticate` | List tags | — | `TagRow[]` |
| POST | `/api/tags` | `authenticate` → `requireAdmin` | Create tag (default color `#3b82f6`) | body: `name`, `color?` | 201 tag; 400 (incl. duplicate) |
| PUT | `/api/tags/:id` | `authenticate` → `requireAdmin` | Update name/color | params: `id`; body: `name`, `color?` | tag; 400/404 |
| DELETE | `/api/tags/:id` | `authenticate` → `requireAdmin` | Delete tag without historical ticket/template references | params: `id` | `{ message }`; 404/409 |

---

## Templates — `/api/templates`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/templates` | `authenticate` | List templates with fields | — | template array |
| GET | `/api/templates/:id` | `authenticate` | Single template with fields | params: `id` | `{ ...template, fields }`; 404 |
| POST | `/api/templates` | `authenticate` → `requireAdmin` | Create template (standard/dynamic; inline fields) | body: `name`, `title_template`, `template_type?`, `description_template?`, `priority?`, `category_id?`, `notes_template?`, `solution_template?`, `fields?[]` | 201 template; 400 |
| PUT | `/api/templates/reorder` | `authenticate` → `requireAdmin` | Reorder by id array | body: `ids[]` | template array; 400 |
| PUT | `/api/templates/:id` | `authenticate` → `requireAdmin` | Update template (partial) | params: `id`; body: partial of create | template; 404 |
| DELETE | `/api/templates/:id` | `authenticate` → `requireAdmin` | Delete template | params: `id` | `{ message }`; 404 |

### Template fields — `/api/templates/:templateId/fields`

Mounted as a sub-router on the templates router (`mergeParams`).

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/templates/:templateId/fields` | `authenticate` | List fields for a template | params: `templateId` | field array |
| POST | `/api/templates/:templateId/fields` | `authenticate` → `requireAdmin` | Create field | params: `templateId`; body: `field_name`(req), `field_label`(req), `field_type`(req), `placeholder?`, `default_value?`, `required?`, `options?` | 201 field; 400 |
| PUT | `/api/templates/:templateId/fields/reorder` | `authenticate` → `requireAdmin` | Reorder fields by id array | body: `ids[]` | field array; 400 |
| PUT | `/api/templates/:templateId/fields/:fieldId` | `authenticate` → `requireAdmin` | Update field (partial) | params: `fieldId`; body: as create | field; 404 |
| DELETE | `/api/templates/:templateId/fields/:fieldId` | `authenticate` → `requireAdmin` | Delete field | params: `fieldId` | `{ message }`; 404 |

---

## Companies — `/api/companies`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/companies` | `authenticate` | List companies + contact/ticket-count stats | — | company-with-stats array |
| GET | `/api/companies/:id` | `authenticate` | Single company + contacts + aggregate stats | params: `id` | `{ ...company, contacts[], stats }`; 404 |
| POST | `/api/companies` | `authenticate` → `requireAdmin` | Create company | body: `name`(req), `org_number?`, `email?`, `phone?`, `address?` | 201 company; 400 |
| PUT | `/api/companies/:id` | `authenticate` → `requireAdmin` | Update company | params: `id`; body: optional company fields | company; 400/404 |
| DELETE | `/api/companies/:id` | `authenticate` → `requireAdmin` | Delete company (nulls contacts' `company_id`) | params: `id` | `{ message }`; 404 |

---

## Contacts — `/api/contacts`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/contacts` | `authenticate` | List contacts (+ company name). Without `page`: bare array, cap 500. With `page`: paginated | query: `search?` (name/e-mail/phone), `page?`, `limit?` (default 50, max 200) | `ContactRow[]` or `{ data, pagination: { page, limit, total } }` |
| GET | `/api/contacts/export` | `authenticate` | Export all contacts as XLSX | — | XLSX binary; 404 if none |
| POST | `/api/contacts/import/preview` | `authenticate` → `requireAdmin` (+ multer `upload.single('file')` CSV 5 MB) | Validate uploaded CSV (no write) | multipart `file` | `{ total, valid, invalid, duplicates, results[] }`; 400 |
| POST | `/api/contacts/import/confirm` | `authenticate` → `requireAdmin` | Validate every row first (all-or-nothing on validation errors, `rowErrors`), then insert; creates missing companies | body: `contacts[]` | `{ success, created, failed, errors[] }`; 400 |
| GET | `/api/contacts/:id` | `authenticate` | Single contact (+ company name) | params: `id` | `ContactRow`; 404 |
| POST | `/api/contacts` | `authenticate` → `requireAdmin` | Create contact (validated; e-mail unique case-insensitively) | body: `name`(req), `email`(req), `phone?`, `company_id?`, `department?` | 201 contact; 400/409 duplicate e-mail |
| PUT | `/api/contacts/:id` | `authenticate` → `requireAdmin` | Update contact (whitelisted fields) | params: `id`; body: optional contact fields | contact; 400/404/409 |
| DELETE | `/api/contacts/:id` | `authenticate` → `requireAdmin` | Delete contact | params: `id` | `{ message }`; 404 |

---

## Reports — `/api/reports`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/reports/summary` | `authenticate` | KPI summary (totals, byCategory, byPriority, trend, avg resolution, aging) | query: `year?`, `month?` | `{ totals, byCategory, byPriority, trend, avgResolutionDays, agingTickets }`; 400 |
| GET | `/api/reports/requester-analytics` | `authenticate` | Per-requester analytics (top 15) | query: `year?`, `month?` | requester-metrics array; 400 |
| GET | `/api/reports/status-flow` | `authenticate` | 12-month per-status series | — | status-flow array |
| GET | `/api/reports/kpi-tickets` | `authenticate` | KPI drill-down ticket rows (cap 200) | query: `scope`(`total`\|`aging`, req), `year?`, `month?` | ticket-row array; 400 |

---

## API keys — `/api/api-keys`

User-scoped (any authenticated user manages their own keys).

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/api-keys` | `authenticate` | List current user's keys (hash omitted) | — | key array |
| POST | `/api/api-keys` | `authenticate` | Create key (raw value returned once; max 20/user) | body: `name`, `permissions?[]`, `expires_at?` | 201 `{ id, name, key, key_prefix, permissions, expires_at, created_at }`; 400 |
| DELETE | `/api/api-keys/:id` | `authenticate` | Delete one of current user's keys | params: `id` | `{ message }`; 404 |

---

## Webhooks — `/api/webhooks`

All routes require `authenticate` → `requireAdmin`. HMAC is used only to **sign
outbound** deliveries; there is no inbound webhook-receiver endpoint here.

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/webhooks` | admin | List webhooks (secret omitted) | — | webhook array |
| POST | `/api/webhooks` | admin | Create webhook (SSRF-checks URL, generates secret; secret returned once) | body: `url`, `events[]` | 201 `{ id, url, events, secret, active, … }`; 400 (incl. `validEvents`) |
| PUT | `/api/webhooks/:id` | admin | Update webhook (partial; SSRF-checks new URL) | params: `id`; body: `url?`, `events?`, `active?` | webhook (no secret); 400/404 |
| DELETE | `/api/webhooks/:id` | admin | Delete webhook | params: `id` | `{ message }`; 404 |
| GET | `/api/webhooks/:id/deliveries` | admin | List last 50 delivery attempts | params: `id` | delivery array |

### Events

`ticket.created`, `ticket.updated`, `ticket.closed`, `ticket.deleted`,
`ticket.status_changed`, `comment.created`, `contact.created`, `contact.updated`.

Every delivery body is `{ "event": "<name>", "payload": { … }, "timestamp": "<ISO-8601>" }`.

| Event | Payload |
|-------|---------|
| `ticket.created` | `{ id, title, status, priority }` |
| `ticket.updated` | `{ id, status, priority, assigned_to, title, updated_fields[] }` — emitted **only when the status changes**; notes and solution text are deliberately never included |
| `ticket.status_changed` | `{ id, title, old_status, status }` |
| `ticket.closed` | `{ id }` |
| `ticket.deleted` | `{ id, title }` |
| `contact.created` / `contact.updated` | `{ id, name, email, company_id }` |
| `comment.created` | `{ ticket_id, ticket_title, is_internal: false, content_snippet, source? }` — only for public (non-internal) replies; `source: "email"` for e-mail replies |

### Delivery and signature verification

> **Breaking change.** The previous scheme signed only the request body
> (`HMAC-SHA256(secret, body)`). That signature is no longer sent or accepted by the
> verification rules below; receivers must be updated together with this release.

Each delivery is an HTTP `POST` with `Content-Type: application/json` and these headers:

| Header | Value |
|--------|-------|
| `X-Webhook-Id` | Delivery UUID. **Stable across retries** of the same delivery — use it to deduplicate. |
| `X-Webhook-Timestamp` | Unix seconds, set **per attempt** (a retry carries a fresh timestamp). |
| `X-Webhook-Event` | Event name, e.g. `ticket.created`. |
| `X-Webhook-Signature` | `hex(HMAC-SHA256(secret, timestamp + "." + id + "." + rawBody))` where `timestamp` and `id` are the two header values above. |

Receiver checklist:

1. Compute the HMAC over the **raw request bytes** (before any JSON parsing or re-serialisation).
2. Compare with `X-Webhook-Signature` in **constant time** (`crypto.timingSafeEqual`).
3. Reject if `X-Webhook-Timestamp` is older than about 5 minutes (replay protection).
4. Deduplicate on `X-Webhook-Id`.
5. Answer `2xx` quickly (the sender times out after 10 s).

```js
const expected = crypto.createHmac('sha256', secret)
  .update(`${timestamp}.${id}.`).update(rawBody).digest('hex');
const ok = expected.length === signature.length &&
  crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
```

Delivery behaviour (`server/src/lib/webhookDispatcher.ts`): redirects are **not
followed** — a `3xx` response is a final failure with no retry. Other non-2xx
responses and network errors retry up to 5 attempts in total with back-off of
1 min, 5 min, 30 min and 2 h between attempts. The target URL is re-validated against SSRF rules
(private/loopback/link-local ranges) immediately before every attempt; a
failed re-validation is final.

--------|------|------|---------|--------|----------|
| GET | `/api/webhooks` | admin | List webhooks (secret omitted) | — | webhook array |
| POST | `/api/webhooks` | admin | Create webhook (SSRF-checks URL, generates secret) | body: `url`, `events[]` | 201 `{ id, url, events, secret, active, … }`; 400 |
| PUT | `/api/webhooks/:id` | admin | Update webhook (partial; SSRF-checks new URL) | params: `id`; body: `url?`, `events?`, `active?` | webhook (no secret); 400/404 |
| DELETE | `/api/webhooks/:id` | admin | Delete webhook | params: `id` | `{ message }`; 404 |
| GET | `/api/webhooks/:id/deliveries` | admin | List last 50 delivery attempts | params: `id` | delivery array |

---

## Backup — `/api/backup`

All routes require `authenticate` → `requireAdmin`.

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/backup` | admin + `backupDownloadLimiter` | Stream a fresh ZIP backup (DB + uploads); audit-logged before streaming | — | ZIP stream |
| GET | `/api/backup/files` | admin | List stored backup ZIPs (`backup-YYYY-MM-DD[-HHMM].zip`) in the server's backup directory, newest first | — | `[{ name, sizeBytes, modifiedAt }]` |
| GET | `/api/backup/files/:name` | admin + `backupDownloadLimiter` | Download one stored backup (name validated against the pattern, resolved inside the backup dir; audit-logged) | params: `name` | ZIP stream; 400 bad name / 404 |
| POST | `/api/backup/restore` | admin + `restoreLimiter` + multer `upload.single('file')` (ZIP, 500 MB) | Restore from uploaded ZIP (entry-count and extracted-size caps, zip-slip/magic/table validation, `PRAGMA quick_check`, pre-restore copies, then `process.exit` so the container restarts) | multipart `file` | `{ success, message, restartRequired }`; 400/413 |
| GET | `/api/backup/config` | admin | Get backup schedule config + nextRunAt | — | `{ …cfg, nextRunAt, consecutiveFailures, lastError, offsiteFailureCount }` |
| PUT | `/api/backup/config` | admin | Update schedule (enabled/time/retentionDays) | body: `enabled`, `time`(HH:MM), `retentionDays`(1–3650) | `{ …cfg, nextRunAt, consecutiveFailures, offsiteFailureCount }`; 400 |
| POST | `/api/backup/run-now` | admin | Trigger backup immediately | — | `{ status, lastRunAt, lastSizeBytes }`; 409 if running |

---

## Push notifications — `/api/push`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/push/vapid-public-key` | `authenticate` | Return VAPID public key | — | `{ vapidPublicKey }`; 503 if unconfigured |
| POST | `/api/push/subscribe` | `authenticate` | Create/update the caller's push subscription (upsert on endpoint). Endpoint must be https on a known push-service host (FCM, Apple, Windows, Mozilla); an endpoint owned by another user is refused | body: `endpoint`, `keys{p256dh,auth}` | 201 `{ ok }`; 400/409 |
| DELETE | `/api/push/unsubscribe` | `authenticate` | Remove the caller's own subscription by endpoint | body: `endpoint` | `{ ok }`; 400 |

---

## Email inbound — `/api/email-inbound`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/email-inbound/status` | `authenticate` | IMAP / mail-to-ticket configuration status | — | status object |

---

## Settings — `/api/settings`

System-wide runtime settings (key-value store, `app_settings` table). Read is
open to any authenticated user (frontend uses it to decide whether to show the
public-reply toggle); write is admin-only.

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/settings` | `authenticate` | Current two-way-email policy | — | `{ twoWayEmailEnabled }` |
| PUT | `/api/settings/two-way-email` | `authenticate` → `requireAdmin` | Toggle whether outbound mail goes to customers (audit-logged) | body: `enabled`(boolean, req) | `{ twoWayEmailEnabled }`; 400 |
| POST | `/api/settings/branding/logo` | `authenticate` → `requireAdmin` (+ multer `upload.single('file')` 1 MB, PNG/JPEG/WebP, magic-byte) | Upload or replace the instance logo (SVG not accepted; audit-logged) | multipart `file` | `{ logoUrl }`; 400 |
| DELETE | `/api/settings/branding/logo` | `authenticate` → `requireAdmin` | Remove the logo (idempotent; audit-logged) | — | 204 |

---

## Public (unauthenticated) — `/api/public`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/public/templates` | public/none | Public ticket templates + fields | — | template array |
| GET | `/api/public/categories` | public/none | Public categories for the form | — | `[{ id, label }]` |
| GET | `/api/public/branding` | public + `publicBrandingReadRateLimiter` | Instance branding | — | `{ logoUrl: string\|null }` |
| GET | `/api/public/branding/logo` | public + `publicBrandingReadRateLimiter` | Logo bytes (PNG/JPEG/WebP, served `inline` with `nosniff` and `Cross-Origin-Resource-Policy: cross-origin`) | — | image; 404 if none |
| POST | `/api/public/tickets` | `publicWriteRateLimiter` (5/min/IP) | Submit a public ticket (idempotency-aware). **Honeypot:** a non-empty `website` field returns a fake `200` and stores nothing. **Minimum fill time:** a `formStartedAt` (epoch-ms or ISO) too close to now is rejected with 400 | header `idempotency-key`; body: `name`, `email`, `title`, `description?`, `category?`, `priority?`, `customFields?`, `template_id?`, `website?` (must be empty), `formStartedAt?` | 201 `{ message, ticketId }`; 400 |

---

## Architecture map — `/api/architecture-map`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/architecture-map` | `authenticate` → `requireAdmin` | Serve the self-contained architecture-map HTML from `server/admin_assets/architecture-map/` (`Cache-Control: private, no-store`, `X-Robots-Tag: noindex`) | — | HTML; 503 if the asset is missing |

---

## Endpoint count

**160** documented operations (method + path): 158 in 24 mounted routers plus the 2
app-level routes (`/api/health`, `/api/csrf-token`); the template-fields sub-router
is mounted under `/api/templates/:templateId/fields` and counted within the Templates
section. The count is enforced by `node scripts/check-openapi-coverage.mjs`, which
compares every mounted route with `docs/openapi.yaml`.
