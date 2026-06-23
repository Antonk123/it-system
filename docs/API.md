# IT-Ticket — API Endpoint Reference

> **Generated from code at audit-v3 (2026-06-23).** This reference was produced by
> reading the live Express routers in `server/src/routes/` and the route mounts in
> `server/src/app.ts`. It is intended as a *living* reference: **update it whenever
> routes change** (new endpoint, changed auth chain, changed input/response shape).
> Accuracy over exhaustive prose — where a request input or response shape was not
> trivially inferable from the handler it is omitted rather than invented.

All paths are relative to the server origin (e.g. `https://ticket.prefabmastarna.se`).
All API routes are mounted under `/api`. Responses are JSON unless noted (file
downloads return binary with `Content-Disposition: attachment`).

---

## Auth model

Authentication is resolved per-request in `server/src/middleware/auth.ts` and
`server/src/config/passport.ts`.

| Mechanism | How | Notes |
|-----------|-----|-------|
| **JWT access token** | `Authorization: Bearer <jwt>` | 15-min lifetime, HS256, verified by passport-jwt. Subject = user id. |
| **Refresh token** | HttpOnly `refreshToken` cookie (or request body) | Rolling/rotating. Used only by `POST /api/auth/refresh` and `/logout`. |
| **API key** | `Authorization: Bearer itk_live_<key>` | SHA-256 hashed, constant-time compared. Scopes: `read` (default) and `write`. A key without `write` is rejected with **403** on any `POST/PUT/PATCH/DELETE`. API-key requests are tried **before** JWT. |
| **CSRF** | `x-csrf-token` header + `csrf-token` cookie (double-submit) | Required for all cookie-authenticated mutations (`POST/PUT/PATCH/DELETE`). **Exempt:** API-key requests (`Bearer itk_live_…`), `/api/auth/login`, `/api/auth/refresh`, and everything under `/api/public/`. Fetch a token from `GET /api/csrf-token`. |

### Middleware vocabulary used in the tables

| Label | Meaning |
|-------|---------|
| `authenticate` | Requires a valid JWT **or** API key. Sets `req.user`. |
| `requireAdmin` | Requires `req.user.role === 'admin'` (run after `authenticate`). |
| `canAccessTicket` (in-handler) | Per-ticket authorization check inside the handler (admin, assignee, or creator — see `server/src/lib/ticketAccess.ts`). Not a route middleware. |
| `public/none` | No authentication required. |
| `loginRateLimiter` | 5 requests / 15 min / IP. |
| `refreshRateLimiter` | 10 requests / 15 min / IP. |
| `writeRateLimiter` | 60 requests / min / IP. |
| `publicWriteRateLimiter` | 30 requests / min / IP. |
| `publicAiRateLimiter` | 10 requests / min / IP (each call hits Anthropic). |
| `aiRateLimiter` (tickets) | 5 requests / min / IP. |
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
- `GET /api/public/templates`, `GET /api/public/categories`
- `POST /api/public/tickets` (rate-limited), `POST /api/public/ai-suggest` (rate-limited), `PATCH /api/public/ai-suggest/:id` (rate-limited)
- `GET /api/kb/public/:token`, `GET /api/kb/images/:filename`
- `GET /api/shares/public/:token`, `GET /api/shares/public/file/:token/:attachmentId` (rate-limited)

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
| POST | `/api/auth/login` | `loginRateLimiter` + passport-local | Authenticate, issue access token + refresh cookie | body: `email`, `password` | `{ user, token, accessToken }` + HttpOnly `refreshToken` cookie; 401 invalid |
| POST | `/api/auth/refresh` | `refreshRateLimiter` (no auth mw) | Rotate refresh token, issue new access token | `refreshToken` cookie or body | `{ accessToken, token }` + new cookie; 400/401 |
| POST | `/api/auth/logout` | `authenticate` | Revoke refresh token, clear cookie | refresh token cookie/body | `{ message }` |
| GET | `/api/auth/me` | `authenticate` | Current user | — | `{ user }` |
| POST | `/api/auth/change-password` | `authenticate` | Change own password; revokes all refresh tokens | body: `currentPassword`, `newPassword` | `{ message }`; 400/404 |
| POST | `/api/auth/forgot-password` | `loginRateLimiter` | Issue reset token + email link (enumeration-safe) | body: `email` | generic `{ message }` (always 200) |
| POST | `/api/auth/reset-password` | `loginRateLimiter` | Reset password via token; revokes all refresh tokens | body: `token`, `newPassword` | `{ message }`; 400 invalid/expired |
| GET | `/api/auth/audit-log` | `authenticate` → `requireAdmin` | Paginated audit-log viewer | query: `limit`(≤200), `offset`, `entity_type`, `action` | `{ entries, total, limit, offset }` |

