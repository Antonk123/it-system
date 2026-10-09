# E2E-rök (Playwright)

Täcker kritiska vägen: inloggning, skapa ärende, status, kommentar, bilaga, utloggning + publika formuläret.
Kör lokalt: `npm run test:e2e` (första gången: `npx playwright install chromium`).
Sviten startar sina egna servrar: backend på :3001 (throwaway SQLite i `e2e/tmp/`, seedad admin) och Vite på :5173.
Är portarna redan upptagna återanvänds de (utom i CI) — stoppa `npm run dev` först om du vill ha en ren databas.
Felsök: `npx playwright show-report` eller `npx playwright test --ui`.
