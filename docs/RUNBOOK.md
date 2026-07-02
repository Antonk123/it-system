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
3. Buntar `data/database.sqlite` + `data/uploads/` till en `backup-<YYYY-MM-DD>.zip`
   i `<DB_PATH-katalog>/backups` (`chmod 0o600`).
4. Valfri off-site-uppladdning (`OFFSITE_BACKUP_CMD` i `.env` — se `.env.example`).
5. Rensar äldre backupar enligt retention.
6. Skriver status (`last_run_at`, `last_status`, `last_size_bytes`) till `backup_config`.

Missar servern schemalagt klockslag (t.ex. nere vid 04:00) körs en catch-up-backup
direkt vid nästa serverstart om senaste körningen saknas eller är äldre än ~24h.

**Admin-UI:t** (Inställningar → Backup) visar och styr allt detta:
- **"Kör backup nu"** — kör en backup direkt (409 om en redan pågår).
- Schema: aktiverad/pausad, klockslag, retention-dagar.
- Status för senaste körningen, inkl. `offsite_failed` om lokal backup lyckades
  men off-site-uppladdningen inte gjorde det (se `OFFSITE_BACKUP_REQUIRED` i
  `.env.example`), samt en räknare för konsekutiva misslyckanden.

Motsvarande API: `GET/PUT /api/backup/config`, `POST /api/backup/run-now`
(admin-only).

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
5. Öppnas read-only och måste innehålla tabellerna `tickets` och `users`.

Vid godkänd validering tas en `<DB_PATH>.pre-restore`-kopia (rollback om något
går fel), WAL checkpointas, DB-filen och uploads ersätts, och servern svarar
med `restartRequired: true` och kör därefter `process.exit(0)` — Docker
(`restart: unless-stopped`) startar om containern automatiskt med den nya
databasen. Verifiera `GET /api/health` = 200 efteråt.

### Off-site backup (rekommenderas)

Konfigureras via `.env` — inget separat script:

```bash
# .env
OFFSITE_BACKUP_CMD=rclone copy {file} remote:itticket/backups/
OFFSITE_BACKUP_REQUIRED=false
```

`{file}` ersätts av filsökvägen via en env-var (aldrig interpolerad i shell-
strängen → ingen shell-injection). Se `.env.example` för fler exempel-providers
via [rclone](https://rclone.org/). `OFFSITE_BACKUP_REQUIRED=true` gör en
misslyckad off-site-uppladdning fatal för körningen (markeras `offsite_failed`,
lokal backup + retention körs ändå) — default `false` loggar bara felet.

### Reservprocedur (manuell)

> Använd bara om det inbyggda systemet ovan inte är tillgängligt (t.ex. servern
> startar inte, eller du behöver en kopia från utsidan utan att gå via API:et).
> Den rekommenderade vägen är alltid den inbyggda schemalagda backupen +
> admin-UI:t.

```bash
# Kopiera databas och uppladdningar direkt från Docker-volymen
BACKUP_DIR="/opt/it-ticketing/backups-manual"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M)

docker run --rm \
  -v it-ticketing-data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c "
    cp /data/database.sqlite /backup/database-${TIMESTAMP}.sqlite
    tar czf /backup/uploads-${TIMESTAMP}.tar.gz -C /data uploads/
  "

echo "Backup klar: $BACKUP_DIR/database-${TIMESTAMP}.sqlite"
```

Manuell restore från en sådan kopia (systemet måste vara nere):

```bash
cd /opt/it-ticketing

# 1. Stoppa systemet
docker compose -f docker-compose.local.yml --env-file .env down

# 2. Kopiera backup till volymen
docker run --rm \
  -v it-ticketing-data:/data \
  -v /opt/it-ticketing/backups-manual:/backup:ro \
  alpine sh -c "
    cp /backup/database-YYYYMMDD-HHMM.sqlite /data/database.sqlite
    tar xzf /backup/uploads-YYYYMMDD-HHMM.tar.gz -C /data
  "

# 3. Starta om
docker compose -f docker-compose.local.yml --env-file .env up -d
```

Byt `YYYYMMDD-HHMM` mot tidsstämpeln på backupen du vill återställa.

---

## Uppgradering

```bash
cd /opt/it-ticketing

# 1. Ta backup först!
./backup.sh

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
| AI-funktioner ger 503 | `ANTHROPIC_API_KEY` saknas eller ogiltig | Kontrollera `.env`, starta om backend |
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

- **E-post:** support@prefabmastarna.se
- **SLA:** Svar inom 1 arbetsdag, fix inom 5 arbetsdagar
