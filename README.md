# IT Ticket System

## Features

- Ärendehantering med full livscykel, anpassade fält och mallar
- Kunskapsbas med fulltext-sökning (FTS5)
- AI-stöd: svarsförslag, sammanfattning, kategorisering, deflection-portal
- Tidsrapportering och fakturering per kund
- E-post → ärende (IMAP-polling med OAuth2)
- Web push-notiser och e-postnotifieringar
- Multi-user med roller och API-nycklar
- 6 teman, PWA, responsiv design

## Snabbstart

Kräver Docker och Docker Compose.

### Automatisk installation (rekommenderat)

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/Antonk123/it-system/main/setup.sh)
```

Scriptet guidar dig genom konfigurationen och startar systemet. När det är klart visas URL och inloggningsuppgifter.

### Lokal utveckling

```sh
git clone https://github.com/Antonk123/it-system.git
cd it-system
cp .env.example .env          # Fyll i JWT_SECRET och CSRF_SECRET
# Lägg till i .env vid lokal körning (docker-compose.local kör NODE_ENV=production):
# CORS_ORIGIN=http://localhost:8082
docker compose -f docker-compose.local.yml up --build
```

Frontend: `http://localhost:8082` — Backend: `http://localhost:3002/api`

### Miljövariabler

All konfiguration sker via `.env`. Se [`.env.example`](.env.example) för dokumenterade variabler.

| Variabel | Krävs | Beskrivning |
|----------|-------|-------------|
| `JWT_SECRET` | Ja | JWT-signeringsnyckel |
| `CSRF_SECRET` | Ja (prod) | CSRF-tokensignering |
| `CORS_ORIGIN` | Ja (prod) | Tillåtna origins (kommaseparerat) |
| `APP_BASE_URL` | Ja | Bas-URL för länkar i mejl |
| `BRAND_NAME` | Nej | Varumärke i utgående mejl (default: `IT-Support`) |
| `ANTHROPIC_API_KEY` | Nej | Aktiverar AI-funktioner |
| `AI_MODEL` | Nej | Claude-modell för AI-funktioner (default: Haiku 4.5) |
| `AI_MODEL_SMART` | Nej | Starkare modell för draft och summary |
| `AI_MONTHLY_TOKEN_LIMIT` | Nej | Circuit-breaker för månatlig tokenanvändning (default: 5 000 000) |
| `AUTO_CLOSE_DAYS` | Nej | Dagar tills lösta ärenden stängs automatiskt (default: 30) |
| `BACKUP_RETENTION_DAYS` | Nej | Antal dagar att behålla automatiska backupar (default: 7) |
| `PUSH_AGING_DAYS` | Nej | Push-notis om ärenden utan uppdatering i X dagar (default: 7) |
| `SMTP_HOST/PORT/USER/PASS` | Nej | Utgående e-post |
| `IMAP_HOST/PORT/USER` | Nej | E-post → ärende |
| `VAPID_PUBLIC_KEY/PRIVATE_KEY` | Nej | Push-notiser |

## API-översikt

Alla endpoints ligger under `/api`. Autentisering via JWT Bearer-token. CSRF-skydd via `X-CSRF-Token`-header.

| Endpoint | Beskrivning |
|----------|-------------|
| `POST /api/auth/login` | Logga in, få JWT + refresh token |
| `GET /api/tickets` | Lista ärenden (filter, sökning, paginering) |
| `POST /api/tickets` | Skapa ärende |
| `GET /api/tickets/:id` | Hämta ärende med kommentarer |
| `PUT /api/tickets/:id` | Uppdatera ärende |
| `GET /api/contacts` | Lista kontakter/kunder |
| `GET /api/companies` | Lista företag |
| `GET /api/categories` | Lista kategorier |
| `GET /api/tags` | Lista taggar |
| `GET /api/templates` | Ärendemallar |
| `GET /api/kb` | Kunskapsbas-artiklar |
| `GET /api/reports/*` | Rapporter och statistik |
| `GET /api/billing/*` | Fakturering per kund |
| `GET /api/sla` | SLA-konfiguration och status |
| `GET /api/webhooks` | Webhook-konfiguration |
| `GET /api/api-keys` | API-nyckelhantering |
| `GET /api/time-entries` | Tidsrapportering |
| `GET /api/recurring` | Återkommande ärenden |
| `POST /api/email-inbound/*` | Inkommande e-post → ärende |
| `GET /api/backup` | Ladda ner backup (admin) |
| `POST /api/backup/restore` | Återställ backup (admin) |
| `GET /api/health` | Hälsokontroll |

Se respektive routfil i `server/src/routes/` för fullständig dokumentation.

## Tech stack

| Lager | Teknologi |
|-------|-----------|
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Node.js, Express, TypeScript |
| Databas | SQLite via better-sqlite3, FTS5 |
| AI | Claude API (Anthropic) |
| Deploy | Docker (nginx + Node), Docker Compose |

## Portainer

Om du föredrar att hantera containers via Portainer istället för Docker Compose:

1. Klona och bygg images:
```sh
git clone https://github.com/Antonk123/it-system.git /opt/it-ticketing
cd /opt/it-ticketing
docker build -t it-ticketing-backend:latest -f Dockerfile.server .
docker build -t it-ticketing-frontend:latest -f Dockerfile.client .
```

2. Skapa en **Stack** i Portainer med innehållet från [`docker-compose.local.yml`](docker-compose.local.yml) (genereras av setup.sh), eller skapa containers manuellt.

3. Konfigurera environment-variabler i Portainer — se [`.env.example`](.env.example) för alla tillgängliga variabler. Minst dessa krävs:
   - `JWT_SECRET` — generera med `openssl rand -base64 32`
   - `CSRF_SECRET` — generera med `openssl rand -base64 32`
   - `CORS_ORIGIN` — din app-URL
   - `APP_BASE_URL` — samma som ovan

4. Initiera databasen:
```sh
docker exec -e ADMIN_EMAIL="admin@example.com" \
  -e ADMIN_PASSWORD="DittLösenord123!" \
  -e ADMIN_NAME="Admin" \
  it-ticketing-backend node dist/db/init.js
```

## Konfiguration

All konfiguration sker via `.env`-filen som skapas av setup-scriptet. Se [`.env.example`](.env.example) för alla tillgängliga variabler med dokumentation.

- **AI:** Sätt `ANTHROPIC_API_KEY` för AI-funktioner
- **E-post:** SMTP för notifieringar, IMAP för e-post → ärende
- **Push:** VAPID-nycklar genereras automatiskt vid installation

## Licens

MIT
