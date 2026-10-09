# IT-Ticket — Operations Guide

Operativa rutiner för IT-Ticket-backenden: hälsokontroller, loggar, DB-underhåll,
backup/restore, webhook-retry, IMAP-felsökning, graceful shutdown och en kort
incident-checklista.

> Närliggande dokument:
> - `docs/RUNBOOK.md` — drifthandbok för per-kund-installationer via `setup.sh`
>   (uppgradering; backup/restore utgår från det inbyggda systemet med manuell
>   volym-kopiering som reserv). Den här filen täcker de
>   **applikationsinterna** rutinerna (inbyggd scheduler, endpoints, env-styrning).

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
# Snabbkoll mot prod (byt ut mot din egen instans URL)
curl -s https://helpdesk.example.com/api/health
# Lokalt (tsx watch)
curl -s http://localhost:3001/api/health
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
ssh <server> 'docker logs -f --tail 200 <backend-container>'

# Filtrera bara fel
ssh <server> 'docker logs <backend-container> 2>&1 | grep "\"level\":\"error\""'
```

Notabla larm-loggrader att vakta på:
- `Unhandled promise rejection` (eskalerar till `CRITICAL` vid ≥50 ackumulerade —
  räknaren nollställs efter en ren period, se `index.ts`).
- `Uncaught exception` → processen avslutas med `process.exit(1)` (Docker
  `restart`-policy startar om).
- `CORS blocked request` → en origin saknas i `CORS_ORIGIN`.

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
2. Diskkontroll: lediga byte i backup-katalogen måste vara minst 2 × (DB + uploads)
   och minst 500 MB, annars misslyckas körningen (loggas som fel).
3. WAL-säker online-snapshot via `database.backup(tmpDbPath)`.
4. `PRAGMA integrity_check` — korrupt snapshot rullar **aldrig** in i retention.
5. Buntar `data/database.sqlite` + `data/uploads/` till `backup-<YYYY-MM-DD-HHMM>.zip.tmp`
   (HHMM i namnet så flera körningar samma dag inte skriver över varandra).
6. Öppnar ZIP:en igen och verifierar att den har poster och att `data/database.sqlite`
   finns och inte är tom — annars misslyckas körningen och `.tmp`-filen raderas.
7. `chmod 0o600` (ZIP:en innehåller hela DB:n inkl. hemligheter) och omdöpning till
   det slutliga `backup-*.zip`-namnet.
8. Off-site-upload (se nedan).
9. Retention i **dagar**: `backup-*.zip`/`.sqlite` vars datum i filnamnet är äldre än
   `retention_days` raderas (samt kvarlämnade `*.zip.tmp`).
10. Skriver status (`last_run_at`, `last_status`, `last_size_bytes`, `last_error`,
    `consecutive_failures`) till `backup_config`. Räknaren är persistent och överlever
    omstart. Efter **3 misslyckade körningar i rad** loggas `BACKUP ALERT` och en push
    skickas till alla admins (en gång — inte vid varje följande miss).

Backup-katalogen är `<DB_PATH-katalog>/backups` (skapas med `mode 0o700`).
Cron-tiden tolkas i containerns lokaltid (styrs av `TZ`; prod = Europe/Stockholm
kräver `tzdata` i imagen, annars UTC).

**Relevanta env-vars:**
- `DB_PATH` — bestämmer var `backups/` hamnar.
- `UPLOAD_DIR` — vilka filer som buntas in.
- `TZ` — tolkning av schemats klockslag.
- `OFFSITE_BACKUP_CMD` — shell-mall som körs efter nattlig backup (se nedan).
- `OFFSITE_BACKUP_REQUIRED` — om `true` markeras en misslyckad off-site-upload som
  `offsite_failed` (den lokala backupen och retention körs ändå); annars loggas
  felet och backupen förblir `success`.

### Manuell backup / nedladdning

- `GET /api/backup/` — laddar ner en färsk ZIP (rate limit: 10/15 min/IP). Den
  temporära dumpen skrivs i backup-katalogen (inte `/tmp`).
- `GET /api/backup/files` — lista lagrade `backup-*.zip` (`[{ name, sizeBytes, modifiedAt }]`, nyast först).
- `GET /api/backup/files/:name` — ladda ner en lagrad backup (samma rate limit som ovan;
  `name` måste matcha `backup-YYYY-MM-DD[-HHMM].zip`).
- `POST /api/backup/run-now` — kör schemalagd backup direkt (409 om en redan körs).
- `GET /api/backup/config` / `PUT /api/backup/config` — läs/ändra schema
  (svaret innehåller `consecutiveFailures`, `lastError`, `offsiteFailureCount`).

### Off-site-backup (rclone)

`server/src/lib/offsiteBackup.ts`: om `OFFSITE_BACKUP_CMD` är satt körs den via
`sh -c` där `{file}` ersätts av env-variabeln `$BACKUP_FILE` (filvägen
interpoleras **aldrig** in i shell-strängen → ingen shell-injection). Kommandot
avbryts med SIGKILL efter 15 minuter. Ej satt = ingen off-site-kopia, och då
ligger alla backuper på samma host som databasen; servern loggar i så fall
`Ingen off-site-backup konfigurerad` vid varje start i produktion.

`rclone` ingår i backend-imagen (`apk add rclone` i `Dockerfile.server`). Så här
sätter du upp det i produktion:

**1. Skapa rclone-config** (på en dator med rclone, `rclone config`). Skapa först en
ordinär remote för lagringen (SFTP, S3, B2, OneDrive …) — här kallad `itticket-remote`
— och sedan en **crypt-remote** ovanpå den så att backuperna (som innehåller hela
databasen, inkl. hashar och hemligheter) aldrig ligger okrypterade hos tredje part:

```ini
[itticket-crypt]
type = crypt
remote = itticket-remote:itticket-backups
filename_encryption = standard
directory_name_encryption = true
password = <utdata från: rclone obscure '<långt lösenord>'>
password2 = <utdata från: rclone obscure '<salt>'>
```

Spara crypt-lösenordet och saltet i lösenordshanteraren. **Utan dem går off-site-
backuperna inte att läsa.**

**2. Lägg configen på servern** (en katalog, inte en enskild fil) och gör den läsbar för
containerns icke-root-användare (`node`, uid 1000):

```bash
sudo mkdir -p /opt/it-system/rclone
sudo cp rclone.conf /opt/it-system/rclone/rclone.conf
sudo chown -R 1000:1000 /opt/it-system/rclone
sudo chmod 600 /opt/it-system/rclone/rclone.conf
```

**3. Portainer → Stacks → `it-ticket-system` → Editor / Environment variables.**
Lägg till under backend-tjänstens `volumes:` (byt `:ro` mot `:rw` för OAuth-baserade
remotes som OneDrive/Drive, som skriver tillbaka förnyade tokens):

```yaml
      - /opt/it-system/rclone:/home/node/.config/rclone:ro
