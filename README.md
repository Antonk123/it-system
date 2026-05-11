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

## Konfiguration

All konfiguration sker via `.env`-filen som skapas av setup-scriptet. Valfria tillägg:

- **AI:** Sätt `ANTHROPIC_API_KEY` för AI-funktioner
- **E-post:** SMTP för notifieringar, IMAP för e-post → ärende
- **Push:** VAPID-nycklar genereras automatiskt vid installation

## Licens

MIT
