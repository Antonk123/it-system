# Testing Patterns

**Analysis Date:** 2026-03-22

## Test Framework

**Runner:**
- Not detected - no test runner configured (`jest`, `vitest`, `mocha`, etc.)

**Assertion Library:**
- Not detected - no testing library dependencies in `package.json`

**Run Commands:**
- No test scripts in `package.json`
- Available commands: `dev` (Vite dev server), `build`, `build:dev`, `lint`, `preview`

## Test File Organization

**Location:**
- No test files present in the main codebase
- Dependencies (e.g., Zod, other packages) have test files in `node_modules/`
- Example: `/node_modules/zod/src/v4/core/tests/` and `/node_modules/zod/src/v4/mini/tests/`

**Naming:**
- Not applicable — no test structure in place

**Structure:**
- Not applicable — no test structure in place

## Test Structure

**Suite Organization:**
- Not documented — no existing tests

**Patterns:**
- Not documented — no existing tests

## Mocking

**Framework:**
- Not detected — no mocking library dependencies (Jest, Vitest, Sinon, etc.)

**Patterns:**
- Not documented — no existing mocks

**What to Mock:**
- Not established — no testing patterns to define mock strategy

**What NOT to Mock:**
- Not established — no testing patterns to define mock strategy

## Fixtures and Factories

**Test Data:**
- Not detected — no test fixtures or factories in use

**Location:**
- Not applicable — no test infrastructure

## Coverage

**Requirements:**
- Not enforced — no coverage reporting configured

**View Coverage:**
- Not applicable — no coverage tooling installed

## Test Types

**Unit Tests:**
- Not present
- **Candidate areas for testing:**
  - Utility functions: `cn()` in `src/lib/utils.ts`
  - Validation schemas: `src/lib/validations.ts` (Zod schemas for tickets, categories, contacts, etc.)
  - Query key factories: `src/hooks/useCategories.ts` (categoryKeys structure)
  - Helper functions: `formatFileSize()`, `getFileIcon()` in `src/components/FileUpload.tsx`
  - Type mappers: database row -> domain type conversions in hooks

**Integration Tests:**
- Not present
- **Candidate areas for testing:**
  - API client: `src/lib/api.ts` (fetch mocking, CSRF handling, auth token management)
  - Hook interactions: `useCategories` with API calls and React Query
  - Component integration: Form components with validation and mutations
  - Auth flow: `AuthContext` with login/logout/token refresh

**E2E Tests:**
- Not present
- **Candidate areas for testing:**
  - User login flow
  - Ticket creation/editing workflow
  - Knowledge base article management
  - Template management and usage

## Common Patterns

**Async Testing:**
- Not documented — no async test patterns established

**Error Testing:**
- Not documented — no error testing patterns established

## Recommendations for Test Implementation

**Start with:**
1. Validation schemas (`src/lib/validations.ts`) - These are pure functions that benefit greatly from unit tests
2. Utility functions (`src/lib/utils.ts`) - Low complexity, high ROI for test coverage
3. API client (`src/lib/api.ts`) - Critical for application reliability, requires comprehensive testing

**Testing Tools to Consider:**
- **Test Runner:** Vitest (already compatible with Vite setup, modern, fast)
- **Assertion:** Vitest built-in or add `@vitest/expect`
- **Mocking:** `vi` from Vitest or add `msw` (Mock Service Worker) for API mocking
- **Setup:** Add `vitest.config.ts` with appropriate configuration for React components

**Example Vitest Setup:**
```bash
npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/jest-dom happy-dom
```

**Validation Test Example Structure:**
```typescript
import { describe, it, expect } from 'vitest';
import { ticketInsertSchema, contactSchema } from '@/lib/validations';

describe('Validation Schemas', () => {
  describe('ticketInsertSchema', () => {
    it('should validate a complete ticket', () => {
      const valid = {
        title: 'Test ticket',
        description: 'Test description',
        status: 'open',
        priority: 'medium',
      };
      expect(ticketInsertSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const invalid = { title: 'Only title' };
      expect(ticketInsertSchema.safeParse(invalid).success).toBe(false);
    });
  });
});
```

**API Client Test Example Structure:**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiClient } from '@/lib/api';

describe('ApiClient', () => {
  let apiClient: ApiClient;

  beforeEach(() => {
    apiClient = new ApiClient('/api');
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  it('should set and retrieve auth tokens', () => {
    apiClient.setToken('test-token');
    expect(localStorage.setItem).toHaveBeenCalledWith('auth_token', 'test-token');
  });

  it('should handle CSRF token refresh on 403 error', async () => {
    // Mock fetch with CSRF error response
    // Verify token is cleared and request retried
  });
});
```

**Hook Test Example Structure:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCategories } from '@/hooks/useCategories';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

describe('useCategories', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it('should fetch categories on mount', async () => {
    const { result } = renderHook(() => useCategories(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
});
```

## Current Testing State

- **Status:** No testing framework configured
- **Test Files:** 0 (zero test files in source code)
- **Coverage:** Unmeasured
- **Risk:** Application lacks automated testing safety net, making refactoring and feature development riskier

---

*Testing analysis: 2026-03-22*
