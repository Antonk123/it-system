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
  },
});
