# Stabilisering av build, lint, test och CI

Detta dokument beskriver den första omgången tekniska förbättringar som genomförts för att göra projektet mer stabilt, enklare att underhålla och bättre förberett för fortsatt utveckling.

| Område | Förändring | Syfte |
|---|---|---|
| Beroenden | Uppdatering av frontendens verktygskedja kring Vite, Vitest och PWA-plugin | Att lösa tidigare beroendekonflikter och göra installation möjlig |
| Kvalitetssäkring | Justering av ESLint-konfigurationen | Att få igång en fungerande lint-kedja för projektet |
| Tester | Ny testfil för `src/lib/duration.ts` | Att etablera en första automatisk testnivå |
| CI | Ny workflow i `.github/workflows/ci.yml` | Att automatisera kontroll av lint, test och build |
| Utvecklingsmiljö | Ny `.nvmrc` | Att göra Node-versionen konsekvent lokalt och i CI |
| Kodstabilisering | Mindre korrigeringar i utvalda komponenter | Att eliminera blockerande lintfel utan att ändra affärslogik |
| Docker och containerbuild | Uppdaterade `Dockerfile.client` och `Dockerfile.server` till Node 20, `npm ci` och produktionsanpassad start | Att göra containerbyggena konsekventa med projektets nya npm- och buildkedja |

## Verifiering

De genomförda ändringarna verifierades lokalt med följande resultat.

| Kontroll | Resultat |
|---|---|
| Frontend: `npm install` | Godkänd |
| Frontend: `npm run lint` | Godkänd, med kvarvarande varningar |
| Frontend: `npm test` | Godkänd |
| Frontend: `npm run build` | Godkänd |
| Backend: `npm ci` | Godkänd |
| Backend: `npm run build` | Godkänd |
| Docker-image build | Kunde inte verifieras i sandboxen eftersom Docker inte finns installerat |

## Kvarvarande tekniska förbättringsområden

Projektet har efter denna insats en betydligt bättre grund, men flera områden bör prioriteras i nästa steg.

| Område | Rekommendation |
|---|---|
| Bundle-storlek | Inför code-splitting och lazy loading för att minska huvudbundle |
| Hook-varningar | Gå igenom beroendelistor i `useEffect` och `useCallback` |
| Testtäckning | Lägg till tester för backendlogik, auth och centrala användarflöden |
| Säkerhet i beroenden | Uppgradera sårbara paket efter en riktad genomgång |
| CI-mognad | Utöka pipelinen med backendtester och gärna formatteringskontroll |
| Containerverifiering | Kör `docker build` i en miljö där Docker finns installerat för att verifiera images end-to-end |
