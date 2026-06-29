# Codemap — portabel guide (återanvänd i valfritt projekt)

Det här dokumentet är fristående. Ta med det till ett annat projekt och följ det själv,
eller klistra in "Prompt till Claude" längst ner i en ny session så sätter Claude upp
samma sak åt dig.

Du får en **självständig `codemap.html`** — en lagrad processkarta (Frontend → Hooks →
API → Routes → Services → DB) med klickbar impact-highlight (klicka en del → se vad den
påverkar och vad som påverkar den), hopfällbara domängrupper, `fil:rad`-referenser och
dödkods-flagga. Inga externa beroenden — öppnas direkt i en webbläsare.

---

## Grundidén: två halvor

Verktyget är medvetet uppdelat så att bara hälften behöver anpassas per projekt.

**Generisk halva — återanvänds oförändrad:**
`src/types.ts` (graf-schemat), `src/merge.ts`, `src/graph/traverse.ts`, `src/build.ts`,
`template/*` (HTML/CSS/JS-rendern), `vendor/*` (Cytoscape). Dessa bryr sig inte om
projektet — de tar en graf och ritar den.

**Projektspecifik halva — det enda du rör:**
`src/config.ts` (globs), `src/extract/*` (parsar koden), `src/domain.ts` (domängruppering).
Dessa kodar *konventionerna* i ett specifikt projekt.

**Kontraktet mellan halvorna** är en JSON-graf. Producerar du en giltig sådan — på vilket
sätt som helst — fungerar resten oförändrat:

```jsonc
{
  "nodes": [
    { "id": "page:TicketList", "label": "TicketList", "layer": "frontend-page",
      "loc": "src/pages/TicketList.tsx", "domain": "tickets",
      "feature": "Ärenden", "description": "valfri text" }
  ],
  "edges": [
    { "source": "page:TicketList", "target": "hook:useTickets", "kind": "calls" }
  ]
}
```

Giltiga `layer`: `frontend-page`, `frontend-hook`, `api-client`, `api-route`, `service`,
`scheduler`, `db-table`, `ai`, `deploy`. Giltiga `kind`: `imports`, `calls`, `uses`,
`reads`, `writes`, `creates`, `triggers`, `business`. Varje `edge` måste peka på noder som
finns (merge validerar detta och kastar fel annars).

---

## Tre scenarier

### 1. Samma stack/mönster (React + Express + SQLite likt detta projekt)

Minst jobb. Kopiera hela `tools/codemap`-mappen till det andra repot, sedan:

```bash
cd tools/codemap
npm install
CODEMAP_REPO=/sökväg/till/projektet npm run generate
open dist/codemap.html
```

Justera vid behov:
- `src/config.ts` → `GLOBS` om mapparna heter annat (t.ex. `client/src/pages`).
- `src/domain.ts` → domän-orden så grupperna matchar projektets affärsspråk.

### 2. Liknande men andra konventioner (Next.js, Prisma, Postgres, NestJS …)

Behåll den generiska halvan. Skriv om de filer i `src/extract/` som inte stämmer. Det
extraktorn letar efter idag, och vad du byter mot:

| Fil | Letar efter idag | Byt mot din motsvarighet |
|-----|------------------|--------------------------|
| `routes.ts` | `app.use('/api/x', xRoutes)` + `router.get('/..')` + `db.prepare('SQL')` | din route-registrering, endpoint-deklaration, dataåtkomst |
| `apiClient.ts` | metoder i `src/lib/api.ts` med URL-fragment | din frontend-API-klient / generated client |
| `frontend.ts` | `api.x()`-anrop i hooks, `use*`-imports i sidor | dina data-hooks / server-actions / loaders |
| `services.ts` | `server/src/lib/*.ts` + SQL-literaler | dina service-/domänmoduler |
| `database.ts` | `migrations.ts`-array med `CREATE/ALTER TABLE` | Prisma-schema, SQL-migrationer, ORM-modeller |

`src/extract/index.ts` knyter ihop dem — uppdatera nod-id:n/lager där.

### 3. Helt annan stack (Python/Django, Go, Rust …)

Strunta i extraktorerna. Skriv vad som helst (valfritt språk) som skriver ut en giltig
`graph.json` enligt schemat ovan, lägg den i `tools/codemap/graph.json` och kör:

```bash
npm run merge && npm run build   # hoppar över extract-steget
```

Rendern, impact-traverseringen och domängrupperna fungerar oförändrat.

---

## Anpassnings-checklista

- [ ] `src/config.ts`: `GLOBS` pekar på rätt mappar; `LAYER_ORDER` om du lägger till lager.
- [ ] `src/extract/*`: mönstren matchar hur projektet deklarerar routes, API-anrop, dataåtkomst.
- [ ] `src/domain.ts`: domän-nyckelord speglar projektets domäner (ordning = prioritet).
- [ ] `curated/overlay.yaml`: lägg på affärsbeskrivningar (matchas mot nod-id; fel id → fel med flit).
- [ ] `npm test` grönt (integrationstestet i `tests/extract-integration.test.ts` förväntar
      vissa nod-id:n från *detta* projekt — uppdatera dem till det nya projektets).
- [ ] `npm run generate` och öppna `dist/codemap.html`.

---

## Prompt till Claude (klistra in i en ny session i det andra projektet)

> Jag har ett verktyg som heter "codemap" (ligger i `tools/codemap/` i ett annat repo, se
> bifogad PORTING.md). Det genererar en självständig interaktiv `codemap.html` som visar ett
> projekts arkitektur som en lagrad processkarta (Frontend → Hooks → API → Routes → Services
> → DB) med klickbar impact-highlight, hopfällbara domängrupper, fil:rad och dödkods-flagga.
>
> Sätt upp samma sak för *det här* projektet:
> 1. Kartlägg först stacken och konventionerna i detta repo (hur deklareras routes, hur sker
>    API-anrop från frontend, hur sker dataåtkomst, hur ser migrationer/schema ut).
> 2. Återanvänd den generiska halvan oförändrad (`types.ts`, `merge.ts`, `graph/traverse.ts`,
>    `build.ts`, `template/*`, `vendor/*`).
> 3. Anpassa bara den projektspecifika halvan (`config.ts`, `src/extract/*`, `domain.ts`) till
>    konventionerna du hittade. Kontraktet är graf-JSON:en `{ nodes, edges }` enligt schemat.
> 4. Skriv tester (parsers + ett integrationstest mot detta repo), kör allt grönt, generera och
>    verifiera `dist/codemap.html` i en webbläsare.
>
> Bygg och testa i en isolerad miljö först, lägg allt under `tools/codemap/`, rör ingen
> befintlig kod, och föreslå en commit när det är verifierat.

---

## Snabbreferens — kommandon

```bash
npm install                                   # engångs
npm run generate                              # extract -> merge -> build
CODEMAP_REPO=/annan/sökväg npm run generate   # peka mot annat repo
npm test                                      # hela testsviten
npm run merge && npm run build                # om du har egen graph.json (hoppa extract)
```
