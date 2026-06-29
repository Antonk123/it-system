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
      // VERKSTÄLLS I CI: lint-server-jobbet kör `npm test -- --coverage`, så ett
      // tapp under trösklarna fäller bygget (inte bara lokalt).
      // audit-v3: täckning höjd ~33 %→~42 % → ratchet 27/18/28/27 → 38/33/38/38.
      // 2026-06-29: faktisk nivå 44.0/40.5/45.0/44.6 → ratchet höjd till
      // 42/38/42/42 (~2 p marginal) för att låsa vinsterna.
      thresholds: {
        statements: 42,
        branches: 38,
        functions: 42,
        lines: 42,
      },
    },
  },
});
