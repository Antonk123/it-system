# Coding Conventions

**Analysis Date:** 2026-03-22

## Naming Patterns

**Files:**
- Components: PascalCase (e.g., `FileUpload.tsx`, `TicketTagSelector.tsx`)
- Pages: PascalCase (e.g., `Settings.tsx`, `Archive.tsx`, `Dashboard.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useCategories.ts`, `useTickets.ts`)
- Utilities: camelCase (e.g., `api.ts`, `validations.ts`, `utils.ts`)
- Types: separate files in `src/types/` with descriptive names (e.g., `ticket.ts`, `filterView.ts`)
- Contexts: PascalCase with `Context` suffix (e.g., `AuthContext.tsx`)
- UI primitives: PascalCase, co-located in `src/components/ui/` (e.g., `button.tsx`, `dialog.tsx`)

**Functions:**
- Component functions: PascalCase (e.g., `FileUpload`, `ProtectedRoute`, `AppearanceInitializer`)
- Hook functions: camelCase with `use` prefix (e.g., `useAuth`, `useCategories`, `addCategory`)
- Utility functions: camelCase (e.g., `formatFileSize`, `getFileIcon`, `stripHtml`)
- Query/mutation helper functions: camelCase with descriptive names (e.g., `getCategoryLabel`, `reorderCategories`)
- Private helper functions within ApiClient class: camelCase with `private` modifier (e.g., `getToken()`, `getCsrfToken()`)

**Variables:**
- React hooks state: camelCase with setter naming (e.g., `const [user, setUser] = useState()`)
- Constants: UPPER_SNAKE_CASE for module-level constants (e.g., `API_BASE_URL`, `MUTATING_METHODS`, `DEFAULT_NEW_TAG_COLOR`)
- Query client configuration: camelCase (e.g., `queryClient`, `staleTime`)
- Type/interface properties: camelCase (e.g., `isAuthenticated`, `createdAt`, `requesterId`)
- Record keys: single quoted for special enum values (e.g., `'open'`, `'in-progress'`)

**Types & Interfaces:**
- Types: PascalCase (e.g., `Ticket`, `User`, `Comment`, `TicketStatus`, `TicketPriority`)
- Type unions for status/priority: string literal unions in type declarations (e.g., `export type TicketStatus = 'open' | 'in-progress' | 'waiting' | 'resolved' | 'closed'`)
- Interfaces for objects: PascalCase with descriptive suffix (e.g., `AuthContextType`, `ApiOptions`, `PaginatedResponse<T>`, `Category`)
- Row/database types: suffix with `Row` for database representations (e.g., `CommentRow`, `TemplateRow`, `TicketLinkRow`)
- Hook return types: typically object shapes with descriptive property names (e.g., `{ isAuthenticated, isLoading, user, signIn, signOut }`)

## Code Style

**Formatting:**
- No Prettier configuration file in root — relies on ESLint defaults and IDE settings
- File structure: imports at top, then component/function definitions, then exports
- Imports are organized but not strictly segregated (internal and external mixed)
- Inline comments for complex logic (e.g., CSRF token handling, optimistic updates)

**Linting:**
- ESLint configured in `eslint.config.js` with Flat Config format
- Extends: `@eslint/js` recommended + TypeScript ESLint recommended
- Plugins: `react-hooks`, `react-refresh`
- Key rule overrides:
  - `@typescript-eslint/no-unused-vars`: "off" (disabled to allow flexibility)
  - `react-refresh/only-export-components`: "warn" with `allowConstantExport: true`
- TypeScript compiler options:
  - `noImplicitAny`: false (allows implicit `any` types)
  - `noUnusedParameters`: false
  - `noUnusedLocals`: false
  - `strictNullChecks`: false (lenient null handling)
  - `skipLibCheck`: true (skip type checking of dependencies)

## Import Organization

**Order:**
1. External React/library imports (e.g., `react`, `@tanstack/react-query`, `react-router-dom`)
2. UI component imports from `@radix-ui/` and custom UI components
3. Icons (from `lucide-react`)
4. Custom hooks and utilities (using `@/` alias)
5. Types and interfaces (from `@/types/`)
6. Local component imports

