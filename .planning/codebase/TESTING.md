# Testing Patterns

**Analysis Date:** 2026-06-18

## Test Framework

**Runner:**
- Vitest `^4.1.8` — both frontend (`package.json`) and backend (`server/package.json`)
- Backend config: `server/vitest.config.ts`
- Frontend config: none (Vitest picks up defaults; `vitest run` from root)

**Assertion Library:**
- Vitest built-in (`expect`, `describe`, `it`, `vi`)

**Coverage:**
- `@vitest/coverage-v8 ^4.1.8` installed in `server/devDependencies`
- No coverage threshold enforced

**Run Commands:**
```bash
# Frontend (from repo root)
npm test                          # vitest run (one-shot)

# Backend (from server/)
npm test                          # vitest run (one-shot)
npm run test:watch                # vitest (watch mode)

# Coverage (backend)
npx vitest run --coverage         # from server/
```

## Test File Counts

**17 test files total, ~310 test cases.**

| Package | Files | Approx cases |
|---------|-------|--------------|
| Backend (`server/`) | 11 | ~197 |
| Frontend (root `src/`) | 6 | ~113 |

### Backend test files

| File | Cases | What it covers |
|------|-------|----------------|
| `server/src/app.test.ts` | 11 | HTTP integration: auth, CSRF, ticket lifecycle |
| `server/src/lib/ticketQuery.test.ts` | 36 | Pure SQL-fragment builders: pagination, WHERE, ORDER BY |
| `server/src/lib/ticketImportExport.test.ts` | 36 | CSV escape/parse/validate helpers |
| `server/src/scripts/repair-kb-tables.test.ts` | 20 | KB table repair/detection logic |
| `server/src/lib/emailInbound.test.ts` | 22 | Email → ticket routing, dedup, threading |
| `server/src/lib/automationHelper.test.ts` | 18 | Auto-priority detection, word-boundary matching |
| `server/src/lib/htmlUtils.test.ts` | 17 | `stripHtml`, entity decoding |
| `server/src/lib/passwordPolicy.test.ts` | 14 | Password strength validation |
| `server/src/lib/slaHelper.test.ts` | 10 | SLA deadline updates, pause/resume |
| `server/src/lib/aiHelper.test.ts` | 6 | Anthropic SDK contract, `buildKbSearchQuery` |
| `server/src/routes/reports.test.ts` | 7 | Status-flow + tag-analytics SQL aggregation |

### Frontend test files

| File | Cases | What it covers |
|------|-------|--------------|
| `src/lib/validations.test.ts` | 71 | Zod schemas (tickets, contacts, companies, etc.) |
| `src/lib/contentMigration.test.ts` | 17 | Markdown detection, `markdownToHtml`, GFM table fixes |
| `src/lib/secureFileAccess.test.ts` | 11 | Browser-global mocking, file download flow |
| `src/lib/date.test.ts` | 5 | `parseServerDate` — UTC/timezone handling |
| `src/lib/duration.test.ts` | 5 | `formatDuration`/`parseDuration` |
| `src/lib/html.test.ts` | 4 | HTML utility helpers |

## Test File Organization

**Pattern:** Co-located with source file in the same directory.
- `server/src/lib/slaHelper.ts` → `server/src/lib/slaHelper.test.ts`
- `src/lib/validations.ts` → `src/lib/validations.test.ts`

**Backend config (`server/vitest.config.ts`):**
```typescript
import { defineConfig, configDefaults } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
```
`globals: true` — `describe`/`it`/`expect`/`vi` available without import (though most files import explicitly anyway).

**Frontend:** No `vitest.config.ts` at root. Tests run with default Vitest settings (node environment). Browser globals are stubbed manually in tests that need them (see `secureFileAccess.test.ts`).

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('functionName', () => {
  it('does X when Y', () => {
    expect(fn(input)).toBe(expected);
  });

  it('returns null for empty/nullish input', () => {
    expect(fn(null)).toBeNull();
    expect(fn(undefined)).toBeNull();
  });
});
```

**Setup/Teardown:**
```typescript
let memDb: InstanceType<typeof Database>;

beforeEach(() => {
  memDb = new Database(':memory:');
  createSchema(memDb);   // DDL helper defined in test file
});

afterEach(() => {
  memDb.close();
});
```

## Mocking

**Framework:** Vitest's `vi.mock()` and `vi.fn()`

### DB connection mocking (backend — primary pattern)

Used in all backend tests that involve a module importing `db` from `connection.ts`. A proxy object is created before import — tests set `memDb` in `beforeEach`.

```typescript
import Database from 'better-sqlite3';
let memDb: InstanceType<typeof Database>;