---

## Users — `/api/users`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/users` | `authenticate` | List users (reduced for non-admins, full for admins) | — | `{ users }` |
| POST | `/api/users` | `authenticate` → `requireAdmin` | Create user (auto-gen password if omitted) | body: `email`, `password?`, `role?`, `displayName?` | 201 `{ message, user, temporaryPassword? }`; 400/409 |
| PATCH | `/api/users/:id` | `authenticate` → `requireAdmin` | Update `role` / `displayName` | params: `id`; body: `role?`, `displayName?` | `{ message }`; 400 (incl. self-demote)/404 |
| DELETE | `/api/users/:id` | `authenticate` → `requireAdmin` | Delete user (blocks self-deletion) | params: `id` | `{ message }`; 400/404 |

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
| GET | `/api/tickets/upcoming-reminders` | `authenticate` | Unsent future reminders (top 6) | — | reminder array |
| GET | `/api/tickets/:id` | `authenticate` | Get one ticket + custom fields + tags | params: `id` | `{ ...ticket, field_values[], tags[] }`; 404 |
| POST | `/api/tickets` | `writeRateLimiter` → `authenticate` | Create ticket (+ custom fields, auto-priority/tags, SLA, async AI category, email, webhook) | body: `title`(req), `description`/`customFields`(one req), + optional fields | 201 `{ ...ticket, warnings? }`; 400 |
| POST | `/api/tickets/:id/ai-draft` | `aiRateLimiter` → `authenticate` (+ `canAccessTicket`) | AI reply draft from KB + text attachments; persists draft | params: `id` | `{ draft, kbArticlesUsed, kbTitles[], attachmentsUsed[] }`; 403/404/502/503 |
| GET | `/api/tickets/:id/ai-summary` | `aiRateLimiter` → `authenticate` | Cached (<1h) or fresh AI ticket summary | params: `id`; query: `force=1` | `{ summary, cached, ageMinutes }` or `{ summary:null, reason }`; 404/502/503 |
| GET | `/api/tickets/:id/history` | `authenticate` (+ `canAccessTicket`) | Ticket change history (cap 500) | params: `id` | history-row array; 403/404 |
| PUT | `/api/tickets/bulk` | `writeRateLimiter` → `authenticate` (+ per-ticket `canAccessTicket`) | Bulk-update status/priority/category/assignee (≤500) | body: `ids[]`, `updates{}` | `{ updated, skipped[] }`; 400 |
| POST | `/api/tickets/bulk-delete` | `writeRateLimiter` → `authenticate` → `requireAdmin` | Permanently delete many tickets + attachment files | body: `ids[]` | `{ deleted, alreadyGone? }`; 400 |
| PUT | `/api/tickets/:id` | `writeRateLimiter` → `authenticate` (+ `canAccessTicket`) | Update ticket fields/custom fields/tags; logs history, SLA, email, webhooks | params: `id`; body: optional ticket fields + `customFields`, `tag_ids`, `ai_suggested_category_id` | `{ ...ticket, tags[], warnings? }`; 400/403/404 |
| DELETE | `/api/tickets/:id` | `writeRateLimiter` → `authenticate` → `requireAdmin` | Permanently delete one ticket + attachment files | params: `id` | `{ message }`; 404 |
| POST | `/api/tickets/:id/reminders` | `authenticate` | Create reminder | params: `id`; body: `reminder_time`(future, req), `message` | 201 reminder; 400/404 |
| GET | `/api/tickets/:id/reminders` | `authenticate` | List reminders for a ticket | params: `id` | reminder array |
| DELETE | `/api/tickets/:id/reminders/sent` | `authenticate` | Clear caller's own sent reminders | params: `id` | `{ deleted }` |
| DELETE | `/api/tickets/:id/reminders/:reminderId` | `authenticate` (+ owner-or-admin) | Cancel a specific reminder | params: `id`, `reminderId` | `{ message }`; 403/404 |

