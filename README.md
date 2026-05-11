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

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/Antonk123/it-system/main/setup.sh)
```

Scriptet guidar dig genom konfigurationen och startar systemet. När det är klart visas URL och inloggningsuppgifter.

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
