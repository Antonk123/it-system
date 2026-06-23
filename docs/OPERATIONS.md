# IT-Ticket — Operations Guide

Operativa rutiner för IT-Ticket-backenden: hälsokontroller, loggar, DB-underhåll,
backup/restore, webhook-retry, IMAP-felsökning, AI-tokenövervakning, graceful
shutdown och en kort incident-checklista.

> Närliggande dokument:
> - `docs/RUNBOOK.md` — drifthandbok för per-kund-installationer via `setup.sh`
>   (manuell volym-backup, uppgradering). Den här filen täcker de
>   **applikationsinterna** rutinerna (inbyggd scheduler, endpoints, env-styrning).
> - `docs/AI_FEATURES.md` — AI-funktioner, modellval, token-budget och
>   circuit breaker (refereras från avsnittet om AI-tokenövervakning nedan).
> - `docs/dev-db-isolation-runbook.md` — dev/prod-DB-isolation.

Alla env-varianter nedan är verifierade mot källkoden. Se `.env.example` för
fullständig lista och defaultvärden.

---

## 1. Hälsokontroller

**Endpoint:** `GET /api/health` (definierad i `server/src/app.ts`).

Kontrollen verifierar **både** att processen lever och att databasen svarar:
den kör `db.prepare('SELECT 1').get()` mot SQLite-handtaget.

| Utfall | HTTP-status | Body |
|--------|-------------|------|
| DB svarar | `200` | `{ "status": "ok", "timestamp": "<ISO>" }` |
| DB ej nåbar / fel | `503` | `{ "status": "error", "timestamp": "<ISO>" }` |

Vid 503 loggas `Health check failed — DB not reachable` på error-nivå. En
load-balancer eller orchestrator (Docker/Portainer healthcheck) ska sluta
dirigera trafik till instansen vid 503.

```bash
# Snabbkoll mot prod
curl -s https://ticket.prefabmastarna.se/api/health
# Mot dev
curl -s http://10.38.195.180:5174/api/health
```

CORS tillåter requests utan `Origin`-header (curl, container-healthchecks) —
detta är avsiktligt så att healthchecks inte blockeras.

---

## 2. Logghantering

Loggern (`server/src/lib/logger.ts`) skriver **strukturerad JSON** till stdout
(`console.log`/`console.warn`) och stderr (`console.error`). Det finns ingen
filrotation i appen — loggar fångas av Docker och roteras av Docker/Portainer.

Varje rad har formen:

```json
{"timestamp":"<ISO>","level":"info|warn|error|debug","message":"...","...meta":"..."}
```

Nivåer: `info`, `warn`, `error`, `debug` (debug skrivs via `console.log`, dvs.
ingen separat trösklig filtrering i appen — allt skrivs ut).

**Request-spårning:** varje request får ett `X-Request-ID` (inkommande header
återanvänds, annars genereras ett UUID — se `app.ts`). Använd det för att följa
en request genom loggarna.

```bash
# Följ backend-loggar (prod-container) live
ssh root@10.38.195.180 'docker logs -f --tail 200 <backend-container>'

# Filtrera bara fel
ssh root@10.38.195.180 'docker logs <backend-container> 2>&1 | grep "\"level\":\"error\""'
```

Notabla larm-loggrader att vakta på:
- `Unhandled promise rejection` (eskalerar till `CRITICAL` vid ≥50 ackumulerade —
  räknaren nollställs efter en ren period, se `index.ts`).
- `Uncaught exception` → processen avslutas med `process.exit(1)` (Docker
  `restart`-policy startar om).
- `CORS blocked request` → en origin saknas i `CORS_ORIGIN`.
- `AI circuit breaker: opened` / `AI API: consecutive failures` (se §7).

---

## 3. Databasunderhåll (SQLite)

Konfiguration sätts vid uppstart i `server/src/db/connection.ts`:

