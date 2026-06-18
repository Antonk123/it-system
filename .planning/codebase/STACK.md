# Technology Stack

**Analysis Date:** 2026-06-18

## Languages

**Primary:**
- TypeScript 5.8.x (frontend, `tsconfig.app.json`) — React SPA
- TypeScript 5.7.x (backend, `server/tsconfig.json`) — Express API server

**Secondary:**
- SQL — SQLite schema and migrations (`server/src/db/schema.sql`, `server/src/db/migrations.ts`)
- HTML/CSS — nginx-served static build, Tailwind utility classes

## Runtime

**Environment:**
- Node.js 20 (`.nvmrc` pins `20`)
- ESM throughout — both frontend (`"type": "module"` in root `package.json`) and backend (`"type": "module"` in `server/package.json`)

**Package Manager:**
- npm
- Lockfile: present in both packages (`package-lock.json`, `server/package-lock.json`)

## Frameworks

**Core (Frontend):**
- React 18.3.x — UI library (`package.json`)
- React Router DOM 7.17.x — client-side routing
- Vite 7.3.x — dev server and bundler (`vite.config.ts`)
- Tailwind CSS 4.3.x — utility-first CSS
- @tanstack/react-query 5.83.x — server state management and caching

**Core (Backend):**
- Express 4.21.x — HTTP server (`server/package.json`)
- Passport 0.7.x — authentication framework (local + JWT strategies via `server/src/config/passport.ts`)
- better-sqlite3 12.10.x — synchronous SQLite driver

**UI Components:**
- shadcn/ui (assembled from `@radix-ui/*` primitives)
- Radix UI primitives: alert-dialog, checkbox, collapsible, dialog, dropdown-menu, label, popover, progress, select, slot, switch, tabs, toast, tooltip (all ^1.x/^2.x, see `package.json`)
- TipTap 3.20.x — rich-text/WYSIWYG editor (`@tiptap/react`, `@tiptap/starter-kit`, extensions for image, link, placeholder, table, underline)
- Framer Motion 12.38.x — animations and micro-interactions
- Recharts 3.8.x — charting/reporting
- @dnd-kit/core 6.3.x + @dnd-kit/sortable 10.0.x — drag-and-drop
- Lucide React 1.17.x — icon set
- date-fns 4.4.x — date utilities
- sonner 2.0.x — toast notifications
- cmdk 1.1.x — command palette
- react-day-picker 10.0.x — date picker
- react-markdown 10.1.x + markdown-it 14.2.x — markdown rendering/parsing
- DOMPurify 3.3.x — client-side HTML sanitization
- next-themes 0.3.x — dark/light theme management

**Testing:**
- Vitest 4.1.x — test runner (frontend and backend, both `package.json` and `server/package.json`)
- supertest 7.2.x — HTTP integration tests (backend only, `server/package.json`)
- @vitest/coverage-v8 4.1.x — code coverage (backend)

**Build/Dev:**
- @vitejs/plugin-react-swc 3.11.x — SWC-based React fast refresh
- vite-plugin-pwa 1.2.x — Progressive Web App manifest + Workbox service worker (`vite.config.ts`)
- workbox-precaching 7.4.x — PWA precaching
- tsx 4.19.x — TypeScript execution for backend dev/watch (`tsx watch src/index.ts`)
- husky 9.1.x — git hooks (pre-commit lint-staged, `package.json`)
- lint-staged 17.0.x — pre-commit linting on `*.{ts,tsx}`
- lovable-tagger 1.1.x — Lovable platform component tagging (dev only)

## Key Dependencies

