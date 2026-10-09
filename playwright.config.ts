import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { E2E_ADMIN } from './e2e/constants';

// Rökiga E2E-tester mot den riktiga dev-stacken (Vite :5173 + Express :3001).
// Allt state (SQLite + uploads) hamnar i e2e/tmp (inte e2e/.tmp: Express sendFile nekar sökvägar med dot-segment → 404 på uppladdade filer) och nollställs vid varje start,
// så sviten rör aldrig någon riktig databas. Alla värden nedan är uppenbara
// test-värden — inga riktiga hemligheter.
const root = import.meta.dirname;
const tmp = path.join(root, 'e2e', 'tmp');

const backendEnv = {
  NODE_ENV: 'development',
  PORT: '3001',
  JWT_SECRET: 'e2e-only-jwt-secret-0123456789-abcdefghijklmnop',
  CSRF_SECRET: 'e2e-only-csrf-secret-0123456789-abcdefghijklmn',
  ADMIN_EMAIL: E2E_ADMIN.email,
  ADMIN_PASSWORD: E2E_ADMIN.password,
  ADMIN_NAME: 'E2E Admin',
  DB_PATH: path.join(tmp, 'database.sqlite'),
  UPLOAD_DIR: path.join(tmp, 'uploads'),
  COOKIE_SECURE: 'false',
  CORS_ORIGIN: 'http://localhost:5173',
  APP_BASE_URL: 'http://localhost:5173',
};

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // En delad databas och inloggningsspärrar per IP → kör seriellt.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'sv-SE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Nollställ state, seeda admin (init-db) och starta sedan servern utan watch-läge.
      command: `rm -rf "${tmp}" && mkdir -p "${tmp}/uploads" && npx tsx src/db/init.ts && npx tsx src/index.ts`,
      cwd: path.join(root, 'server'),
      url: 'http://localhost:3001/api/health',
      env: backendEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      cwd: root,
      url: 'http://localhost:5173',
      env: { API_TARGET: 'http://localhost:3001' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