| PRAGMA | Värde | Syfte |
|--------|-------|-------|
| `foreign_keys` | `ON` | Referensintegritet |
| `journal_mode` | `WAL` | Samtidiga läsare + en skrivare |
| `busy_timeout` | `5000` (ms) | Väntar in en hållen skrivlås i stället för att kasta `SQLITE_BUSY` direkt — krävs eftersom 6 bakgrunds-schedulers + backup-jobbet alla kan skriva |
| `synchronous` | `NORMAL` | Snabbare skriv, säkert i WAL |
| `cache_size` | `-64000` (64 MB) | Prestanda |

DB-sökväg styrs av `DB_PATH` (default `data/database.sqlite` relativt builden;
i Docker `/app/data/database.sqlite`).

### Migrations

Migrations körs **automatiskt vid serverstart** via `runMigrations()` inuti
`initializeDatabase()` (anropas i `index.ts` före `app.listen`):

1. `schema.sql` exekveras (idempotent DDL).
2. Varje migration i arrayen i `server/src/db/migrations.ts` körs i en
   transaktion och stämplas i tabellen `schema_migrations`.
3. En migration som redan är applicerad hoppas över (idempotent).
4. Om en migration kastar → **startavbrott** (`throw`), inga fler migrations
   körs på ett halvt tillstånd.
5. `verifySchemaIntegrity()` kräver att kärntabellerna `users` och `tickets`
   finns efter migrations — annars vägrar servern starta.

> **VIKTIGT:** Nya migrations MÅSTE läggas in i arrayen i `migrations.ts`.
> Fristående `npx tsx`-script körs inte vid serverstart.

### WAL-filer

WAL/SHM-sidofiler (`database.sqlite-wal`, `-shm`) checkpointas rent vid graceful
shutdown (se §8) och hanteras explicit i backup/restore. Radera dem aldrig medan
servern kör.

---

## 4. Backup & Restore

Logik i `server/src/lib/backupScheduler.ts`; endpoints i
`server/src/routes/backup.ts` (alla **admin-only**).

### Automatisk backup (scheduler)

Startas via `startBackupScheduler()` i `index.ts`. Schema (på/av, tid, retention)
läses från DB-raden `backup_config` (migration 061) och redigeras i admin-UI:t —
**ingen omstart krävs** (PUT `/api/backup/config` kör `reconfigureBackupScheduler()`).

Default om raden saknas: aktiverad, `04:00`, retention 7 dagar.

Körningssteg i `runBackup()`:
1. In-flight-guard hindrar överlappande körningar (cron vs. manuell).
2. WAL-säker online-snapshot via `database.backup(tmpDbPath)`.
3. `PRAGMA integrity_check` — korrupt snapshot rullar **aldrig** in i retention.
4. Buntar `data/database.sqlite` + `data/uploads/` till `backup-<YYYY-MM-DD>.zip`.
5. Sätter `chmod 0o600` på ZIP:en (innehåller hela DB:n inkl. hemligheter).
6. Off-site-upload (se nedan).
7. Retention: behåller nyaste N `backup-*.zip`/`.sqlite`, raderar äldre.
8. Skriver status (`last_run_at`, `last_status`, `last_size_bytes`) till `backup_config`.

Backup-katalogen är `<DB_PATH-katalog>/backups` (skapas med `mode 0o700`).
Cron-tiden tolkas i containerns lokaltid (styrs av `TZ`; prod = Europe/Stockholm
kräver `tzdata` i imagen, annars UTC).

**Relevanta env-vars:**
- `DB_PATH` — bestämmer var `backups/` hamnar.
- `UPLOAD_DIR` — vilka filer som buntas in.
- `TZ` — tolkning av schemats klockslag.
- `OFFSITE_BACKUP_CMD` — shell-mall som körs efter nattlig backup (se nedan).
- `OFFSITE_BACKUP_REQUIRED` — om `true` blir misslyckad off-site-upload **fatal**
  (hela backupen markeras `failed`); annars loggas felet och backupen förblir lyckad.