```

och sätt dessa miljövariabler (repots compose-fil har redan raderna, men standardvärdet
är tomt/`false`):

```bash
OFFSITE_BACKUP_CMD=rclone copy {file} itticket-crypt:backups/
OFFSITE_BACKUP_REQUIRED=true
```

Redeploya stacken.

**4. Verifiera.**

```bash
docker exec it-ticketing-backend rclone lsd itticket-crypt:      # ska lista utan fel
```

Kör sedan Inställningar → Backup → **Kör backup nu**. Status ska bli `success` (inte
`offsite_failed`) och filen ska synas på lagringen (`rclone ls itticket-crypt:backups/`).
Dekryptering sker transparent via crypt-remoten.

**5. Retention hos lagringen.** `rclone copy` raderar aldrig. Låt leverantörens
livscykelregler eller ett separat jobb (`rclone delete --min-age 30d itticket-crypt:backups/`)
rensa gamla kopior.

### Säkerhetskopiera Portainer-stackens env (hemligheterna)

Backup-ZIP:en innehåller **databasen och uploads — inte hemligheterna**. De ligger bara i
Portainer-stackens miljövariabler (och `rclone.conf`). Förloras stacken (raderad, ny
host, Portainer-krasch) kan en återställd databas inte användas fullt ut. Spara en
kopia av följande i lösenordshanteraren (eller annan krypterad plats) och uppdatera den
varje gång något ändras:

- [ ] `JWT_SECRET`, `CSRF_SECRET` (nya värden = alla användare loggas ut, annars ingen skada)
- [ ] `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (nya nycklar = alla
      push-prenumerationer ogiltiga, användarna måste slå på notiser igen)
- [ ] `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`
      (klienthemligheten går bara att förnya i Entra)
- [ ] `SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM`, `EMAIL_TO`
- [ ] `IMAP_HOST/PORT/USER/PASS` samt `IMAP_TENANT_ID/CLIENT_ID/CLIENT_SECRET` (OAuth2)
- [ ] `ADMIN_EMAIL`, `ADMIN_NAME`, `CORS_ORIGIN`, `APP_BASE_URL`, `COOKIE_SECURE`
- [ ] `OFFSITE_BACKUP_CMD`, `OFFSITE_BACKUP_REQUIRED`
- [ ] `/opt/it-system/rclone/rclone.conf` samt rclone-crypt-lösenord och salt
- [ ] Hela stack-definitionen (Portainer → Stacks → Editor → kopiera texten) — den är en
      separat kopia av repots compose-fil

### Restore