> **Design note:** Most ticket *read* endpoints (`GET /:id`, dashboard/list reads,
> reminders) use `authenticate` only — no per-ticket `canAccessTicket`. Per-ticket
> access is enforced on `ai-draft`, `ai-summary`, `history`, `PUT /:id`, and `PUT /bulk`.
> This is the intended open self-service queue model.

---

## Comments — `/api/comments`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/comments/ticket/:ticketId` | `authenticate` | Non-deleted comments for a ticket (cap 500) | params: `ticketId` | `CommentRow[]` |
| POST | `/api/comments/ticket/:ticketId` | `authenticate` | Create comment (HTML sanitized; bumps ticket) | params: `ticketId`; body: `content`(req), `isInternal`(default true) | 201 `CommentRow`; 400/401 |
| PUT | `/api/comments/:id` | `authenticate` (+ owner-or-admin) | Update comment content | params: `id`; body: `content` | `CommentRow`; 403/404 |
| DELETE | `/api/comments/:id` | `authenticate` (+ owner-or-admin) | Soft-delete comment | params: `id` | `{ message }`; 403/404 |

---

## Checklists — `/api/checklists`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| POST | `/api/checklists/progress` | `authenticate` (+ `canAccessTicket` filter) | Batch progress (total/completed) for many tickets | body: `ticketIds[]` | `Record<ticketId,{total,completed}>` |
| GET | `/api/checklists/ticket/:ticketId` | `authenticate` (+ `canAccessTicket`) | Checklist items for a ticket | params: `ticketId` | item array; 403 |
| POST | `/api/checklists/ticket/:ticketId` | `authenticate` (+ `canAccessTicket`) | Add one item | params: `ticketId`; body: `label`(req), `parent_id?`, `due_date?` | 201 item; 400/403/404 |
| POST | `/api/checklists/ticket/:ticketId/bulk` | `authenticate` (+ `canAccessTicket`) | Bulk add items (`labels[]` or `items[]`) | params: `ticketId`; body: `labels[]`/`items[]` | 201 item array; 400/403/404 |
| PUT | `/api/checklists/:id` | `authenticate` (+ `canAccessTicket` via item) | Update item | params: `id`; body: `label`/`completed`/`due_date`/`parent_id` | item; 403/404 |
| DELETE | `/api/checklists/:id` | `authenticate` (+ `canAccessTicket` via item) | Hard-delete item | params: `id` | `{ message }`; 403/404 |

---

## Checklist templates — `/api/checklist-templates`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/checklist-templates` | `authenticate` | List templates with items | — | template array |
| POST | `/api/checklist-templates` | `authenticate` → `requireAdmin` | Create template + items (txn) | body: `name`(req), `description?`, `items[]`(req) | 201 template; 400/409 |
| PUT | `/api/checklist-templates/:id` | `authenticate` → `requireAdmin` | Update template (replaces items if given) | params: `id`; body: `name?`, `description?`, `items?` | template; 404/409 |
| DELETE | `/api/checklist-templates/:id` | `authenticate` → `requireAdmin` | Delete template | params: `id` | `{ message }`; 404 |
| POST | `/api/checklist-templates/:id/apply` | `authenticate` (+ `canAccessTicket`) | Apply template items to a ticket (txn) | params: `id`; body: `ticketId`(req) | 201 checklist rows; 400/403/404 |

---

## Links — `/api/links`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/links/ticket/:ticketId` | `authenticate` (+ `canAccessTicket`) | All links for a ticket (bidirectional) | params: `ticketId` | `TicketLinkWithDetails[]`; 403 |
| POST | `/api/links/ticket/:ticketId` | `authenticate` (+ `canAccessTicket` source & target) | Create link between two tickets | params: `ticketId`; body: `targetTicketId`(req), `linkType`(default `related`) | 201 link; 400/401/403/404/409 |
| DELETE | `/api/links/:id` | `authenticate` (+ admin or assignee/creator of either ticket) | Delete a link | params: `id` | `{ message }`; 401/403/404 |

