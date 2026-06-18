# Codebase Structure

**Analysis Date:** 2026-06-18

## Directory Layout

```
it-system/                          # Project root
├── src/                            # React SPA (frontend)
│   ├── pages/                      # Route-level page components
│   │   └── settings/               # Settings tab sub-components
│   ├── components/                 # Reusable UI components
│   │   └── ui/                     # shadcn/ui primitive components (27 files)
│   ├── hooks/                      # React Query data hooks (34+ files)
│   ├── contexts/                   # React contexts (AuthContext)
│   ├── lib/                        # Frontend utilities and ApiClient
│   └── types/                      # TypeScript type definitions
├── server/                         # Express backend
│   └── src/
│       ├── app.ts                  # createApp() factory — middleware + routes
│       ├── index.ts                # Process entry point — DB init, schedulers, listen
│       ├── routes/                 # Express routers (27 files)
│       ├── middleware/             # auth.ts, rateLimit.ts
│       ├── lib/                    # Domain helpers, schedulers, AI, email, webhooks
│       ├── db/                     # SQLite connection, schema, migrations
│       │   ├── connection.ts       # db singleton, initializeDatabase(), closeDatabase()
│       │   ├── schema.sql          # 17 base tables
│       │   └── migrations.ts       # 59 migrations (ids 001–059)
│       ├── config/                 # passport.ts (JWT + local strategies)
│       └── scripts/                # One-off maintenance scripts
├── public/                         # Static assets and PWA icons
├── dist/                           # Frontend build output (generated, not committed)
├── docs/                           # Project documentation
├── .planning/                      # GSD planning files (committed)
│   ├── codebase/                   # Codebase analysis documents
│   ├── milestones/                 # Milestone phase plans
│   └── phases/                     # Active phase plans
├── index.html                      # SPA HTML shell
├── vite.config.ts                  # Vite build config
├── tsconfig.app.json               # Frontend TypeScript config
├── tsconfig.node.json              # Node/server TypeScript config
├── package.json                    # Frontend dependencies + root scripts
├── docker-compose.yml              # Production compose file
├── docker-compose.local.yml        # Local dev compose
├── docker-compose.dev.portainer.yml# Dev server compose (Portainer-managed)
├── Dockerfile.client               # Frontend production image
├── Dockerfile.server               # Backend production image
├── Dockerfile.dev.client           # Frontend dev image (Vite hot-reload)
└── nginx.conf                      # nginx config (frontend container)
```

## Directory Purposes

**`src/pages/`:**
- Purpose: One file per top-level route. Each page component composes hooks and UI components.
- Contains: 23 `.tsx` files (Dashboard, TicketList, TicketDetail, TicketForm, Archive, KnowledgeBase, KBArticleForm, KBArticleDetail, Reports, Recurring, CompanyList, CompanyDetail, Invoices, UserList, Settings, Login, PublicTicketForm, SharedTicket, SharedKBArticle, ForgotPassword, ResetPassword, NotFound, Index).
- Key files: `src/pages/Dashboard.tsx` (home), `src/pages/TicketList.tsx` (main list + filters), `src/pages/TicketDetail.tsx` (ticket editing).

**`src/pages/settings/`:**
- Purpose: Settings page split into tabs.
- Contains: `AdminTab.tsx`, `GeneralTab.tsx`, `IntegrationsTab.tsx`, `TicketsTab.tsx`.

**`src/components/`:**
- Purpose: Reusable domain components shared across pages.
- Contains: 66 domain `.tsx` files (excl. `ui/`). Notable: `Layout.tsx` (nav shell), `TicketTable.tsx`, `KanbanView.tsx`, `CommandPalette.tsx`, `UnifiedFilterBar.tsx`, `QuickCaptureFAB.tsx`, `OnboardingWizard.tsx`.
- Key files: `src/components/Layout.tsx` (wraps every protected page).

**`src/components/ui/`:**
- Purpose: Low-level shadcn/ui primitives (button, dialog, select, input, etc.).
- Contains: 27 files. Do not modify these directly — re-run shadcn/ui CLI to update.
- Key files: `src/components/ui/rich-text-editor.tsx` (TipTap wrapper).

**`src/hooks/`:**
- Purpose: All server communication. Each hook owns one domain's data via React Query.
- Contains: 34+ `use*.ts` files. Also includes `use-mobile.tsx` (viewport detection).
- Pattern: File named after resource (`useTickets.ts`, `useKbArticles.ts`, `useSLAPolicies.ts`).

