import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Layer } from './types.js';

/** Repo-rot: explicit arg > env CODEMAP_REPO > två nivåer upp från tools/codemap. */
export function resolveRepoRoot(explicit?: string, toolDir?: string): string {
  if (explicit) return explicit;
  if (process.env.CODEMAP_REPO) return process.env.CODEMAP_REPO;
  const base = toolDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return path.resolve(base, '..', '..');
}

/** Globs relativt repo-rot. */
export const GLOBS = {
  pages: 'src/pages/**/*.tsx',
  components: 'src/components/**/*.tsx',
  contexts: 'src/contexts/**/*.tsx',
  hooks: 'src/hooks/**/*.ts',
  apiClient: 'src/lib/api.ts',
  appRegistration: 'server/src/app.ts',
  services: 'server/src/lib/*.ts',
  migrations: 'server/src/db/migrations.ts',
} as const;

/** Vänster->höger-ordning för kolumner. Lägre = längre till vänster. */
export const LAYER_ORDER: Record<Layer, number> = {
  'frontend-page': 0,
  'frontend-hook': 1,
  'api-client': 2,
  'api-route': 3,
  service: 4,
  scheduler: 4,
  ai: 4,
  'db-table': 5,
  deploy: 6,
};