### Manuell backup / nedladdning

- `GET /api/backup/` — laddar ner en färsk ZIP (rate limit: 10/15 min/IP).
- `POST /api/backup/run-now` — kör schemalagd backup direkt (409 om en redan körs).
- `GET /api/backup/config` / `PUT /api/backup/config` — läs/ändra schema.

### Off-site backup

`server/src/lib/offsiteBackup.ts`: om `OFFSITE_BACKUP_CMD` är satt körs den via
`sh -c` där `{file}` ersätts av env-variabeln `$BACKUP_FILE` (filvägen
interpoleras **aldrig** in i shell-strängen → ingen shell-injection). Ej satt =
ingen off-site-kopia (lokal backup opåverkad).

```bash
# Exempel
OFFSITE_BACKUP_CMD=rclone copy {file} remote:itticket/backups/
OFFSITE_BACKUP_REQUIRED=false
```

### Restore

`POST /api/backup/restore` (admin-only, rate limit: 5/15 min/IP, max 500 MB ZIP,
diskstorage så stora ZIP:ar inte OOM:ar).

Valideringskedjan i `routes/backup.ts` innan live-DB:n rörs:
1. **Zip-slip-skydd** — varje entry valideras (ingen absolut väg, inga `..`-segment,
   måste ligga under extraktionskatalogen).
2. **Allowlist** — endast `data/database.sqlite` och `data/uploads/*` accepteras.
3. `data/database.sqlite` måste finnas i ZIP:en.
4. **SQLite-magic-header** verifieras (`SQLite format 3\0`, 16 bytes).
5. Öppnas read-only och måste innehålla tabellerna `tickets` och `users`.

Återställning:
- `<DB_PATH>.pre-restore` skapas som rollback-kopia.
- `PRAGMA wal_checkpoint(RESTART)` väntar in läsare/skrivare.
- DB-handtaget stängs, filen skrivs över, WAL/SHM raderas, uploads ersätts.
- Vid fel rullas pre-restore-kopian tillbaka.
- Vid lyckad restore svarar servern och kör sedan `process.exit(0)` efter 1,5 s
  → Docker (`restart: unless-stopped`) startar om med den nya DB:n.

> Efter en restore kommer containern att starta om automatiskt. Verifiera
> `GET /api/health` = 200 efteråt.

---

## 5. Webhook-retry

Dispatcher: `server/src/lib/webhookDispatcher.ts`. Scheduler:
`server/src/lib/webhookRetryScheduler.ts` (cron varje minut, reentrancy-guard).

- Varje leverans persisteras som rad i `webhook_deliveries` **innan** första
  försöket, så retries överlever en process-krasch.
- Payload signeras med HMAC-SHA256 (`X-Webhook-Signature`), event i `X-Webhook-Event`.
- Fetch-timeout: 10 s (`AbortSignal.timeout(10000)`).
- URL omvalideras precis före varje fetch (skydd mot DNS-rebind till intern IP).

**Exponentiell backoff** (`RETRY_DELAYS_MINUTES`, max 5 försök, `MAX_WEBHOOK_ATTEMPTS = 5`):

| Försök som just misslyckades | Nästa retry |
|------------------------------|-------------|
| 1 | om 1 min |
| 2 | om 5 min |
| 3 | om 30 min |
| 4 | om 2 h |
| 5 | ger upp (ingen mer retry) |

Schedulern plockar bara rader där `delivered_at IS NULL`, `next_retry_at` är förfallen
och `attempts < 5`. Om en webhook avaktiverats efter att leveransen köades sätts
`next_retry_at = NULL` med `last_error = 'Webhook deactivated'`.

### Felsökning