**`src/lib/`:**
- Purpose: Frontend utilities — ApiClient, helpers, and pure functions.
- Key files: `api.ts` (ApiClient singleton), `validations.ts` (form schemas), `date.ts`, `utils.ts`, `mapTicket.ts`, `appearance.ts` (dark/light mode), `constants.ts`, `recentlyViewed.ts`, `secureFileAccess.ts`.

**`src/contexts/`:**
- Purpose: React contexts.
- Contains: `AuthContext.tsx` (single context — auth state + signIn/signOut).

**`src/types/`:**
- Purpose: TypeScript type definitions for frontend domain objects.
- Contains: `ticket.ts` (Ticket, TicketStatus, TicketPriority, TimeEntryRow, etc.), `filterView.ts`.

**`server/src/routes/`:**
- Purpose: Express Router per domain resource, mounted in `server/src/app.ts`.
- Contains: 27 `.ts` files (26 mounted directly in `app.ts`, 1 nested: `template-fields.ts` inside `templates.ts`).
- Full list: `apiKeys`, `attachments`, `auth`, `backup`, `billing`, `categories`, `checklistTemplates`, `checklists`, `comments`, `companies`, `contacts`, `emailInbound`, `kb`, `links`, `public`, `push`, `recurring`, `reports`, `shares`, `sla`, `tags`, `template-fields`, `templates`, `tickets`, `time-entries`, `users`, `webhooks`.

**`server/src/middleware/`:**
- Purpose: Express middleware.
- Contains: `auth.ts` (`authenticate`, `requireAdmin`, `getUser`), `rateLimit.ts` (`createRateLimiter` + 4 pre-built limiters).

**`server/src/lib/`:**
- Purpose: Domain logic, schedulers, and infrastructure helpers.
- Contains: 28+ `.ts` files (including `.test.ts` co-located test files).
- Key files: `aiHelper.ts`, `ticketQuery.ts`, `slaHelper.ts`, `automationHelper.ts`, `auditLog.ts`, `webhookDispatcher.ts`, `webhookRetryScheduler.ts`, `emailInbound.ts`, `email.ts`, `logger.ts`, `push.ts`, `pushScheduler.ts`, `reminderScheduler.ts`, `autoCloseScheduler.ts`, `recurringScheduler.ts`, `htmlSanitizer.ts`, `htmlUtils.ts`, `passwordPolicy.ts`, `ticketImportExport.ts`, `offsiteBackup.ts`.

**`server/src/db/`:**
- Purpose: Database access layer.
- Key files: `connection.ts` (db singleton + migration runner), `schema.sql` (17 base tables), `migrations.ts` (59 additive migrations), `cleanup-refresh-tokens.ts`, `init.ts`.

**`server/src/config/`:**
- Purpose: Third-party configuration.
- Contains: `passport.ts` (Local + JWT strategies), `automation.ts`.

**`server/src/scripts/`:**
- Purpose: One-off maintenance and repair scripts.
- Contains: `repair-kb-tables.ts`, `repair-kb-tables.test.ts`.

**`server/data/`:**
- Purpose: Runtime data (not committed, created at startup).
- Contains: `database.sqlite` (main DB), `uploads/` (attachment files), `backups/` (daily ZIP snapshots).

**`public/`:**
- Purpose: Static assets.
- Contains: `icons/` (PWA icon set), `manifest` files.

**`.planning/`:**
- Purpose: GSD planning files — committed to repo, consumed by Claude commands.
- Generated: No. Committed: Yes.

## Key File Locations

**Entry Points:**
- `server/src/index.ts`: Backend process entry — boot, schedulers, listen.
- `server/src/app.ts`: Express app factory (`createApp()`).
- `src/main.tsx`: Frontend React root.
- `src/App.tsx`: Router, auth guards, all route definitions.
- `index.html`: SPA HTML shell.

**Configuration:**
- `vite.config.ts`: Vite bundler config.
- `tsconfig.app.json`: Frontend TypeScript.
- `tsconfig.node.json`: Backend/Node TypeScript.
- `server/src/config/passport.ts`: JWT + local auth strategies.
- `eslint.config.js`: ESLint rules (includes `no-restricted-syntax` for raw fetch).
- `components.json`: shadcn/ui component registry config.

