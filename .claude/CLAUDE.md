# Project Memory — it-ticketing

**Status:** 🟢 Aktiv
**Placering:** Proxmox Docker (Portainer)
**Senast uppdaterad:** 2026-02-16
**Version:** v1.3.0 (dynamiska template-fält)

**[Changelog](https://wiki.prefabmastarna.se/books/dokumentation/chapter/it-arendesystem)**

---

## Kort beskrivning

- Ett säkert ärende-/supportsystem för IT (tickets) med React + Vite frontend och en Node/Express backend.
- Frontend finns i `src/` (Vite, React, TypeScript, Tailwind, shadcn-ui, React Query).
- Backend finns i `server/` (Express, TypeScript, SQLite via better-sqlite3).
- Funktioner i koden: biljettlistor, kommentarer, bilagor, delade (public) tickets, användare, kategorier, checklistor, rapporter och dynamiska mallformulär.

---

## Grundinformation (Produktion)

| Parameter | Värde |
|-----------|-------|
| **Funktion** | IT-ärendehantering |
| **Container** | it-ticketing-backend, it-ticketing-frontend |
| **Web UI** | http://10.38.195.180:8082 |
| **Public URL** | https://ticket.prefabmastarna.se |
| **API** | http://10.38.195.180:3002/api |
| **Databas** | SQLite (Docker volume: `it-ticketing-data`) |
| **Frontend Port** | 8082 (prod) / 5173 (dev) |
| **Backend Port** | 3002 (prod) / 3001 (dev) |

## Teknisk stack

- **Frontend:** Vite, React 18, TypeScript, Tailwind CSS, @tanstack/react-query v5, react-router-dom, sonner (toasts).
- **Backend:** Node/Express (TypeScript), Passport (auth), JWT, multer (attachments), better-sqlite3 (DB), nodemailer (mail).
- **DB:** SQLite med WAL mode (Write-Ahead Logging) för bättre prestanda och concurrency.
- **Säkerhet:** JWT-autentisering, CORS-skydd, SQL-injektionsskydd, filuppladdning-validering.
- **Deployment:** Docker + Portainer, Nginx reverse proxy för HTTPS.

## Viktiga filer & mappar

### Frontend
- Entry: [src/App.tsx](src/App.tsx) - React Query konfiguration, routing
- Start: `npm run dev` i repo-root (Vite) — se [package.json](package.json)
- Hooks: [src/hooks/useTickets.ts](src/hooks/useTickets.ts), [src/hooks/useCategories.ts](src/hooks/useCategories.ts), [src/hooks/useUsers.ts](src/hooks/useUsers.ts) - React Query hooks
- Säkerhet: [src/components/SecureAttachment.tsx](src/components/SecureAttachment.tsx) - Autentiserad filhämtning, [src/lib/secureFileAccess.ts](src/lib/secureFileAccess.ts)
- Dynamic Fields (v1.3.0):
  - [src/components/DynamicField.tsx](src/components/DynamicField.tsx) - Renderar enskilt fält baserat på typ
  - [src/components/DynamicFieldsForm.tsx](src/components/DynamicFieldsForm.tsx) - Hanterar samling av dynamiska fält
  - [src/pages/PublicTicketForm.tsx](src/pages/PublicTicketForm.tsx) - Integrerar dynamiska fält, 10-raders beskrivning
- Types: [src/types/ticket.ts](src/types/ticket.ts) - TemplateField, CustomFieldInput interfaces

### Backend
- Entry: [server/src/index.ts](server/src/index.ts) - CORS-konfiguration, middleware
- Start (dev): `cd server && npm run dev` — se [server/package.json](server/package.json)
- Auth: [server/src/config/passport.ts](server/src/config/passport.ts) - JWT-strategi, obligatorisk JWT_SECRET
- DB: [server/src/db/connection.ts](server/src/db/connection.ts) - SQLite med WAL mode, template_fields och ticket_field_values tabeller
- DB init: [server/src/db/init.ts](server/src/db/init.ts) och SQL-filer i root (`migration-*.sql`)
- DB migrations: [server/src/db/](server/src/db/) - Migration scripts för template-fält
  - `add-new-user-fields.ts` - Lägger till fält för "Ny användare" mall
  - `update-prefab-fields.ts` - Uppdaterar CRM → Business Central, email placeholder
  - `remove-budget-field.ts` - Tar bort Budget-fält
  - `list-fields.ts` - Listar alla template-fält
  - `update-field-label.ts` - Uppdaterar fältetikett
- Routes: [server/src/routes/](server/src/routes/) - SQL-injektionsskydd, filuppladdning-validering
  - `template-fields.ts` - CRUD API för template-fält (v1.3.0)
  - `templates.ts` - Template management, inkluderar fält
  - `public.ts` - Public ticket submission med custom fields

### Docker & Deployment
- Development: [docker-compose.dev.yml](docker-compose.dev.yml)
- Production: [docker-compose.yml](docker-compose.yml)
- Dockerfiler: [Dockerfile.server](Dockerfile.server), [Dockerfile.client](Dockerfile.client)
- Nginx config: [nginx.conf](nginx.conf) - Reverse proxy för `/api`

### Dokumentation
- Säkerhet: [SECURITY.md](SECURITY.md) - Säkerhetsinstruktioner, produktionschecklist
- Detta dokument: [.claude/CLAUDE.md](.claude/CLAUDE.md)

## Hur man kör lokalt (snabbt)

### Development (utan Docker)
1. **Klona repo**
2. **Backend:**
   ```bash
   cd server
   npm install
   npm run dev  # Express på port 3001
   ```
3. **Frontend:**
   ```bash
   npm install
   npm run dev  # Vite på port 5173
   ```
4. **Initiera DB (första gången):**
   ```bash
   cd server
   npm run init-db
   ```

### Development (med Docker - hot-reload)
```bash
docker compose -f docker-compose.dev.yml up
```
- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- API via Nginx proxy: http://localhost:5173/api

### Production (Docker)
Se [Production Deployment](#production-deployment) nedan.

## Production Deployment

### Förutsättningar
- Docker & Docker Compose
- Portainer (eller annan container orchestrator)
- HTTPS-certifikat (via reverse proxy eller Let's Encrypt)
- Genererad JWT_SECRET: `openssl rand -base64 32`
- Repo finns på Docker-hosten: `/opt/it-system/itticket-main`
- Portar är lediga: `8082` (frontend) och `3002` (backend)

### Skapa volymer och nätverk (engångs)

```bash
# Skapa datavolym
docker volume create it-ticketing-data

# Skapa nätverk (valfritt, Portainer kan skapa automatiskt)
docker network create ticketing
```

### Docker Compose Stack (Production)

```yaml
version: "3.8"

services:
  backend:
    image: it-ticketing-backend:v1.3.0
    container_name: it-ticketing-backend
    restart: unless-stopped
    ports:
      - "3002:3001"
    volumes:
      - it-ticketing-data:/app/data
    environment:
      - NODE_ENV=production
      - JWT_SECRET=<SET_I_PORTAINER_ENV>
      - CORS_ORIGIN=https://ticket.prefabmastarna.se
      - DB_PATH=/app/data/database.sqlite
      - UPLOAD_DIR=/app/data/uploads
      - SMTP_HOST=<smtp-server>
      - SMTP_PORT=<smtp-port>
      - SMTP_USER=<smtp-användare>
      - SMTP_PASS=<smtp-lösenord>
      - EMAIL_FROM=<från-email>
      - EMAIL_TO=<till-email>
      - APP_BASE_URL=https://ticket.prefabmastarna.se
    networks:
      - ticketing

  frontend:
    image: it-ticketing-frontend:v1.3.0
    container_name: it-ticketing-frontend
    restart: unless-stopped
    ports:
      - "8082:80"
    depends_on:
      - backend
    networks:
      - ticketing

networks:
  ticketing:
    driver: bridge

volumes:
  it-ticketing-data:
    external: true
```

### Deploy från grunden (Portainer)

**1. Bygg Docker images på Docker-hosten:**

```bash
cd /opt/it-system/itticket-main

# Backend
docker build -f Dockerfile.server -t it-ticketing-backend:v1.3.0 .
docker tag it-ticketing-backend:v1.3.0 it-ticketing-backend:latest

# Frontend
docker build -f Dockerfile.client -t it-ticketing-frontend:v1.3.0 .
docker tag it-ticketing-frontend:v1.3.0 it-ticketing-frontend:latest
```

**2. Skapa Stack i Portainer:**

1. Portainer → **Stacks** → **Add stack**
2. Namn: `it-ticketing-system`
3. Klistra in Docker Compose stack från ovan
4. Sätt environment-variabeln `JWT_SECRET` (generera med `openssl rand -base64 32`)
5. **Deploy**

✅ Databasen påverkas inte av deploy (volymen ligger kvar).

**3. Kör migrations (endast för v1.3.0 uppdatering):**

Om du uppdaterar från tidigare version till v1.3.0, kör följande migrations:

```bash
# Lista alla template-fält (verifiering)
docker exec it-ticketing-backend npm run list-fields

# Lägg till fält för "Ny användare" mall (om den saknas)
docker exec it-ticketing-backend npm run add-new-user-fields

# Uppdatera fält för Prefabmästarna (CRM → Business Central, email placeholder)
docker exec it-ticketing-backend npm run update-prefab

# Ta bort Budget-fält (synkar med UI-ändringar)
docker exec it-ticketing-backend npm run remove-budget
```

**4. Verifiera deployment:**

- Backend startar utan "FATAL: JWT_SECRET" fel
- Frontend kan kommunicera med backend via `/api`
- Inga CORS eller Mixed Content errors i browser console
- Inloggning fungerar
- Testa endpoints:
  ```bash
  curl http://10.38.195.180:3002/api/health
  ```
- Öppna UI: http://10.38.195.180:8082 eller https://ticket.prefabmastarna.se

### Uppdatera befintlig deployment (Portainer)

**Metod 1: Rebuild och Update Stack**

1. Bygg nya images (samma kommandon som ovan med ny versionstagg)
2. Portainer → **Stacks** → välj `it-ticketing-system`
3. **Update the stack**
4. Uppdatera image-taggar i compose-filen om nödvändigt
5. ⚠️ Avmarkera **Pull latest image** (images byggs lokalt)
6. **Deploy**
7. Kör migrations om det finns databasändringar

✅ Databasen påverkas inte av redeploy.

**Metod 2: Recreate Containers**

```bash
# Stoppa containers
docker stop it-ticketing-backend it-ticketing-frontend

# Ta bort containers (data finns kvar i volume)
docker rm it-ticketing-backend it-ticketing-frontend

# Kör Update the stack i Portainer
```

### Dev-miljö med Portainer

Om du vill köra en dev-miljö parallellt med produktion i Portainer:

**1. Använd separata portar:**
- Frontend: `5174` (istället för 8082)
- Backend: `3003` (istället för 3002)

**2. Skapa ny stack `it-ticketing-dev` med följande compose:**

```yaml
version: "3.8"

services:
  backend-dev:
    image: it-ticketing-backend:dev
    container_name: it-ticketing-backend-dev
    restart: unless-stopped
    ports:
      - "3003:3001"
    volumes:
      - it-ticketing-data:/app/data  # Dela data med prod (valfritt)
      - ./server/src:/app/src  # Hot-reload (kräver volume mount)
    environment:
      - NODE_ENV=development
      - JWT_SECRET=<dev-secret>
      - CORS_ORIGIN=http://localhost:5174
    networks:
      - ticketing-dev

  frontend-dev:
    image: it-ticketing-frontend:dev
    container_name: it-ticketing-frontend-dev
    restart: unless-stopped
    ports:
      - "5174:80"
    depends_on:
      - backend-dev
    networks:
      - ticketing-dev

networks:
  ticketing-dev:
    driver: bridge
```

**3. Bygg dev-images:**
```bash
docker build -f Dockerfile.server -t it-ticketing-backend:dev .
docker build -f Dockerfile.client -t it-ticketing-frontend:dev .
```

**Alternativ:** Använd [docker-compose.dev.yml](docker-compose.dev.yml) direkt på hosten:
```bash
docker compose -f docker-compose.dev.yml up
```

---

### Säkerhetsförbättringar (v1.2.0 - v1.2.1)

**Implementerade:**
- ✅ CORS-skydd (endast specifika origins)
- ✅ SQL-injektionsskydd (whitelist för fältnamn)
- ✅ Filuppladdning-validering (whitelist för MIME-typer)
- ✅ JWT endast i Authorization header (ej i URL)
- ✅ Obligatorisk JWT_SECRET (system kraschar om ej satt)
- ✅ Filer serveras som `attachment` (förhindrar körning)
- ✅ React Query för caching och optimistic updates
- ✅ Säker filhämtning med autentisering (SecureImage/SecureDownloadLink)

**Dokumenterat i:** [SECURITY.md](SECURITY.md)

## Risker / uppmärksamheter

- **SQLite:** Begränsat för simultan hög belastning. För skalning överväg PostgreSQL/MySQL.
- **Docker volumes:** Var försiktig med `docker compose down -v` som tar bort volymer och data.
- **JWT_SECRET:** MÅSTE sättas i produktion. Systemet startar inte utan den.
- **HTTPS:** Kräver HTTPS i produktion för säker autentisering och cookie-hantering.
- **Backup:** SQLite-filen ligger i Docker volume `it-ticketing-data`. Säkerhetskopiera regelbundet.

---

## Backup & Återställning

✅ All data ligger i Docker-volymen `it-ticketing-data`

### Inspektera volym

```bash
docker volume inspect it-ticketing-data
```

Hitta `Mountpoint` och kopiera `database.sqlite` därifrån.

### Backup via tillfällig container

```bash
docker run --rm \
  -v it-ticketing-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/it-ticketing-backup-$(date +%Y%m%d).tar.gz /data
```

Detta skapar en tar.gz-fil med datum i filnamnet.

### Återställning från backup

```bash
docker run --rm \
  -v it-ticketing-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/it-ticketing-backup-YYYYMMDD.tar.gz -C /
```

⚠️ **Varning:** Stoppa containers innan återställning för att undvika datakorruption.

### Snabb backup (direkt från host)

```bash
# Hitta mountpoint
MOUNT=$(docker volume inspect it-ticketing-data | grep Mountpoint | cut -d'"' -f4)

# Kopiera databas
sudo cp $MOUNT/database.sqlite ~/backups/database-$(date +%Y%m%d).sqlite
```

---

## Felsökning

### Container name already in use

Om Portainer säger att namnet är upptaget:

```bash
docker rm -f it-ticketing-backend it-ticketing-frontend
```

Kör sedan **Update the stack** igen i Portainer.

### Backend startar inte - JWT_SECRET saknas

**Symptom:** Backend kraschar med "FATAL: JWT_SECRET must be set"

**Lösning:**
1. Portainer → Stacks → `it-ticketing-system` → **Environment variables**
2. Lägg till `JWT_SECRET` med värde från `openssl rand -base64 32`
3. **Update the stack**

### CORS-fel i browser console

**Symptom:** "CORS policy: No 'Access-Control-Allow-Origin' header"

**Lösning:**
1. Verifiera att `CORS_ORIGIN` environment variable är korrekt satt
2. För produktion: `CORS_ORIGIN=https://ticket.prefabmastarna.se`
3. För dev: `CORS_ORIGIN=http://localhost:5173`

### API requests går inte igenom

**Symptom:** Frontend kan inte nå backend API

**Kontrollera:**
1. Backend container körs: `docker ps | grep it-ticketing-backend`
2. Port är exponerad: `docker port it-ticketing-backend`
3. Backend loggar: `docker logs it-ticketing-backend`
4. Testa direkt: `curl http://10.38.195.180:3002/api/health`

### Databas är tom efter deploy

**Orsak:** Volymen skapades inte eller mountades fel

**Lösning:**
1. Kontrollera volym: `docker volume ls | grep it-ticketing-data`
2. Verifiera mount: `docker inspect it-ticketing-backend | grep -A5 Mounts`
3. Om volymen saknas, skapa den: `docker volume create it-ticketing-data`
4. Initiera databas: `docker exec it-ticketing-backend npm run init-db`

### Hot-reload fungerar inte i dev

**Symptom:** Ändringar i kod reflekteras inte i dev-miljön

**Lösning:**
1. Verifiera att du kör dev-compose: `docker compose -f docker-compose.dev.yml up`
2. Kontrollera volume mounts i [docker-compose.dev.yml](docker-compose.dev.yml)
3. Starta om containers: `docker compose -f docker-compose.dev.yml restart`

### Migration scripts ger fel

**Symptom:** `npm run add-new-user-fields` ger "Template not found"

**Orsak:** Mallen "Ny användare" finns inte i databasen

**Lösning:**
1. Lista templates: `docker exec it-ticketing-backend npm run list-fields`
2. Skapa mallen manuellt via admin-gränssnittet först
3. Kör migration igen

## Changelog

### v1.3.0 (2026-02-16)
- **Ny funktion:** Dynamiska template-fält - mallar kan nu ha egna formulärfält
- **Ny funktion:** Hårdvarubeställning-mall med 6 dynamiska fält:
  - Typ av utrustning (text)
  - Antal (number)
  - Motivering (textarea)
  - Leveransadress (text)
  - Specifikationer (textarea)
- **Ny funktion:** Ny användare-mall med 9 dynamiska fält:
  - Användarnamn (text)
  - E-post (text)
  - Avdelning (text)
  - Närmaste chef (text)
  - Startdatum (text)
  - Tillgång Email (text)
  - Tillgång Filserver (text)
  - Tillgång Business Central (text, tidigare CRM)
  - Övrigt (textarea)
- **Backend:** Nya tabeller `template_fields` och `ticket_field_values`
- **Backend:** Nya API-endpoints för fälthantering (`/api/templates/:id/fields`)
- **Backend:** Fälthantering via npm-scripts:
  - `list-fields` - Lista alla template-fält
  - `update-field-label` - Uppdatera fältetikett
  - `add-new-user-fields` - Lägg till fält för "Ny användare" mall
  - `update-prefab` - Uppdatera CRM → Business Central, email placeholder → @prefabmastarna.se
  - `remove-budget` - Ta bort Budget-fält
- **Frontend:** DynamicField och DynamicFieldsForm komponenter
- **Frontend:** Ökat beskrivningsfält från 5 till 10 rader
- **Frontend:** Döljer standard beskrivningsfält när template har dynamiska fält
- **Förbättring:** Dual-storage av fältdata (strukturerad + formaterad)
- **Förbättring:** Automatisk sammansättning av fältdata i ticket-beskrivning
- **Förbättring:** Validering av required-fält
- **Deployment:** Docker images v1.3.0 byggda och taggade

### v1.2.1 (2026-02-16)
- **Fix:** Frontend byggs utan hårdkodad API URL (använder relativa paths)
- **Fix:** Fungerar nu med HTTPS via nginx reverse proxy
- **Förbättring:** Ingen Mixed Content errors

### v1.2.0 (2026-02-16)
- **Säkerhet:** CORS-skydd (endast specifika origins)
- **Säkerhet:** SQL-injektionsskydd (whitelist för UPDATE-fält)
- **Säkerhet:** Filuppladdning-validering (whitelist för MIME-typer och extensions)
- **Säkerhet:** JWT endast i Authorization header (borttaget från URL)
- **Säkerhet:** Obligatorisk JWT_SECRET (kraschar vid start om ej satt)
- **Säkerhet:** Filer serveras som `attachment` istället för `inline`
- **Bugg:** Fixad tyst felhantering i `useTickets.ts`
- **Bugg:** Felhantering för fil- och checklistuppladdningar
- **Förbättring:** React Query implementation för caching och optimistic updates
- **Förbättring:** SecureImage och SecureDownloadLink komponenter
- **Dokumentation:** SECURITY.md med säkerhetsinstruktioner

### v1.1.1 (2026-02-15)
- **Fix:** Radix UI Select empty string error (ändrat till "none")

### v1.1.0 (2026-02-15)
- **Förbättring:** React Query implementation
- **Förbättring:** Save indicators och navigation prevention
- **Förbättring:** SQLite WAL mode för bättre prestanda

## Framtida förbättringar (från säkerhetsanalys)

### Hög prioritet
- Rate limiting (förhindra brute-force attacker)
- XSS-skydd i e-postmallar
- CSRF-skydd
- Ärendetilldelning (assignment till användare)
- Förbättrade e-postnotifikationer

### Medel prioritet
- Starkare lösenordspolicy (12+ tecken)
- Token refresh & revocation
- SLA-spårning
- Taggar/etiketter-system
- Färdiga svar (canned responses)

### Låg prioritet
- HTTPS-enforcing headers
- Security headers (CSP, X-Frame-Options)
- Audit logging
- Kunskapsbas / FAQ

---

## Database Management Scripts

Följande npm-scripts finns tillgängliga för databashantering:

```bash
# Lista alla template-fält för alla mallar
npm run list-fields

# Uppdatera en fältetikett
npm run update-field-label <field_name> <new_label>
# Exempel: npm run update-field-label access_crm "Business Central"

# Lägg till fält för "Ny användare" mall
npm run add-new-user-fields

# Uppdatera fält för Prefabmästarna (CRM → BC, email placeholder)
npm run update-prefab

# Ta bort Budget-fält
npm run remove-budget

# Initiera databas (första gången)
npm run init-db
```

**I Docker:**
```bash
docker exec it-ticketing-backend npm run list-fields
docker exec it-ticketing-backend npm run update-field-label access_crm "Business Central"
```

---

## Kontakt & Support

- **Säkerhetsproblem:** Se [SECURITY.md](SECURITY.md)
- **Deployment-problem:** Kontrollera environment variables och Docker logs
- **Utveckling:** Använd `docker-compose.dev.yml` för lokal utveckling med hot-reload
- **Dokumentation:** [Wiki - IT-ärendehantering](https://wiki.prefabmastarna.se/books/dokumentation/chapter/it-arendesystem)

### Relaterade Sidor

- [Changelog - IT-ärendehantering](https://wiki.prefabmastarna.se/books/dokumentation/chapter/it-arendesystem)
- [Portainer - Container Management](https://wiki.prefabmastarna.se)
- [Proxmox - Virtual Environment](https://wiki.prefabmastarna.se)
