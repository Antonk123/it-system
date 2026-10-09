# IT-Ticket — Drifthandbok

> Operativa rutiner för backup, restore, uppgradering och felsökning.
> Gäller per-kund-installationer via `setup.sh`.

---

## Filplatser

| Vad | Sökväg |
|-----|--------|
| Installationskatalog | `/opt/it-ticketing/` |
| Konfiguration | `/opt/it-ticketing/.env` |
| Compose-fil | `/opt/it-ticketing/docker-compose.local.yml` |
| Databas (i Docker-volym) | `it-ticketing-data` → `/app/data/database.sqlite` |
| Uppladdade filer | `it-ticketing-data` → `/app/data/uploads/` |

---

## Backup & Restore

> Fullständig teknisk genomgång (validering, filstruktur, felkoder) finns i
> [`docs/OPERATIONS.md`, avsnitt 4](./OPERATIONS.md#4-backup--restore). Det här
> avsnittet är den korta drift-versionen.

IT-Ticket har ett **inbyggt backup-system** — inget cron-script eller manuellt
`docker run` krävs i normalfallet.

### Schemalagd backup (rekommenderad väg)

Styrs av raden `backup_config` i databasen (migration 061), default: **04:00
lokal tid, 7 dagars retention**. Vid varje körning:

1. WAL-säker online-snapshot av SQLite-databasen.
2. `PRAGMA integrity_check` — en korrupt snapshot rullar aldrig in i retention.
3. Kontrollerar lediga disken (minst 2 × datamängden och 500 MB, annars misslyckas körningen).
4. Buntar `data/database.sqlite` + `data/uploads/` till `backup-<YYYY-MM-DD-HHMM>.zip`
   i `<DB_PATH-katalog>/backups` (`chmod 0o600`). Filen skrivs som `*.tmp` och döps om
   först när den är komplett.
5. Öppnar ZIP:en igen och verifierar att `data/database.sqlite` finns och inte är tom —
   annars räknas körningen som misslyckad.
6. Valfri off-site-uppladdning (`OFFSITE_BACKUP_CMD` — se "Off-site backup" nedan).
7. Rensar backuper äldre än `retention_days` (datumet läses ur filnamnet).
8. Skriver status (`last_run_at`, `last_status`, `last_size_bytes`, `last_error`,
   `consecutive_failures`) till `backup_config`. Efter **3 misslyckade körningar i rad**
   skickas en push-notis till alla admins.

Missar servern schemalagt klockslag (t.ex. nere vid 04:00) körs en catch-up-backup
direkt vid nästa serverstart om senaste körningen saknas eller är äldre än ~24h.

**Admin-UI:t** (Inställningar → Backup) visar och styr allt detta:
- **"Kör backup nu"** — kör en backup direkt (409 om en redan pågår).
- Schema: aktiverad/pausad, klockslag, retention-dagar.
- Status för senaste körningen, inkl. `offsite_failed` om lokal backup lyckades
  men off-site-uppladdningen inte gjorde det (se `OFFSITE_BACKUP_REQUIRED` i
  `.env.example`), samt en räknare för konsekutiva misslyckanden.

Motsvarande API: `GET/PUT /api/backup/config`, `POST /api/backup/run-now`,
`GET /api/backup/files` (lista lagrade backuper) och `GET /api/backup/files/:name`
(ladda ner en) — alla admin-only.

### Manuell nedladdning

`GET /api/backup` (admin-only, rate limit 10/15 min/IP) — laddar ner en färsk
ZIP med samma struktur som den schemalagda backupen (`data/database.sqlite` +
`data/uploads/`). Praktiskt för att ta en engångskopia innan en riskabel ändring,
eller för att arkivera en backup utanför servern manuellt.

### Restore

`POST /api/backup/restore` (admin-only, rate limit 5/15 min/IP, max 500 MB ZIP)
— ladda upp en ZIP från admin-UI:t (Inställningar → Backup → Återställ).

Innan live-databasen rörs valideras uppladdningen i ordning:
1. **Zip-slip-skydd** — varje post i ZIP:en måste ligga under extraktionskatalogen
   (ingen absolut väg, inga `..`-segment).
2. **Allowlist** — endast `data/database.sqlite` och `data/uploads/*` accepteras.
3. `data/database.sqlite` måste finnas i ZIP:en.
4. **SQLite-magic-header** verifieras (`SQLite format 3\0`) innan filen öppnas.
5. Öppnas read-only och måste klara `PRAGMA quick_check` samt innehålla tabellerna
   `tickets` och `users`.
6. Extraktionen avbryts över 2 GB utpackat eller 100 000 poster (ZIP-bomb-skydd).

Vid godkänd validering tas en WAL-säker `<DB_PATH>.pre-restore`-kopia (`db.backup()`)
och `uploads` flyttas till `<UPLOAD_DIR>.pre-restore`. Därefter checkpointas WAL,
DB-filen och uploads ersätts och FTS5-indexen byggs om. Går något fel efter bytet
återställs **både** DB och uploads från pre-restore-kopiorna. Servern svarar med
`restartRequired: true` och kör därefter `process.exit(0)` — Docker
(`restart: unless-stopped`) startar om containern automatiskt med den nya
databasen. Verifiera `GET /api/health` = 200 efteråt.

`uploads.pre-restore` raderas automatiskt vid nästa lyckade uppstart (efter
migrationer och schemakontroll). `database.sqlite.pre-restore` ligger kvar som
sista skyddsnät tills nästa restore skriver över den — radera den för hand när du
är nöjd.

### Off-site backup (krävs i produktion)

Utan off-site-kopia ligger alla backuper på **samma host och samma Docker-volymmiljö**
som databasen — en diskkrasch eller ett raderat Portainer-stack tar dem med sig.
Servern loggar en varning vid start i produktion om `OFFSITE_BACKUP_CMD` är tomt.

Konfigureras som miljövariabler i Portainer-stacken (inte i repots compose-fil, som
är en separat kopia). `rclone` ingår i backend-imagen. De exakta raderna — inklusive
montering av rclone-config och kryptering med `rclone crypt` — står i
[`docs/OPERATIONS.md`, "Off-site-backup"](./OPERATIONS.md#off-site-backup-rclone).

```bash
OFFSITE_BACKUP_CMD=rclone copy {file} itticket-crypt:backups/
OFFSITE_BACKUP_REQUIRED=true
```

`{file}` ersätts av filsökvägen via en env-var (aldrig interpolerad i shell-
strängen → ingen shell-injection). `OFFSITE_BACKUP_REQUIRED=true` gör en
misslyckad off-site-uppladdning fatal för körningen (markeras `offsite_failed`,
lokal backup + retention körs ändå). Kommandot avbryts efter 15 minuter.

### Restore-övning (kvartalsvis)

En backup som aldrig återställts är en gissning. Gör detta var tredje månad, mot en
**separat testinstans** (aldrig mot prod):

- [ ] Hämta den senaste backupen **från off-site-lagringen** (inte från servern) och
      avkryptera den om `rclone crypt` används.
- [ ] Kontrollera att ZIP:en går att öppna och innehåller `data/database.sqlite` och `data/uploads/`.
- [ ] Starta en testinstans (lokal stack, annan port) och ladda upp ZIP:en via
      Inställningar → Backup → Återställ.
- [ ] Servern svarar 200 på `GET /api/health` efter den automatiska omstarten.
- [ ] Logga in med ett riktigt konto och öppna ett nyligen skapat ärende — datan är färsk.
- [ ] Öppna ett ärende med bilaga och ladda ner bilagan (uploads återställdes).
- [ ] Sök på ett ord ur ett nyligen skapat ärende och en KB-artikel (FTS5-indexen byggdes om).
- [ ] Inställningar → Backup visar status och ingen `consecutive_failures`.
- [ ] Notera tiden restoren tog och eventuella fel i `docs/OPERATIONS.md`/lessons.
- [ ] Verifiera att Portainer-stackens env (hemligheter) finns säkrad enligt checklistan i
      `docs/OPERATIONS.md` — utan `JWT_SECRET`/`CSRF_SECRET`/VAPID-nycklar är en återställd
      databas bara halva systemet.

### Reservprocedur (manuell)

> Använd bara om det inbyggda systemet ovan inte är tillgängligt (t.ex. servern
> startar inte, eller du behöver en kopia från utsidan utan att gå via API:et).
> Den rekommenderade vägen är alltid den inbyggda schemalagda backupen +
> admin-UI:t. Container-livscykeln (stopp/start) sköts i Portainer — aldrig med
> `docker run` eller compose från terminalen, då tappar Portainer kontrollen över stacken.

**Backup** (containern kör):

```bash
# Föredraget: den inbyggda nedladdningen (WAL-säker, innehåller uploads)
curl -sf -H "Authorization: Bearer itk_live_<admin-scopad API-nyckel>" \
  -o manual-backup.zip https://<din-domän>/api/backup \
  || { echo "BACKUP MISSLYCKADES"; exit 1; }

# Alternativ om bara databasen behövs: SQLites online-backup via better-sqlite3
# (sqlite3-CLI:t finns inte i imagen). Kopierar aldrig en levande WAL-fil rakt av.
docker exec it-ticketing-backend node -e "
  const Database = require('better-sqlite3');
  new Database('/app/data/database.sqlite').backup('/app/data/backups/manual.sqlite')
    .then(() => console.log('Backup klar'));
"
docker cp it-ticketing-backend:/app/data/backups/manual.sqlite ./manual.sqlite
docker exec it-ticketing-backend rm /app/data/backups/manual.sqlite
```

**Restore** (kräver att backend-containern är stoppad):

1. Portainer → Containers → `it-ticketing-backend` → **Stop**.
2. På hosten, mot volymens sökväg (`docker volume inspect it-ticketing-data` → `Mountpoint`):

   ```bash
   VOL=$(docker volume inspect it-ticketing-data --format '{{.Mountpoint}}')
   sudo rm -f "$VOL/database.sqlite-wal" "$VOL/database.sqlite-shm"
   sudo cp manual.sqlite "$VOL/database.sqlite"
   sudo chown 1000:1000 "$VOL/database.sqlite"
   ```

   Radera alltid `-wal` och `-shm` **före** kopieringen: en kvarglömd WAL från den gamla
   databasen appliceras annars på den återställda filen och korrumperar den. För uploads:
   packa upp `data/uploads/` ur en ZIP från `GET /api/backup` till `$VOL/uploads/` och
   `chown -R 1000:1000` dem.
3. Portainer → `it-ticketing-backend` → **Start**.
4. Verifiera: `curl -sf https://<din-domän>/api/health` och kontrollera loggen
   (`docker logs it-ticketing-backend --tail 30`) att migrationerna gick igenom.

---

## Uppgradering

```bash
cd /opt/it-ticketing

# 1. Ta backup först! (inbyggda backup-systemet — se "Backup & Restore" ovan)
#    Admin-UI: Inställningar → Backup → "Kör backup nu", eller ladda ner en ZIP.
#
#    OBS: nyckeln måste ha scope "admin". Sedan admin-scopet infördes räcker
#    varken read eller write för /api/backup — anropet ger 403. Nycklar som
#    skapades före den ändringen har inget admin-scope och måste ersättas med
#    en ny nyckel (Inställningar → Integrationer → kryssa i Admin-scope).
#    Kontrollera utfallet innan du går vidare — curl -sf failar tyst, och en
#    uppgradering utan pre-upgrade-backup är precis vad steget ska förhindra.
curl -sf -H "Authorization: Bearer itk_live_<admin-scopad API-nyckel>" \
  -o backup-pre-upgrade.zip http://localhost:3002/api/backup \
  || { echo "BACKUP MISSLYCKADES — avbryt uppgraderingen"; exit 1; }

# 2. Hämta ny kod
git pull

# 3. Bygg nya images
docker build -f Dockerfile.server -t it-ticketing-backend:latest . --quiet
docker build -f Dockerfile.client -t it-ticketing-frontend:latest . --quiet

# 4. Starta om med nya images
docker compose -f docker-compose.local.yml --env-file .env up -d

# 5. Verifiera
docker logs it-ticketing-backend --tail 20
curl -sf http://localhost:3002/api/health && echo "OK"
```

Migrationer körs automatiskt vid serverstart — inga manuella steg krävs.

---

## Rollback

Om en uppgradering går fel:

```bash
cd /opt/it-ticketing

# 1. Gå tillbaka till förra versionen
git log --oneline -5   # hitta commiten du vill gå tillbaka till
git checkout <commit-hash>

# 2. Bygg om images
docker build -f Dockerfile.server -t it-ticketing-backend:latest . --quiet
docker build -f Dockerfile.client -t it-ticketing-frontend:latest . --quiet

# 3. Restore databas-backup (om migrationer ändrat schemat)
# Se "Restore" ovan

# 4. Starta om
docker compose -f docker-compose.local.yml --env-file .env up -d
```

---

## Felsökning

### Loggar

```bash
# Backend-loggar (realtid)
docker logs it-ticketing-backend -f --tail 50

# Frontend-loggar (nginx)
docker logs it-ticketing-frontend -f --tail 50

# Alla containers
docker compose -f docker-compose.local.yml logs -f
```

### Vanliga problem

| Symptom | Orsak | Lösning |
|---------|-------|---------|
| "502 Bad Gateway" | Backend har kraschat | `docker logs it-ticketing-backend --tail 30` → `docker restart it-ticketing-backend` |
| "CORS error" i konsolen | URL matchar inte `CORS_ORIGIN` | Uppdatera `CORS_ORIGIN` i `.env`, starta om |
| Inloggning misslyckas | JWT_SECRET har ändrats | Användare måste logga in igen (tokens invaliderade) |
| Databasen är korrupt | Strömbortfall under skrivning | Restore senaste backup |

### Health check

```bash
# Backend
curl -sf http://localhost:3002/api/health && echo "Backend OK" || echo "Backend NERE"

# Frontend
curl -sf http://localhost:8082/ > /dev/null && echo "Frontend OK" || echo "Frontend NERE"
```

### Starta om allt

```bash
cd /opt/it-ticketing
docker compose -f docker-compose.local.yml --env-file .env down
docker compose -f docker-compose.local.yml --env-file .env up -d
```

---

## Kontakt

Vid problem som inte löses av denna handbok, kontakta:

- **Driftansvarig för din instans** — fyll i kontaktvägen som gäller hos er.
- **Buggar och säkerhetsproblem i själva projektet:** se `SECURITY.md` (säkerhet rapporteras
  privat via GitHub Security Advisories, inte som publik issue).