> Valid `linkType` values: `related`, `blocks`, `blocked_by`, `duplicate`, `parent`, `child`.

---

## Shares — `/api/shares`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/shares/ticket/:ticketId` | `authenticate` (+ `canAccessTicket`) | Get existing share token | params: `ticketId` | `{ share_token: string\|null }`; 403 |
| POST | `/api/shares/ticket/:ticketId` | `authenticate` (+ `canAccessTicket`) | Create share link (idempotent) | params: `ticketId` | `{ share_token }` (200 existing / 201 new); 403/404 |
| DELETE | `/api/shares/ticket/:ticketId` | `authenticate` (+ `canAccessTicket`) | Delete share link | params: `ticketId` | `{ message }`; 403/404 |
| GET | `/api/shares/public/:token` | `sharePublicRateLimiter` (public) | Public read of a shared ticket (strips internal `notes`) | params: `token` | `{ ticket, requester, attachments[], checklistItems[] }`; 404 |
| GET | `/api/shares/public/file/:token/:attachmentId` | `sharePublicRateLimiter` (public) | Serve an attachment for a shared ticket (forced download) | params: `token`, `attachmentId` | file download; 404 |

---

## Attachments — `/api/attachments`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/attachments/ticket/:ticketId` | `authenticate` (+ `canAccessTicket`) | List attachment metadata (+ url) | params: `ticketId` | `AttachmentRow[]`; 403 |
| POST | `/api/attachments/ticket/:ticketId` | `authenticate` (+ multer `upload.single('file')` 10 MB + magic-byte + `canAccessTicket` + per-ticket cap 50) | Upload one file | params: `ticketId`; multipart `file` | 201 attachment (+ url); 400/403/404 |
| GET | `/api/attachments/file/:id` | `authenticate` (+ `canAccessTicket` via attachment) | Download a file (forced attachment, never inline) | params: `id` | file download; 403/404 |
| DELETE | `/api/attachments/:id` | `authenticate` (+ `canAccessTicket` via attachment) | Delete attachment (row then file) | params: `id` | `{ message }`; 403/404 |

---

## Knowledge base — `/api/kb`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/kb/categories` | `authenticate` | List categories + published-article counts | — | category array |
| POST | `/api/kb/categories` | `authenticate` → `requireAdmin` | Create category | body: `name`(req), `color?` | 201 category; 400 |
| PUT | `/api/kb/categories/:id` | `authenticate` → `requireAdmin` | Update category | params: `id`; body: `name`, `color?` | category; 400/404 |
| DELETE | `/api/kb/categories/:id` | `authenticate` → `requireAdmin` | Delete category | params: `id` | `{ message }`; 404 |
| GET | `/api/kb/articles` | `authenticate` | List published articles (FTS search/filters) + tags | query: `search?`, `category_id?`, `article_type?`, `tag?`, `stale?` | article array |
| GET | `/api/kb/articles/:id` | `authenticate` | Single article (admins see drafts) | params: `id` | `{ ...article, tags }`; 404 |
| GET | `/api/kb/articles/:id/tickets` | `authenticate` | Tickets linked to this article | params: `id` | ticket array |
| POST | `/api/kb/articles` | `authenticate` → `requireAdmin` | Create article (+FTS, tags; sanitizes HTML) | body: `title`(req), `category_id`(req), `content?`, `article_type?`, `tag_ids?`, `status?` | 201 article; 400 |
| PUT | `/api/kb/articles/:id` | `authenticate` → `requireAdmin` | Update article (+FTS resync, tags) | params: `id`; body: as create | article; 400/404 |
| PATCH | `/api/kb/articles/:id/review` | `authenticate` → `requireAdmin` | Mark article reviewed | params: `id` | `{ last_reviewed_at }`; 404 |
| DELETE | `/api/kb/articles/:id` | `authenticate` → `requireAdmin` | Delete article (+FTS, image cleanup) | params: `id` | `{ message }`; 404 |
| GET | `/api/kb/ticket/:ticketId` | `authenticate` | KB articles linked to a ticket | params: `ticketId` | article array |
| POST | `/api/kb/ticket/:ticketId` | `authenticate` (+ `canAccessTicket`) | Link article to ticket | params: `ticketId`; body: `articleId` | 201 link; 400/403/404/409 |
| DELETE | `/api/kb/ticket/:ticketId/:articleId` | `authenticate` (+ `canAccessTicket`) | Unlink article from ticket | params: `ticketId`, `articleId` | `{ message }`; 403/404 |
| GET | `/api/kb/articles/:id/links` | `authenticate` | Cross-reference list (published only) | params: `id` | linked-article array |
| POST | `/api/kb/articles/:id/links` | `authenticate` → `requireAdmin` | Create cross-link | params: `id`; body: `targetArticleId` | 201 link; 400/409 |
| DELETE | `/api/kb/articles/:id/links/:targetId` | `authenticate` → `requireAdmin` | Remove cross-link | params: `id`, `targetId` | `{ message }`; 404 |
| GET | `/api/kb/articles/:id/share` | `authenticate` | Get share token | params: `id` | `{ share_token }` |
| POST | `/api/kb/articles/:id/share` | `authenticate` → `requireAdmin` | Create share token (idempotent) | params: `id` | `{ share_token }`; 404 |
| DELETE | `/api/kb/articles/:id/share` | `authenticate` → `requireAdmin` | Revoke share token | params: `id` | `{ message }`; 404 |
| GET | `/api/kb/public/:token` | **public/none** | Public read-only shared article | params: `token` | `{ ...article, tags }`; 404 |
| POST | `/api/kb/upload-image` | `authenticate` → `requireAdmin` (+ multer `uploadImage.single('image')` 10 MB, magic-byte) | Upload KB image | multipart `image` | 201 `{ url }`; 400 |
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