```sql
-- Olevererade/fastnade leveranser
SELECT id, webhook_id, event, attempts, response_code, next_retry_at, last_error
FROM webhook_deliveries
WHERE delivered_at IS NULL
ORDER BY attempts DESC;

-- Leveranser som gett upp (5 försök, ingen retry kvar)
SELECT * FROM webhook_deliveries
WHERE delivered_at IS NULL AND next_retry_at IS NULL;
```

Loggar: `Webhook delivered successfully` (info), nät-/timeout-fel sätter
`response_code = 0` och `last_error` på leveransraden.

---

## 6. IMAP-polling (mail-to-ticket) — felsökning

Logik i `server/src/lib/emailInbound.ts`. Statusendpoint:
`GET /api/email-inbound/status` (autentiserad).

**Aktivering:** kräver minst `IMAP_HOST` + `IMAP_USER` och antingen `IMAP_PASS`
(Basic) eller alla tre OAuth2-vars. Saknas dessa loggas
`IMAP not configured, email-to-ticket disabled` och funktionen är avstängd.

**Env-vars (verifierade i koden):**

| Variabel | Default | Notis |
|----------|---------|-------|
| `IMAP_HOST` | — | Krävs |
| `IMAP_USER` | — | Krävs |
| `IMAP_PORT` | `993` | |
| `IMAP_SECURE` | `true` | Stängs av endast med exakt `false` |
| `IMAP_POLL_INTERVAL` | `60` (sek) | |
| `IMAP_AUTO_CREATE_CONTACT` | `true` | Stängs av endast med exakt `false` |
| `IMAP_PASS` | — | Basic Auth |
| `IMAP_TENANT_ID` / `IMAP_CLIENT_ID` / `IMAP_CLIENT_SECRET` | — | OAuth2 (M365 client credentials). Alla tre krävs för OAuth2-läge |

**Beteende:**
- Polling med rekursiv `setTimeout` (inte `setInterval`) → inga överlappande polls.
- OAuth2: ny access-token hämtas inför varje poll.
- Bearbetade mail flyttas till mappen `Processed` (MOVE, med COPY+DELETE-fallback).
- Mail > 25 MB hoppas över (OOM-skydd). Max 20 bilagor/mail.
- Bilagor valideras mot samma MIME-/extensions-/storleks-whitelist och
  magic-byte-kontroll som HTTP-uppladdningar.
- Trådning/dedup: Message-ID → kort-id `[#XXXXXXXX]` i ämnet → ämne+avsändare på
  öppet ärende → ~60 s nära-dubblett-fönster → annars nytt ärende.

**Symptom → trolig orsak:**
- Inga ärenden skapas → kolla `GET /api/email-inbound/status` (`configured`/`active`),
  och `Starting email polling`-loggen vid uppstart.
- `IMAP connection error` / `IMAP polling error` i loggen → fel host/port/secure
  eller utgången/felaktig OAuth2-credential. `ETIMEOUT` loggas medvetet **inte**
  som fel (förväntad transient).
- `Failed to acquire OAuth2 access token` → fel `IMAP_TENANT_ID/CLIENT_ID/CLIENT_SECRET`
  eller saknad mailbox-behörighet i Entra-app-registreringen.
- `MOVE failed, trying COPY+DELETE fallback` → IMAP-servern stödjer inte MOVE;
  fallbacken hanterar det, men kolla att `Processed`-mappen kan skapas.

`APP_BASE_URL` behövs för korrekta delningslänkar i bekräftelsemejl; saknas den
faller den tillbaka på första `CORS_ORIGIN` med en varning.

---

## 7. AI-tokenövervakning

Se `docs/AI_FEATURES.md` för fullständig dokumentation av AI-funktioner, modellval,
månadsbudget och circuit breaker. Operativt sammandrag:

- All användning loggas i tabellen `ai_usage_log` (token in/ut, modell, feature,
  duration, ok-flagga). Rader > 90 dagar städas dagligen 03:15 (`cleanupOldAiUsage`).