**Core Logic:**
- `server/src/routes/tickets.ts`: Ticket CRUD + AI endpoints (1644 lines).
- `server/src/lib/aiHelper.ts`: All AI features via Anthropic SDK.
- `server/src/lib/ticketQuery.ts`: Query builder for ticket list filtering.
- `server/src/db/migrations.ts`: All 59 schema migrations.
- `src/lib/api.ts`: Frontend ApiClient (CSRF, JWT, refresh).

**Testing:**
- Co-located with source in `server/src/lib/` (e.g. `aiHelper.test.ts`, `slaHelper.test.ts`, `emailInbound.test.ts`, `ticketQuery.test.ts`).
- Frontend tests in `src/lib/` (e.g. `contentMigration.test.ts`, `date.test.ts`).
- Server integration tests: `server/src/app.test.ts` (supertest against `createApp()`); route-level test in `server/src/routes/reports.test.ts`.

## Naming Conventions

**Files:**
- Backend route files: camelCase (`apiKeys.ts`, `checklistTemplates.ts`, `time-entries.ts` — kebab for multi-word).
- Frontend page files: PascalCase (`TicketList.tsx`, `KBArticleDetail.tsx`).
- Frontend hook files: camelCase with `use` prefix (`useTickets.ts`, `useDashboardOverview.ts`).
- Frontend component files: PascalCase (`CommandPalette.tsx`, `UnifiedFilterBar.tsx`).
- Lib/utility files: camelCase (`aiHelper.ts`, `slaHelper.ts`, `webhookDispatcher.ts`).
- Test files: co-located, `<name>.test.ts` pattern.

**Directories:**
- `src/` — frontend source (React).
- `server/src/` — backend source (Node/Express).
- `server/src/lib/` — all backend helpers (flat, no subdirectories).
- `server/src/routes/` — one file per resource (flat).

## Where to Add New Code

**New API endpoint (new resource):**
1. Create `server/src/routes/<resource>.ts` (Router pattern, export default).
2. Import and mount in `server/src/app.ts`: `app.use('/api/<resource>', resourceRoutes)`.
3. Create corresponding `src/hooks/use<Resource>.ts` (useQuery/useMutation pattern).
4. Add methods to `src/lib/api.ts` if needed.

**New field/column on existing table:**
1. Add a migration to `server/src/db/migrations.ts` — append to the array, pick next id (`060`, etc.).
2. Schema changes via migration only; do not edit `schema.sql` for additive changes.

**New frontend page:**
1. Create `src/pages/<PageName>.tsx`.
2. Add `<Route>` in `src/App.tsx` (inside `AppRoutes`); wrap in `<ProtectedRoute>` if auth required.
3. Add nav item to `src/components/Layout.tsx` if it belongs in the sidebar.

**New settings tab:**
1. Create `src/pages/settings/<TabName>Tab.tsx`.
2. Import and wire in `src/pages/Settings.tsx`.

**New background scheduler:**
1. Create `server/src/lib/<name>Scheduler.ts` exporting `start<Name>Scheduler()` and `stop<Name>Scheduler()`.
2. Import and call `start<Name>Scheduler()` in `server/src/index.ts`.

**New shared domain logic (backend):**
1. Create `server/src/lib/<feature>Helper.ts`.
2. Import from route handlers as needed.

**Utilities (frontend):**
- Pure helpers: `src/lib/utils.ts` or new `src/lib/<name>.ts`.
- Date/time: `src/lib/date.ts`.
- Validation schemas: `src/lib/validations.ts`.

## Special Directories

**`server/data/`:**
- Purpose: Runtime SQLite DB, file uploads, automated backups.
- Generated: Yes (created at first run).
- Committed: No (in `.gitignore`).

**`dist/`:**
- Purpose: Frontend Vite build output.
- Generated: Yes (`npm run build`).
- Committed: No.

**`server/dist/`:**
- Purpose: Compiled TypeScript backend (used in production Docker image).
- Generated: Yes (`tsc`).
- Committed: No.

**`.planning/`:**
- Purpose: GSD planning documents, phase specs, codebase analysis.
- Generated: No.
- Committed: Yes.

**`node_modules/`:**
- Purpose: Frontend npm dependencies.
- Generated: Yes (`npm install`).
- Committed: No.

**`server/node_modules/`:**
- Purpose: Backend npm dependencies.
- Generated: Yes (`cd server && npm install`).
- Committed: No.

---

*Structure analysis: 2026-06-18*