## Tags — `/api/tags`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/tags` | `authenticate` | List tags | — | `TagRow[]` |
| POST | `/api/tags` | `authenticate` → `requireAdmin` | Create tag (default color `#3b82f6`) | body: `name`, `color?` | 201 tag; 400 (incl. duplicate) |
| PUT | `/api/tags/:id` | `authenticate` → `requireAdmin` | Update name/color | params: `id`; body: `name`, `color?` | tag; 400/404 |
| DELETE | `/api/tags/:id` | `authenticate` → `requireAdmin` | Delete tag | params: `id` | `{ message }`; 404 |

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
| PUT | `/api/companies/:id` | `authenticate` → `requireAdmin` | Update company (re-syncs SLA on `sla_disabled` change) | params: `id`; body: optional company fields + `sla_disabled?` | company; 400/404 |
| DELETE | `/api/companies/:id` | `authenticate` → `requireAdmin` | Delete company (nulls contacts' `company_id`) | params: `id` | `{ message }`; 404 |

---

## Contacts — `/api/contacts`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/contacts` | `authenticate` | List contacts (cap 500, + company name) | — | `ContactRow[]` |
| GET | `/api/contacts/export` | `authenticate` | Export all contacts as XLSX | — | XLSX binary; 404 if none |
| POST | `/api/contacts/import/preview` | `authenticate` (+ multer `upload.single('file')` CSV 5 MB) | Validate uploaded CSV (no write) | multipart `file` | `{ total, valid, invalid, duplicates, results[] }`; 400 |
| POST | `/api/contacts/import/confirm` | `authenticate` | All-or-nothing import (creates missing companies) | body: `contacts[]` | `{ success, created, failed, errors[] }`; 400 |
| GET | `/api/contacts/:id` | `authenticate` | Single contact (+ company name) | params: `id` | `ContactRow`; 404 |
| POST | `/api/contacts` | `authenticate` → `requireAdmin` | Create contact | body: `name`(req), `email`(req), `phone?`, `company_id?`, `department?` | 201 contact; 400 |
| PUT | `/api/contacts/:id` | `authenticate` → `requireAdmin` | Update contact (whitelisted fields) | params: `id`; body: optional contact fields | contact; 400/404 |
| DELETE | `/api/contacts/:id` | `authenticate` → `requireAdmin` | Delete contact | params: `id` | `{ message }`; 404 |

---

## Billing — `/api/billing`

All routes require `authenticate` → `requireAdmin`. Invoice mutations are audit-logged.

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/billing/rates/:companyId` | admin | Get billing rate for a company | params: `companyId` | `BillingRateRow` or `null` |
| PUT | `/api/billing/rates/:companyId` | admin | Upsert billing rate | params: `companyId`; body: `rate_per_hour`(>0, req), `currency`(default `SEK`) | rate row; 400 |
| GET | `/api/billing/invoices` | admin | List invoices (optional company filter) | query: `company_id?` | invoice array |
| GET | `/api/billing/invoices/:id` | admin | Single invoice with lines + company details | params: `id` | `{ ...invoice, lines[] }`; 404 |
| POST | `/api/billing/invoices/preview` | admin | Compute draft invoice from time entries (no save) | body: `company_id`, `period_start`, `period_end` (all req) | draft invoice; 400 |
| POST | `/api/billing/invoices` | admin | Create invoice (server recomputes totals; blocks overlap) | body: `company_id`, `period_start`, `period_end`, `lines[]`, `currency?` | 201 invoice; 400/409 |
| PUT | `/api/billing/invoices/:id/status` | admin | Forward-only status transition (draft→sent→paid) | params: `id`; body: `status` | invoice; 400/404 |
| DELETE | `/api/billing/invoices/:id` | admin | Delete invoice (draft only) | params: `id` | `{ message }`; 400/404 |

---

## Time entries — `/api/time-entries`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/time-entries/:ticketId` | `authenticate` (+ `canAccessTicket`) | List time entries + total minutes | params: `ticketId` | `{ entries[], total_minutes }`; 403 |
| POST | `/api/time-entries/:ticketId` | `authenticate` (+ admin/assignee/creator) | Create a time entry | params: `ticketId`; body: `duration_minutes`(1–1440, req), `note?` | 201 entry; 400/403/404 |
| DELETE | `/api/time-entries/:ticketId/:id` | `authenticate` (+ admin or entry creator) | Delete a time entry | params: `ticketId`, `id` | 204; 403/404 |

---

## Reports — `/api/reports`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/reports/summary` | `authenticate` | KPI summary (totals, byCategory, byPriority, trend, avg resolution, aging) | query: `year?`, `month?` | `{ totals, byCategory, byPriority, trend, avgResolutionDays, agingTickets }`; 400 |
| GET | `/api/reports/time-summary` | `authenticate` | Time summary by category + top tickets | query: `year?`, `month?` | `{ byCategory, topTickets }` |
| GET | `/api/reports/requester-analytics` | `authenticate` | Per-requester analytics (top 15) | query: `year?`, `month?` | requester-metrics array; 400 |
| GET | `/api/reports/status-flow` | `authenticate` | 12-month per-status series | — | status-flow array |
| GET | `/api/reports/tag-analytics` | `authenticate` | Tag-frequency counts | — | tag-analytics array |
| GET | `/api/reports/kpi-tickets` | `authenticate` | KPI drill-down ticket rows (cap 200) | query: `scope`(`total`\|`aging`, req), `year?`, `month?` | ticket-row array; 400 |

---

## Recurring tickets — `/api/recurring`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/recurring` | `authenticate` | List templates with recent history | — | template array |
| POST | `/api/recurring` | `authenticate` → `requireAdmin` | Create template (computes next_run) | body: `name`, `title`, `interval_type`, `interval_day?`, + optional fields | 201 template; 400 |
| PUT | `/api/recurring/:id` | `authenticate` → `requireAdmin` | Update template (recomputes next_run) | params: `id`; body: partial of create + `is_active?` | template; 400/404 |
| DELETE | `/api/recurring/:id` | `authenticate` → `requireAdmin` | Delete template (cascades history) | params: `id` | 204; 404 |
| PATCH | `/api/recurring/:id/toggle` | `authenticate` → `requireAdmin` | Pause/resume toggle | params: `id` | `{ id, is_active, next_run }`; 404 |

---

## SLA — `/api/sla`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/sla` | `authenticate` | List SLA policies (filter by company) | query: `company_id?` (`default`/id/`all`) | `SLAPolicyRow[]` |
| PUT | `/api/sla` | `authenticate` → `requireAdmin` | Upsert policies for a company/default | body: `company_id?`, `policies[]` | policy array; 400 |
| DELETE | `/api/sla/:id` | `authenticate` → `requireAdmin` | Delete single policy | params: `id` | `{ message }`; 404 |

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
| POST | `/api/webhooks` | admin | Create webhook (SSRF-checks URL, generates secret) | body: `url`, `events[]` | 201 `{ id, url, events, secret, active, … }`; 400 |
| PUT | `/api/webhooks/:id` | admin | Update webhook (partial; SSRF-checks new URL) | params: `id`; body: `url?`, `events?`, `active?` | webhook (no secret); 400/404 |
| DELETE | `/api/webhooks/:id` | admin | Delete webhook | params: `id` | `{ message }`; 404 |
| GET | `/api/webhooks/:id/deliveries` | admin | List last 50 delivery attempts | params: `id` | delivery array |

---

## Backup — `/api/backup`

All routes require `authenticate` → `requireAdmin`.

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/backup` | admin + `backupDownloadLimiter` | Stream a ZIP backup (DB + uploads) | — | ZIP stream |
| POST | `/api/backup/restore` | admin + `restoreLimiter` + multer `upload.single('file')` (ZIP, 500 MB) | Restore from uploaded ZIP (zip-slip/magic/table validation, then `process.exit`) | multipart `file` | `{ success, message, restartRequired }`; 400 |
| GET | `/api/backup/config` | admin | Get backup schedule config + nextRunAt | — | `{ …cfg, nextRunAt }` |
| PUT | `/api/backup/config` | admin | Update schedule (enabled/time/retentionDays) | body: `enabled`, `time`(HH:MM), `retentionDays`(1–3650) | `{ …cfg, nextRunAt }`; 400 |
| POST | `/api/backup/run-now` | admin | Trigger backup immediately | — | `{ status, lastRunAt, lastSizeBytes }`; 409 if running |

---

## Push notifications — `/api/push`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/push/vapid-public-key` | `authenticate` | Return VAPID public key | — | `{ vapidPublicKey }`; 503 if unconfigured |
| POST | `/api/push/subscribe` | `authenticate` | Create/update push subscription (upsert on endpoint) | body: `endpoint`, `keys{p256dh,auth}` | 201 `{ ok }`; 400 |
| DELETE | `/api/push/unsubscribe` | `authenticate` | Remove subscription by endpoint | body: `endpoint` | `{ ok }`; 400 |

---

## Email inbound — `/api/email-inbound`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/email-inbound/status` | `authenticate` | IMAP / mail-to-ticket configuration status | — | status object |

---

## Public (unauthenticated) — `/api/public`

| Method | Path | Auth | Purpose | Inputs | Response |
|--------|------|------|---------|--------|----------|
| GET | `/api/public/templates` | public/none | Public ticket templates + fields | — | template array |
| GET | `/api/public/categories` | public/none | Public categories for the form | — | `[{ id, label }]` |
| POST | `/api/public/tickets` | `publicWriteRateLimiter` | Submit a public ticket (idempotency-aware) | header `idempotency-key`; body: `name`, `email`, `title`, `description?`, `category?`, `priority?`, `customFields?`, `template_id?` | 201 `{ message, ticketId }`; 400 |
| POST | `/api/public/ai-suggest` | `publicAiRateLimiter` | AI deflection: KB search + AI solution before ticket creation | body: `problemText`(10–5000 chars), `userEmail?` | `{ deflectionId, hasSolution, solution, confidence, kbReferences }`; 400/503 |
| PATCH | `/api/public/ai-suggest/:id` | `publicWriteRateLimiter` | Update deflection outcome | params: `id`; body: `outcome`(`solved`\|`rejected`), `ticketId?` | `{ ok }`; 400/404 |
| GET | `/api/public/ai-suggest/stats` | `authenticate` | Deflection stats (last 30 days) — **requires auth despite path** | — | `{ shown, solved, rejected, no_solution, total, deflectionRate }` |

---

## Endpoint count

Roughly **130** endpoints across 25 routers (plus 2 app-level routes and the
template-fields sub-router). Counts are approximate — confirm against source when
the figure matters.