**Path Aliases:**
- `@/` points to `./src/` (configured in `tsconfig.json`)
- Used consistently across all imports for cleaner relative path references
- Example: `import { api } from '@/lib/api'` instead of relative paths

**Example import block:**
```typescript
import { useState, useCallback, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Tag as TagIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useCategories } from '@/hooks/useCategories';
import { Category } from '@/types/ticket';
```

## Error Handling

**Patterns:**
- API errors: thrown as `Error` objects with descriptive messages
- Error messages extracted from response JSON: `error.error || error.message || 'Default message'`
- Validation errors: caught and re-thrown with context using Zod's `safeParse()` and `getValidationError()`
- Try-catch in async functions with error logging in DEV mode: `if (import.meta.env.DEV) console.error()`
- Toast notifications for user-facing errors: `toast.error('Failed to create category')`
- CSRF errors: special handling in ApiClient with automatic retry (clear stale token, fetch new one, retry)
- Graceful fallbacks: return `null` or empty defaults on error (e.g., `return { error: error instanceof Error ? error.message : 'Login failed' }`)

**Example:**
```typescript
catch (error) {
  if (import.meta.env.DEV) console.error('Error deleting category:', error);
  toast.error('Failed to create category');
  return null;
}
```

## Logging

**Framework:** `console` (standard browser console)

**Patterns:**
- Errors logged only in DEV mode: `if (import.meta.env.DEV) console.error(...)`
- Async operation debugging uses `console.error()` for exception tracking
- No persistent logging framework (Sentry, etc.)
- Toast notifications used for user-facing messaging instead of console logs

## Comments

**When to Comment:**
- Complex authentication/CSRF token handling with detailed explanations
- Fallback strategies and edge case handling
- Intent of optimistic updates in React Query mutations
- API response handling nuances (e.g., 204 no-content, content-type checking)
- Lazy loading and caching strategies

**JSDoc/TSDoc:**
- Used sparingly
- Type interfaces documented with inline comments for complex fields
- Analytics interface example shows field meaning in comments:
```typescript
/**
 * Lazily fetch and cache the CSRF token. The token is bound to the current
 * auth session via the Authorization header (see backend getSessionIdentifier).
 */
private async getCsrfToken(): Promise<string>
```

## Function Design

**Size:**
- Short focused functions (under 40 lines common)
- Component callbacks extracted as named functions for clarity
- Hook logic kept to React patterns (useCallback, useMutation, useQuery)

**Parameters:**
- Props interfaces defined inline for smaller components, exported for reusables
- Destructured in function signatures: `({ attachments, pendingFiles, onFilesSelect }: FileUploadProps)`
- Options objects for flexible method signatures: `async request<T>(endpoint: string, options: ApiOptions = {})`

**Return Values:**
- Hooks typically return object destructuring: `{ categories, isLoading, addCategory, ... }`
- Async functions return typed Promises: `async uploadFile<T>(endpoint: string, file: File): Promise<T>`
- Callbacks return early on validation failure: `return { error: 'message' }` or `return null`
- Components return JSX or null for conditional rendering

## Module Design

**Exports:**
- Named exports for utilities, types, hooks, and constants
- Default export for React components/pages
- API client exported as singleton instance: `export const api = new ApiClient(API_BASE_URL)`

**Barrel Files:**
- Not used extensively; imports are explicit from specific files
- UI components are not re-exported from a central barrel

**API Client Pattern:**
- Class-based wrapper around native `fetch()` API
- Instance methods for domain operations: `getTickets()`, `createTicket()`, etc.
- Private methods for shared concerns: `getToken()`, `getCsrfToken()`, `request<T>()`
- Encapsulates auth token lifecycle and CSRF protection

**Example API client method structure:**
```typescript
async importTicketsPreview(file: File) {
  const token = this.getToken();
  const formData = new FormData();
  // Build request
  const response = await fetch(...);
  // Handle response
}
```

**Hook Pattern with React Query:**
- Query keys centralized at top of hook file: `export const categoryKeys = { all: [...], lists: () => [...], ... }`
- Mutations wrapped with success/error callbacks for cache updates (optimistic updates)
- Callback helpers extracted using `useCallback()` for dependency safety
- Separation of concerns: query keys, queries, mutations, then callback helpers

---

*Convention analysis: 2026-03-22*