- Månadsbudget styrs av `AI_MONTHLY_TOKEN_LIMIT` (default `5000000`). När månadens
  summa överskrids returnerar AI-funktionerna `null` (kärnflöden opåverkade) och
  loggen visar `AI monthly token budget exceeded`.
- Circuit breaker öppnas efter 5 konsekutiva fel (5 min cooldown) → loggen visar
  `AI circuit breaker: opened`.

```sql
-- Tokenförbrukning denna kalendermånad (samma fråga som budgetkollen kör)
SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens
FROM ai_usage_log
WHERE created_at >= strftime('%Y-%m-01T00:00:00', 'now');

-- Förbrukning + felandel per feature, senaste 30 dagar
SELECT feature,
       COUNT(*)                 AS calls,
       SUM(ok)                  AS ok_calls,
       SUM(input_tokens)        AS in_tokens,
       SUM(output_tokens)       AS out_tokens,
       ROUND(AVG(duration_ms))  AS avg_ms
FROM ai_usage_log
WHERE created_at >= datetime('now', '-30 days')
GROUP BY feature;
```

---

## 8. Graceful shutdown

Hanteras i `server/src/index.ts` för **både** `SIGTERM` (container stop /
orchestrator) och `SIGINT` (Ctrl-C) via en idempotent handler:

1. Stoppar e-postpolling och alla schedulers (webhook-retry, reminder, recurring,
   auto-close, push, backup) samt inline-cron (refresh-token- och AI-usage-cleanup).
2. `server.close()` slutar ta emot nya requests och låter pågående avslutas.
3. `closeDatabase()` stänger SQLite rent (WAL checkpointas) i `server.close`-callbacken.
4. **Hard exit-vakt:** om cleanup hänger tvångsavslutas processen efter
   `SHUTDOWN_TIMEOUT_MS` (default `10000` ms = 10 s) med `process.exit(1)`.

> Ge containern minst `SHUTDOWN_TIMEOUT_MS` + marginal som stop-grace-period i
> Docker/Portainer så att WAL hinner checkpointa rent.

---

## 9. Incident-checklista

Snabb triage vid driftstörning:

1. **Hälsa:** `curl -s <url>/api/health` — 503 betyder DB ej nåbar (se §1/§3).
2. **Loggar:** `docker logs --tail 300 <backend>` — leta `"level":"error"`,
   `Uncaught exception`, `Unhandled promise rejection (CRITICAL)`,
   `Schema integrity check failed`.
3. **Startade servern?** Saknad `CSRF_SECRET` (eller < 32 tecken) ger ovillkorligt
   `process.exit(1)` — även i dev. Kontrollera env i Portainer (stack-filen är
   separat från repo-versionen — nya rader måste in manuellt).
4. **DB:** vid `database is locked`/`SQLITE_BUSY`, verifiera att `busy_timeout`
   är aktivt och att ingen restore/backup hänger. Vid korruptionsmisstanke:
   återställ från senaste verifierade backup (§4).
5. **Webhooks tysta:** kör SQL i §5 mot `webhook_deliveries`.
6. **Mail kommer inte in:** `GET /api/email-inbound/status` + IMAP-loggar (§6).
7. **AI tyst:** kontrollera circuit breaker/budget-loggar och `ai_usage_log` (§7);
   AI-fel är **alltid** non-fatala (returnerar `null`) och blockerar aldrig ärendeflödet.
8. **Behöver omstart?** Container har `restart`-policy; `SIGTERM` ger graceful
   shutdown (§8). Vid hängande restore tvingar appen själv en omstart.
9. **Återställ:** vid behov restore via `POST /api/backup/restore` (admin) —
   servern startar om automatiskt efteråt. Verifiera `/api/health` = 200.

Deploy-flödet (bygga images, redeploy i Portainer) ligger i `CLAUDE.md` och
`docs/RUNBOOK.md` — Claude/operatören kör aldrig `docker-compose up` mot prod.
