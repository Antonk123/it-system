import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Kör bara testkällan i src/. Annars plockar vitest även upp tsc-kompilerade
    // kopior i dist/ (build-skriptet kör `tsc` över hela src/), vilket dubbelkör
    // varje test mot STALE kod och kan dölja regressioner.
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/db/migrations.ts'],
      // Regressionsspärr (ratchet): satta strax UNDER nuvarande täckning så de
      // fångar tapp utan att fälla bygget idag. Höj i takt med fler tester.
      // Kör med `npm test -- --coverage`.
      // audit-v3: täckning höjd ~33 %→~42 % (auth/tickets/apiKeys/webhooks/users/
      // recurring/attachments route-tester) → ratchet höjd från 27/18/28/27.
      thresholds: {
        statements: 38,
        branches: 33,
        functions: 38,
        lines: 38,
      },
    },
  },
});
