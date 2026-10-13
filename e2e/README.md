# E2E-rök (Playwright)

Täcker kritiska vägen: inloggning, skapa ärende, status, kommentar, bilaga, utloggning + publika formuläret.
Kör lokalt: `npm run test:e2e` (första gången: `npx playwright install chromium`).
Sviten startar sina egna servrar: backend på :3001 (throwaway SQLite i `e2e/tmp/`, seedad admin) och Vite på :5173.
Är portarna redan upptagna återanvänds de (utom i CI) — stoppa `npm run dev` först om du vill ha en ren databas.
Felsök: `npx playwright show-report` eller `npx playwright test --ui`.

`ticket-images.spec.ts` använder den riktiga textredigeraren och sex mallar från
det publika formuläret. Den kontrollerar bildval, inklistring, drag-and-drop,
utkast, fel och återförsök, vanliga användare, admin och återkallade delningslänkar.
Behörighetsmallen testas även med återanvända kontaktuppgifter och annan mottagare.
Sviten ingår i det vanliga E2E-steget i CI. Kör med installerad Microsoft Edge:
`E2E_EDGE=1 npm run test:e2e`.

Navet-testet återskapar iframe-sandboxen och temaprotokollet lokalt, inklusive
mallbyte och smal skärm. Det ersätter inte en kontroll i riktiga Navet efter
driftsättning. Lokal E2E skickar inte e-post; verklig leverans måste verifieras
separat i godkänd miljö.
