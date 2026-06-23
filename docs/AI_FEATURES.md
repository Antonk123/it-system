# IT-Ticket — AI Features

Dokumentation av IT-Tickets AI-funktioner: vilka de är, modellval, token-budget,
circuit breaker, rate limiting och hur du följer kostnad. Allt nedan är verifierat
mot `server/src/lib/aiHelper.ts` och migrationen som skapar `ai_usage_log`
(`server/src/db/migrations.ts`).

> **Grundprincip:** Alla AI-funktioner returnerar `null` vid fel, otillgänglighet,
> överskriden budget eller öppen circuit breaker. Kärnflödet (ärendeskapande,
> svar, etc.) blockeras **aldrig** av AI.

---

## 1. Aktivering

AI styrs av `ANTHROPIC_API_KEY`. Klienten lazy-initieras: om nyckeln saknas är
`aiEnabled()` `false` och samtliga funktioner är no-ops. Allt annat i systemet
fungerar normalt utan nyckel.

---

## 2. AI-funktioner

Fyra publika funktioner (i prioritetsordning enligt koden):

### a) Deflection — `suggestSolutionFromKB`
Flaggskeppsfunktionen. Föreslår en lösning ur kunskapsbasen i den **publika
portalen INNAN** ett ärende skapas. Medvetet **konservativ**: säger hellre "vet
inte" (`hasSolution: false`) än hittar på. Tvingar `hasSolution = false` om
`confidence < 0.4`. Tar emot förfiltrerade KB-artiklar (max 5 används), använder
**default-modellen**, `max_tokens: 600`. Loggas som feature `suggest`.

Relaterad hjälpfunktion `findRelevantKbArticles` låter AI plocka relevanta
artikel-id:n (default-modell, `max_tokens: 200`). Den loggas **inte** i
`ai_usage_log` och respekterar circuit breaker men inte budgetkollen.

### b) Kategorisering — `suggestCategory`
Klassificerar ett ärende i en befintlig kategori vid skapande. Default-modell,
`max_tokens: 100`. Validerar att föreslaget `categoryId` finns både i listan och
fortfarande i DB (skyddar mot race om kategori raderas). Loggas som `categorize`.

### c) Utkast på svar — `draftReply`
Genererar ett svarsutkast till beställaren baserat på relevanta KB-artiklar (och
ev. bifogade filer, max 3000 tecken/bilaga som kontext). Använder **smart-modellen**
(`MODEL_SMART`), `max_tokens: 1024`. Loggas som `draft`.

### d) Sammanfattning — `summarizeTicket`
Sammanfattar ett ärende + tidslinje till `{status, blockers, lastAction}`. Använder
**smart-modellen**, `max_tokens: 400`. Antal kommentarer som skickas in begränsas
av `AI_MAX_SUMMARY_COMMENTS` (default `30`, tar de senaste). Loggas som `summary`.

**Prompt-injection-skydd:** all användar-/KB-text körs genom `sanitizeForPrompt()`
(strippar system/instruktionsliknande rader + kontrolltecken, trunkerar) innan den
bäddas in i prompter.

---

## 3. Modellval

Två env-vars styr modellvalet (resolveras **en gång vid uppstart**):

| Env | Default | Används av |
|-----|---------|------------|
| `AI_MODEL` | `claude-haiku-4-5-20251001` | deflection, kategorisering, artikelval (allt via `MODEL_DEFAULT`) |
| `AI_MODEL_SMART` | faller tillbaka till `AI_MODEL`-värdet | draft + summary (`MODEL_SMART`) |

- `AI_MODEL_SMART` är en **escape-hatch**: sätt t.ex. `claude-sonnet-4-6` för att
  uppgradera utkast + sammanfattningar till en starkare modell. Om den **inte**
  sätts blir `MODEL_SMART` = `MODEL_DEFAULT`, dvs. allt kör Haiku. Kategorisering
  använder alltid default-modellen oavsett.
- **Konstant default i koden:** `FALLBACK_MODEL_DEFAULT = 'claude-haiku-4-5-20251001'`.

### Fallback-beteende + räknare
`resolveModel()` validerar env-värdet mot en allowlist (`KNOWN_CLAUDE_MODELS`,
omfattar Haiku-/Sonnet-/Opus-familjerna). Om ett angivet `AI_MODEL`/`AI_MODEL_SMART`
**inte** matchar (t.ex. felstavning):
1. en varning loggas (`Okänt AI-modell-ID i <var> — faller tillbaka till default`),
2. default-värdet används i stället (skyddar mot runtime-400 från API:t),
3. räknaren `modelFallbackCount` ökas.

Räknaren exponeras via `getModelFallbackCount()` (avsedd för en framtida
status-endpoint). Den ökar bara vid uppstart eftersom modellerna resolveras en gång.

---

## 4. Token-budget / månadsbudget

| Env | Default |
|-----|---------|
| `AI_MONTHLY_TOKEN_LIMIT` | `5000000` (5 miljoner tokens) |

Implementerad i `isWithinBudget()`:
- Summerar `input_tokens + output_tokens` från `ai_usage_log` för innevarande
  kalendermånad (från den 1:a 00:00) och jämför mot gränsen.
- Resultatet **cachas i 5 minuter** (`BUDGET_CACHE_TTL`) för att inte slå mot DB
  vid varje anrop.
- När gränsen överskrids loggas `AI monthly token budget exceeded` och de tre
  budget-gatade funktionerna (`suggestSolutionFromKB`, `suggestCategory`,
  `draftReply`, `summarizeTicket`) returnerar `null`.
- **Fail-open:** om budgetkollen kastar (DB-fel) tillåts anropet (returnerar `true`).