`POST /api/backup/restore` (admin-only, rate limit: 5/15 min/IP, max 500 MB ZIP,
diskstorage så stora ZIP:ar inte OOM:ar).

Valideringskedjan i `routes/backup.ts` innan live-DB:n rörs:
1. **Zip-slip-skydd** — varje entry valideras (ingen absolut väg, inga `..`-segment,
   måste ligga under extraktionskatalogen).
2. **Allowlist** — endast `data/database.sqlite` och `data/uploads/*` accepteras.
3. `data/database.sqlite` måste finnas i ZIP:en.
4. **SQLite-magic-header** verifieras (`SQLite format 3\0`, 16 bytes).
5. Öppnas read-only och måste klara `PRAGMA quick_check` (annars 400) samt innehålla
   tabellerna `tickets` och `users`.
6. Extraktionen avbryts (400) över 2 GB utpackat eller 100 000 poster.

Multer-fel ger klientfel i stället för 500: fel filtyp → 400, för stor fil (> 500 MB) → 413.

Återställning (`performRestoreSwap`):
- `<DB_PATH>.pre-restore` skapas med `db.backup()` (WAL-säker; en filkopia av en
  WAL-databas missar allt som bara finns i `-wal`).
- `<UPLOAD_DIR>` flyttas till `<UPLOAD_DIR>.pre-restore` (raderas inte).
- `PRAGMA wal_checkpoint(RESTART)` väntar in läsare/skrivare.
- DB-handtaget stängs, filen skrivs över, WAL/SHM raderas, uploads kopieras in.
- Vid fel efter bytet återställs **både** DB och uploads från pre-restore-kopiorna.
- FTS5-indexen byggs om i den återställda filen (`rebuildFts`).
- Vid lyckad restore svarar servern och kör sedan `process.exit(0)` efter 1,5 s
  → Docker (`restart: unless-stopped`) startar om med den nya DB:n.
- Efter nästa lyckade uppstart (migrationer + `verifySchemaIntegrity`) raderas
  `<UPLOAD_DIR>.pre-restore`. `<DB_PATH>.pre-restore` ligger kvar som sista skyddsnät;
  radera den för hand när du är nöjd. Vid uppstart loggas även en varning om
  FTS5-indexen avviker från tabellerna (`checkFtsDrift`).

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

## 7. Graceful shutdown

Hanteras i `server/src/index.ts` för **både** `SIGTERM` (container stop /
orchestrator) och `SIGINT` (Ctrl-C) via en idempotent handler:

1. Stoppar e-postpolling och alla schedulers (webhook-retry, reminder, recurring,
   auto-close, push, backup) samt inline-cron (refresh-token-cleanup).
2. `server.close()` slutar ta emot nya requests och låter pågående avslutas.
3. En pågående backup väntas in (`waitForBackup`, max `SHUTDOWN_TIMEOUT_MS` − 1 s) så att
   databasen inte stängs under `database.backup()`.
4. `closeDatabase()` stänger SQLite rent (WAL checkpointas) i `server.close`-callbacken.
5. **Hard exit-vakt:** om cleanup hänger tvångsavslutas processen efter
   `SHUTDOWN_TIMEOUT_MS` (default `15000` ms = 15 s) med `process.exit(1)`.

> Ge containern minst `SHUTDOWN_TIMEOUT_MS` + marginal som stop-grace-period i
> Docker/Portainer så att WAL hinner checkpointa rent. Repots compose-filer sätter
> `stop_grace_period: 20s` (Dockers default på 10 s ger SIGKILL mitt i en backup).

---

## 8. Incident-checklista

Snabb triage vid driftstörning:

1. **Hälsa:** `curl -s <url>/api/health` — 503 betyder DB ej nåbar (se §1/§3).
2. **Loggar:** `docker logs --tail 300 <backend>` — leta `"level":"error"`,
   `Uncaught exception`, `Unhandled promise rejection (CRITICAL)`,
   `Schema integrity check failed`.
3. **Startade servern?** Saknad `CSRF_SECRET` (eller < 32 tecken) ger ovillkorligt
   `process.exit(1)` i alla miljöer. Kontrollera env i Portainer — stackdefinitionen
   där är en separat kopia av compose-filen och uppdateras aldrig av `git pull`.
   Det gäller hela filen, inte bara env: en inaktuell `command:`-rad ger samma
   crash-loop. Se vad som faktiskt körs med
   `docker inspect <container> --format '{{json .Config.Cmd}}'`.
4. **DB:** vid `database is locked`/`SQLITE_BUSY`, verifiera att `busy_timeout`
   är aktivt och att ingen restore/backup hänger. Vid korruptionsmisstanke:
   återställ från senaste verifierade backup (§4).
