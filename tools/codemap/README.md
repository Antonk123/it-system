# Codemap — interaktiv kodkarta för IT-System

Genererar en **självständig** `dist/codemap.html` som visar projektets arkitektur som en
lagrad processkarta (Frontend-sidor → Hooks → API-klient → Routes → Services → DB-tabeller)
med klickbar **impact-highlight**: klicka en nod och se vad den påverkar (nedströms, rött)
och vad som påverkar den (uppströms, grönt). Filen öppnas direkt i en webbläsare — inga
externa beroenden, inget bygge krävs för att titta.

## Titta på kartan

Öppna `tools/codemap/dist/codemap.html` i en webbläsare. Funktioner:

- **Klick på nod** → markerar hela påverkanskedjan + sidopanel med fil:rad och kopplingar.
- **Båda / Påverkar → / ← Påverkas av** — välj riktning för highlight.
- **⚠ Visa dödkod** — noder utan inkommande kopplingar (möjlig oanvänd kod).
- **Sök** — filtrera/centrera på nodnamn.
- **Lager-rutorna** — dölj/visa en hel kolumn.

## Regenerera efter kodändring

```bash
cd tools/codemap
npm install
npm run generate        # extract -> merge -> build
```

`npm run generate` läser repot, slår ihop med det kurerade lagret och skriver om
`dist/codemap.html`. Peka mot annat repo: `CODEMAP_REPO=/sökväg npm run generate`.

## Datakälla (hybrid)

- **Auto** (`src/extract/`): parsar riktig kod med `ts-morph` — sidor/components/contexts,
  hooks, `src/lib/api.ts`, `server/src/app.ts`-registrering, route-filer, services/schedulers,
  SQL-tabeller (via FROM/JOIN/INSERT/UPDATE/DELETE) och migrationer.
- **Kurerat** (`curated/overlay.yaml`): affärslogik, feature-grupperingar och beskrivningar
  som inte syns i koden. Matchas mot auto-noder via `id`. Refererar du ett `id` som inte
  finns kastar `merge` ett fel med flit — kör `npm run extract` och slå upp giltiga id:n i
  `graph.auto.json`.

## Tester

```bash
npm test
```

Enhetstester för parsers, merge, build och graf-traversering, plus ett integrationstest som
kör hela extraktorn mot det riktiga repot.

## Begränsningar

- Kopplingar härleds statiskt ur kod. Dynamiska anrop (strängbyggda SQL-tabellnamn,
  reflektion) kan missas.
- "Dödkod"-flaggan = *inga inkommande kopplingar i den fångade grafen*. Verifiera alltid
  manuellt innan du tar bort något — t.ex. kan en metod anropas från ett mönster parsern
  inte täcker.