> Obs: `findRelevantKbArticles` gör ingen budgetkoll (men respekterar circuit breaker).

---

## 5. Circuit breaker (graceful degradation)

Två relaterade mekanismer i `aiHelper.ts` som spårar konsekutiva fel:

### a) Outage-varning
`FAILURE_ALERT_THRESHOLD = 5`. Efter 5 konsekutiva fel loggas
`AI API: consecutive failures — check ANTHROPIC_API_KEY and service status`.
Vid återhämtning loggas `AI API: recovered after consecutive failures`.

### b) Circuit breaker
- **Tröskel:** `CIRCUIT_FAILURE_THRESHOLD = 5` konsekutiva fel → kretsen "öppnas".
- **Cooldown:** `CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000` (5 minuter).
- När kretsen är öppen returnerar **alla** AI-funktioner `null` direkt utan
  API-anrop (slutar slänga pengar/tid på en nere tjänst).
- Loggar: `AI circuit breaker: opened — pausing AI calls for cooldown`.
- **Återställning:** när cooldownen löpt ut släpps **en probe-förfrågan** igenom
  (`AI circuit breaker: cooldown elapsed, allowing probe request`). Lyckas något
  anrop nollställs räknaren och kretsen stängs (`AI circuit breaker: closed after
  successful call`); misslyckas probe öppnas kretsen igen.

Räknarna nollställs vid första lyckade anropet (i `logUsage`).

---

## 6. Rate limiting

`aiHelper.ts` har **ingen egen** request-rate-limiter — flödeskontrollen sker via:
- **Circuit breaker** (§5) som hård broms vid upprepade fel, och
- **Månadsbudget** (§4) som hård broms på total förbrukning.

HTTP-nivå-rate limiting (per IP/route) hanteras av Express-middleware
(`server/src/middleware/rateLimit.ts`) på de routes som exponerar AI, inte i
AI-hjälparen själv.

---

## 7. Kostnadsuppföljning — `ai_usage_log`

Varje AI-anrop loggas av `logUsage()`. Loggning får aldrig bryta huvudflödet
(fel loggas som `AI usage log failed (non-fatal)`).

### Schema (migration `037`, justerad i `039`)

```sql
CREATE TABLE ai_usage_log (
  id            TEXT PRIMARY KEY,
  feature       TEXT NOT NULL,           -- 'categorize' | 'draft' | 'summary' | 'suggest'
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  ticket_id     TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  ok            INTEGER NOT NULL DEFAULT 1,   -- 1 = lyckat anrop, 0 = fel
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
-- Index: idx_ai_usage_log_created (created_at DESC),
--        idx_ai_usage_log_feature (feature),
--        idx_ai_usage_log_ticket (ticket_id)
```

> CHECK-constrainten på `feature` togs bort i migration `039`
> (`fix_ai_usage_log_feature_check`); kolumnen är nu fri text men koden skriver
> bara de fyra värdena ovan. `suggest`-rader har alltid `ticket_id = NULL`
> (inget ärende finns än vid deflection).

Gammal logg städas dagligen 03:15 — rader äldre än 90 dagar tas bort
(`cleanupOldAiUsage`, schemalagd i `index.ts`).

### Exempelfrågor

```sql
-- Tokenförbrukning innevarande kalendermånad (samma som budgetkollen)
SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens
FROM ai_usage_log
WHERE created_at >= strftime('%Y-%m-01T00:00:00', 'now');

-- Per feature, senaste 30 dagar (motsvarar getUsageStats())
SELECT feature,
       COUNT(*)                AS total_calls,
       SUM(ok)                 AS ok_calls,
       SUM(input_tokens)       AS total_input_tokens,
       SUM(output_tokens)      AS total_output_tokens,
       ROUND(AVG(duration_ms)) AS avg_duration_ms
FROM ai_usage_log
WHERE created_at >= datetime('now', '-30 days')
GROUP BY feature;

-- Vilka modeller har använts, och hur mycket?
SELECT model, COUNT(*) AS calls, SUM(input_tokens + output_tokens) AS tokens
FROM ai_usage_log
GROUP BY model
ORDER BY tokens DESC;

-- Felandel senaste dygnet (circuit-breaker-symptom)
SELECT feature,
       SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
       COUNT(*)                                AS total
FROM ai_usage_log
WHERE created_at >= datetime('now', '-1 day')
GROUP BY feature;
```

Kodhjälpare: `getUsageStats(days = 30)` returnerar per-feature-statistiken
programmatiskt (avsedd för en admin-endpoint `GET /api/ai/usage-stats`).

---

## 8. Env-sammanfattning

| Env | Default | Effekt |
|-----|---------|--------|
| `ANTHROPIC_API_KEY` | — | Tom = AI helt avstängt (no-op) |
| `AI_MODEL` | `claude-haiku-4-5-20251001` | Default-modell (deflection, kategorisering, artikelval) |
| `AI_MODEL_SMART` | = `AI_MODEL` | Smart-modell (draft + summary); escape-hatch till t.ex. `claude-sonnet-4-6` |
| `AI_MAX_SUMMARY_COMMENTS` | `30` | Max kommentarer in i sammanfattning |
| `AI_MONTHLY_TOKEN_LIMIT` | `5000000` | Månadsbudget i tokens; överskridet → funktioner returnerar `null` |

Hårdkodade tröskelvärden (ej env-styrda): `CIRCUIT_FAILURE_THRESHOLD = 5`,
`CIRCUIT_COOLDOWN_MS = 5 min`, `FAILURE_ALERT_THRESHOLD = 5`,
`BUDGET_CACHE_TTL = 5 min`, AI-usage-retention = 90 dagar.
