---
name: express-api-route
description: >-
  Use when adding or modifying ANY backend Express route/endpoint, or wiring a
  frontend call to one. Triggers on: "new endpoint", "add an API route", "new
  route", "expose ... via the API", "POST/GET/PUT/DELETE handler", "call the API
  from the frontend", and Swedish "ny endpoint", "nytt API", "lägg till route",
  "anropa API:t". Ensures correct auth, CSRF, parameterized SQL, logging, route
  mounting, and that frontend calls go through api.request() (raw fetch is
  ESLint-blocked).
---

# Express API routes (IT-Ticket)

## Backend (server/src/routes/<name>.ts)
Mirror existing routers (e.g. tags.ts):
```ts
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
const router = Router();
router.get('/', authenticate, (req: AuthRequest, res: Response) => { /* ... */ });
export default router;
```
Rules:
- EVERY route gets `authenticate`. Admin-only mutations also get `requireAdmin`.
- Use `db.prepare('... WHERE id = ?').get(id)` — parameterized, NEVER string
  interpolation (SQL injection).
- Log errors via `logger.error(...)`, not `console.*` (ESLint no-console is error
  in server scope). Return 400 (validation) / 404 (not found) / 500 (catch).
- Note `.js` import extensions (NodeNext ESM).

## Mount it (server/src/app.ts)
Add `import xRoutes from './routes/x.js';` and `app.use('/api/x', xRoutes);`
alongside the other `app.use('/api/...')` lines. Unmounted routers are dead code.

## CSRF / auth nuances (verified in app.ts)
- State-changing requests are CSRF-protected by default (double-submit cookie).
- CSRF is EXEMPT only for `/api/auth/login`, `/api/auth/refresh`, and the
  `/api/public/` prefix. A new UNAUTHENTICATED public endpoint MUST live under
  `/api/public/` (credentialless), otherwise it will 403 on CSRF.
- API-key requests (`Authorization: Bearer itk_live_...`) bypass CSRF but still
  pass through `authenticate`. Don't add a second auth layer.

## Frontend call (src/lib/...)
NEVER `fetch('/api/...')` — ESLint `no-restricted-syntax` blocks it. Add a method
on `api` in `src/lib/api.ts` (or call `api.request<T>(endpoint, { method, body })`).
`request()` handles CSRF token, Bearer header and silent 401-refresh. Only
src/lib/api.ts and secureFileAccess.ts are allowed raw fetch.

## Verify
`cd server && npx tsc --noEmit && npm test`; frontend `npx tsc --noEmit -p
tsconfig.app.json` and `npm test`. Add a <name>.test.ts mirroring an existing
route test (vi.hoisted unique DB_PATH + CSRF_SECRET/JWT_SECRET, login once).