// vi.mock is hoisted above imports
vi.mock('../db/connection.js', () => {
  const proxy = {
    prepare: (...args: Parameters<InstanceType<typeof Database>['prepare']>) =>
      memDb.prepare(...args),
    pragma: vi.fn(),
    exec: vi.fn(),
  };
  return { db: proxy };
});

beforeEach(() => {
  memDb = new Database(':memory:');
  createSchema(memDb);  // minimal DDL covering only tested columns
});
afterEach(() => { memDb.close(); });
```

### Logger mocking (backend — always applied)

```typescript
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// or with relative path from routes/
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
```

### SDK/external service mocking

```typescript
// Set env BEFORE imports — vi.hoisted() runs before any module import
const { createMock } = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  return { createMock: vi.fn() };
});

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = { create: createMock };
    constructor(_opts: { apiKey?: string }) {}
  }
  return { default: FakeAnthropic };
});
```

### Browser globals mocking (frontend)

Used in `src/lib/secureFileAccess.test.ts` for browser-only APIs:

```typescript
beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  URL.createObjectURL = vi.fn(() => `blob:mock-${++urlCounter}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});
```

### `vi.hoisted()` for env setup (critical ordering)

When the module under test reads `process.env` at import time, env vars must be set before the import is evaluated. `vi.hoisted()` runs before all static imports:

```typescript
// app.test.ts — DB path must be set before connection.ts is imported
const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.CSRF_SECRET = 'test-csrf-secret-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET  = 'test-jwt-secret-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});
import { createApp } from './app.js';  // imports db/connection.ts — env already set
```

**What to mock:**
- `db` (connection.ts) — always, to avoid touching real/prod SQLite file
- `logger` — always in backend tests, to suppress JSON output noise
- External SDKs (`@anthropic-ai/sdk`, IMAP, SMTP, etc.) — always
- Browser globals (`localStorage`, `URL.createObjectURL`) — when testing frontend browser-API code

**What NOT to mock:**
- Pure functions with no side-effects (test them directly)
- `better-sqlite3` itself — real in-memory DB (`:memory:`) is used instead of mocking the ORM

## Fixtures and Test Data

**Pattern:** Inline helper functions defined in each test file. No shared fixture files.

```typescript
function insertTicket(
  db: InstanceType<typeof Database>,
  id: string,
  opts: { sla_response_deadline?: string | null; ... } = {}
) {
  db.prepare(`INSERT INTO tickets (...) VALUES (?, ?, ?, ...)`).run(id, ...);
}

function createSchema(db: InstanceType<typeof Database>) {
  db.exec(`CREATE TABLE IF NOT EXISTS tickets ( ... )`);
}
```

**Location:** Defined above the `describe` blocks within each `.test.ts` file.

## HTTP Integration Tests (`server/src/app.test.ts`)

Uses `supertest` against the real Express app (`createApp()`). Bootstraps a fresh SQLite file per test run via `vi.hoisted()` + `initializeDatabase()`, then seeds an admin user directly with `bcrypt`. Cleans up temp DB files in `afterAll`.

```typescript
import request from 'supertest';
import { createApp } from './app.js';

let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  initializeDatabase();
  // seed admin user directly via db.prepare().run(...)
  app = createApp();
});

afterAll(() => {
  closeDatabase();
  // rmSync temp DB + WAL/SHM sidecar files
});

it('POST /api/auth/login returns 200 with valid credentials', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(res.status).toBe(200);
});
```

## Private Function Testing via `__test__` Export

When internal functions need testing but should not be part of the public module API, they are exposed through a named `__test__` export:

```typescript
// server/src/lib/emailInbound.ts (at bottom of file)
export const __test__ = {
  findTicketByMessageId,
  findTicketByShortId,
  findTicketBySubject,
  resolveOrCreateContact,
  addCommentToTicket,
  stripReplyPrefix,
  processEmail,
};
```

```typescript
// server/src/lib/emailInbound.test.ts
import { __test__ } from './emailInbound.js';
const { findTicketByMessageId, processEmail } = __test__;
```

## Test Coverage

**Requirements:** None enforced (no threshold configured).

**`@vitest/coverage-v8`** is installed as a backend devDependency. To generate:
```bash
cd server && npx vitest run --coverage
```

**Coverage gaps:** Routes (`server/src/routes/`) are largely uncovered except `reports.ts`. Frontend components and hooks have no tests.

---

*Testing analysis: 2026-06-18*