**Critical (Backend):**
- `better-sqlite3` ^12.10.0 — synchronous SQLite3 driver; contentless FTS5 virtual tables for full-text search (`tickets_fts` via migration 024, `kb_articles_fts` via migration 014, `server/src/db/migrations.ts`)
- `@anthropic-ai/sdk` ^0.104.2 — Claude AI SDK for deflection/draft/summary/categorization (`server/src/lib/aiHelper.ts`)
- `@azure/msal-node` ^5.2.0 — Microsoft 365 OAuth2 client-credentials flow for IMAP access (`server/src/lib/emailInbound.ts`)
- `imapflow` ^1.4.0 — IMAP client for mail-to-ticket inbound email polling
- `nodemailer` ^8.0.11 — SMTP outbound email: notifications, password reset, ticket confirmations (`server/src/lib/email.ts`)
- `web-push` ^3.6.7 — Web Push / VAPID browser push notifications (`server/src/lib/push.ts`)
- `jsonwebtoken` ^9.0.2 — JWT access tokens (15 min expiry, `server/src/routes/auth.ts`)
- `bcryptjs` ^3.0.3 — password hashing
- `csrf-csrf` ^4.0.3 — double-submit CSRF protection (mandatory; `CSRF_SECRET` missing causes `process.exit(1)` at startup)
- `helmet` ^8.1.0 — HTTP security headers
- `exceljs` ^4.4.0 — XLSX export for tickets (`server/src/lib/ticketImportExport.ts`) and contacts (`server/src/routes/contacts.ts`)
- `sanitize-html` ^2.17.4 — server-side HTML sanitization (`server/src/lib/htmlSanitizer.ts`)
- `unzipper` ^0.12.3 — backup restore ZIP extraction (`server/src/routes/backup.ts`)
- `archiver` ^7.0.1 — backup creation ZIP archive (`server/src/routes/backup.ts`, `server/src/index.ts`)
- `node-cron` ^4.2.1 — scheduled tasks: cleanup at 03:00/03:15, backup at 04:00 (`server/src/index.ts`)
- `multer` ^2.1.1 — multipart file uploads (`server/src/routes/attachments.ts`)
- `mailparser` ^3.9.8 — parse incoming IMAP messages
- `uuid` ^11.0.5 — UUIDs for all entity IDs
- `passport-jwt` ^4.0.1 + `passport-local` ^1.0.0 — authentication strategies

**Infrastructure (Frontend):**
- `zod` ^3.25.76 — schema validation
- `class-variance-authority` ^0.7.1 + `clsx` ^2.1.1 + `tailwind-merge` ^2.6.0 — Tailwind class composition (shadcn/ui pattern)
- `rehype-sanitize` ^6.0.0 — markdown HTML sanitization (frontend)

## Configuration

**Environment:**
- Backend: environment variables from shell/Docker environment (no `.env` committed). `CSRF_SECRET` mandatory — `process.exit(1)` on missing. `JWT_SECRET` mandatory in production.
- Frontend: Vite proxies `/api/*` to backend via `vite.config.ts` (`API_TARGET` env var, defaults to `http://it-ticketing-backend:3001`)

**TypeScript:**
- Frontend: `tsconfig.app.json` — strict mode
- Backend: `server/tsconfig.json` — target ES2022, strict mode, `moduleResolution: bundler`, outDir `server/dist/`

**Tailwind:**
- Config: `postcss.config.js` using `@tailwindcss/postcss` ^4.3.x
- Typography: `@tailwindcss/typography` ^0.5.19

**ESLint:**
- Config: `eslint.config.js` (ESLint 9.x flat config)
- Plugins: `eslint-plugin-react-hooks` ^5.2.0, `eslint-plugin-react-refresh` ^0.4.20, `typescript-eslint` ^8.36.0
- Custom rule: `no-restricted-syntax` blocks raw `fetch('/api/...')` — all mutating API calls must use `src/lib/api.ts`

**PWA:**
- Service worker: `vite-plugin-pwa` with `injectManifest` strategy, source at `src/sw.ts`
- Selective precaching: lazy vendor chunks (reporting, motion, dnd, markdown) excluded; editor-vendor (TipTap) included for offline use
- Theme: `#ff9e4d` / background `#0f0f14`

**Build:**
- Manual chunk splitting in `vite.config.ts`: `react-vendor`, `radix-vendor`, `editor-vendor`, `reporting-vendor`, `motion-vendor`, `dnd-vendor`, `markdown-vendor`, `icons-vendor`, `query-vendor`, `date-vendor`
- Source maps disabled in production

## Platform Requirements

**Development:**
- Node.js 20 (`.nvmrc`)
- Docker + docker-compose for local dev (`docker-compose.local.yml`)
- Backend dev: `tsx watch src/index.ts` (hot reload)
- Frontend dev: Vite dev server on port 5173

**Production:**
- Docker containers on Proxmox via Portainer (stack `it-ticket-system`, id 39)
- Backend: port 3001 internal → 3002 external (`docker-compose.yml`)
- Frontend: nginx on port 80 → 8082 external
- Persistent volume: `it-ticketing-data` (external Docker volume — database + uploads)
- Reverse proxy upstream: HTTPS at `ticket.prefabmastarna.se`

---

*Stack analysis: 2026-06-18*
