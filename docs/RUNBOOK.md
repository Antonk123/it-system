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

## Daglig backup

### Manuell backup

```bash
# Stoppa skrivningar tillfälligt (valfritt, SQLite hanterar concurrent reads)
BACKUP_DIR="/opt/it-ticketing/backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M)

# Kopiera databas och uppladdningar från Docker-volymen
docker run --rm \
  -v it-ticketing-data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c "
    cp /data/database.sqlite /backup/database-${TIMESTAMP}.sqlite
    tar czf /backup/uploads-${TIMESTAMP}.tar.gz -C /data uploads/
  "

echo "Backup klar: $BACKUP_DIR/database-${TIMESTAMP}.sqlite"
```

### Automatisk backup (cron)

```bash
# Lägg till i root-crontab: crontab -e
0 3 * * * /opt/it-ticketing/backup.sh >> /var/log/it-ticketing-backup.log 2>&1
```

Skapa `/opt/it-ticketing/backup.sh`:

```bash
#!/bin/bash
set -e

# Läs .env om den finns (gör BACKUP_RETENTION_DAYS tillgänglig)
ENV_FILE="/opt/it-ticketing/.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

BACKUP_DIR="/opt/it-ticketing/backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M)
RETENTION="${BACKUP_RETENTION_DAYS:-7}"

docker run --rm \
  -v it-ticketing-data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c "
    cp /data/database.sqlite /backup/database-${TIMESTAMP}.sqlite
    tar czf /backup/uploads-${TIMESTAMP}.tar.gz -C /data uploads/
  "

# Behåll $RETENTION dagars backups (styrs av BACKUP_RETENTION_DAYS i .env, default 7)
find "$BACKUP_DIR" -name "database-*.sqlite" -mtime +"${RETENTION}" -delete
find "$BACKUP_DIR" -name "uploads-*.tar.gz" -mtime +"${RETENTION}" -delete

echo "$(date): Backup klar — database-${TIMESTAMP}.sqlite (retention: ${RETENTION}d)"
```

```bash
chmod +x /opt/it-ticketing/backup.sh
```

### Off-site backup (rekommenderas)

Automatiska backupar sparas i samma Docker-volym som databasen. Vid disk-haveri på hosten försvinner både databas och backupfiler. Kopiera därför backuparna till ett externt mål med [rclone](https://rclone.org/).

**Konfigurera rclone** (kör en gång):

```bash
# Installera
curl https://rclone.org/install.sh | sudo bash

# Konfigurera ett mål — välj provider (S3, B2, Azure, SFTP, …)
rclone config
# Följ guiden, ge destinationen ett namn, t.ex. "backup-s3"
```

**Cron — kopiera backupar nattligen** (lägg till med `crontab -e`):

```bash
# Kör varje natt kl 04:30 (30 min efter automatisk backup)
30 4 * * * rclone copy /opt/it-ticketing/backups backup-s3:it-ticketing-backups/ \
  --log-file /var/log/it-ticketing-rclone.log \
  --log-level INFO
```

Byt `backup-s3:it-ticketing-backups/` mot ditt rclone-mål och bucket-/container-namn. Använd `rclone ls backup-s3:it-ticketing-backups/` för att verifiera att filer laddas upp.

**Retention off-site** — rclone kopierar bara nya filer. Sätt bucket lifecycle rules (S3/B2) eller lägg till `--min-age`/`--max-age` för att styra hur länge filer bevaras off-site oberoende av lokal retention.

---

## Restore

### Restore databas

```bash
cd /opt/it-ticketing

# 1. Stoppa systemet
docker compose -f docker-compose.local.yml --env-file .env down

# 2. Kopiera backup till volymen
docker run --rm \
  -v it-ticketing-data:/data \
  -v /opt/it-ticketing/backups:/backup:ro \
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