5. **Webhooks tysta:** kör SQL i §5 mot `webhook_deliveries`.
6. **Mail kommer inte in:** `GET /api/email-inbound/status` + IMAP-loggar (§6).
7. **Behöver omstart?** Container har `restart`-policy; `SIGTERM` ger graceful
   shutdown (§7). Vid hängande restore tvingar appen själv en omstart.
9. **Återställ:** vid behov restore via `POST /api/backup/restore` (admin) —
   servern startar om automatiskt efteråt. Verifiera `/api/health` = 200.

Deploy-flödet (bygga images, redeploy i Portainer) ligger i `CLAUDE.md` och
`docs/RUNBOOK.md` — Claude/operatören kör aldrig `docker-compose up` mot prod.

---

## 9. Portainer-stack, nätverk och hemligheter

> **Portainer-stacken (id 39) är en SEPARAT kopia av `docker-compose.yml`. Ändringarna
> nedan slår INTE igenom av `git pull` eller av att du bygger nya images — du måste
> klistra in den nya compose-filen (eller göra ändringarna för hand) i Portainers
> editor och redeploya stacken.**

### Ändringar som måste göras för hand i stacken

- [ ] **Backend-porten: `"127.0.0.1:3002:3001"`** (i stället för `"3002:3001"`).
      Appen kör med `trust proxy 1` och litar på `X-Forwarded-For`. En backend-port öppen
      mot LAN låter vem som helst skicka en egen `X-Forwarded-For` och därmed förfalska
      sin IP (kringgå rate limits, förvilla `audit_log`). nginx i frontend-containern når
      backend via docker-nätverket (`it-ticketing-backend:3001`) och behöver inte porten.
      **Kontrollera först att inget annat (t.ex. Navet eller en extern proxy) anropar
      `:3002` direkt.**
- [ ] **`COOKIE_SECURE=true`** i stackens env. Compose-defaulten är `false` (HTTP-på-LAN),
      men prod körs bakom TLS på `ticket.prefabmastarna.se`. Servern loggar
      `COOKIE_SECURE är inte "true" i produktion` vid start om den saknas.
- [ ] **`stop_grace_period: 20s`** på backend-tjänsten och `SHUTDOWN_TIMEOUT_MS=15000`.
- [ ] **Off-site-backup:** `OFFSITE_BACKUP_CMD`, `OFFSITE_BACKUP_REQUIRED=true` och
      rclone-volymen (se "Off-site-backup (rclone)" i §4).
- [ ] **Icke-root-container (engångs-`chown`).** Backend-imagen kör nu som användaren
      `node` (uid 1000) i stället för root. Volymer som skapades när containern körde som
      root är ägda av root och blir skrivskyddade för appen (databasen går inte att öppna).
      Gör detta **en gång**, med backend-containern stoppad i Portainer, innan du
      redeployar med den nya imagen:

      ```bash
      for v in it-ticketing-data it-ticketing-backups; do
        sudo chown -R 1000:1000 "$(docker volume inspect "$v" --format '{{.Mountpoint}}')"
      done
      ```

      Verifiera efter redeploy: `docker exec it-ticketing-backend id` ska visa
      `uid=1000(node)`, och `GET /api/health` ska ge 200.

### Klient-IP bakom TLS-proxyn (nginx `real_ip`)

Front-proxyn som terminerar TLS skickar `X-Forwarded-For`. `nginx.conf` i
frontend-imagen återställer klientens riktiga IP (`set_real_ip_from` för RFC1918-näten +
`real_ip_header X-Forwarded-For` + `real_ip_recursive on`). Utan detta ser backend
proxyns adress för alla användare: alla delar samma rate-limit-bucket och samma IP i
`audit_log`. **Smalna av `set_real_ip_from` till front-proxyns faktiska IP** när den är
känd, annars litar nginx på `X-Forwarded-For` från vilken privat adress som helst.

Verifiera med `audit_log.ip_address` — logga in från en klient och kontrollera att det är
*klientens* IP som sparats, inte proxyns eller en `172.x`-adress:

```bash
docker exec it-ticketing-backend node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/database.sqlite', { readonly: true });
  console.table(db.prepare('SELECT action, ip_address, created_at FROM audit_log ORDER BY created_at DESC LIMIT 10').all());
"
```

Visar alla rader samma privata adress har `real_ip` inte slagit igenom (fel proxy-IP i
`set_real_ip_from`, eller proxyn skickar inget `X-Forwarded-For`). Frontend-containerns
access-logg (`docker logs it-ticketing-frontend`) visar samma sak i första kolumnen.

nginx maskerar engångstokens (`/reset-password/<token>`, `/shared/<token>`,
`/kb/public/<token>`, motsvarande `/api/`-vägar och OIDC-callbackens query) som
`<redacted>` i access-loggen — även när adressen står i `Referer`.
