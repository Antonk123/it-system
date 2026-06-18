# IT-Ticket — Developer Guide

## Project Overview

**IT-Ticket** är ett ärendehanteringssystem positionerat som open source-alternativ till Jira/Freshdesk för IT-konsulter. Drivs i prod på Prefabmästarna men byggs som generell produkt (multi-user med roller, API-nycklar, webhooks, mail-to-ticket, AI-features, fakturering, SLA).

Affärsmodell: open source + betald support/managed hosting. Ingen multi-tenancy — en instans per deployment.

## Tech Stack

| Lager | Teknologi |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Framer Motion, TipTap, @tanstack/react-query |
| Backend | Node.js, Express 4, TypeScript |
| Databas | SQLite via better-sqlite3, FTS5 contentless för fulltext |
| AI | Anthropic Claude SDK (deflection, draft, summary, kategorisering) |
| Mail | ImapFlow + @azure/msal-node (M365 OAuth2 client credentials) |
| Auth | JWT access tokens (15 min) + rolling refresh tokens, API-nycklar (SHA-256), CSRF (csrf-csrf), webhooks HMAC-signerade |
| PWA | vite-plugin-pwa med Workbox |

## Infrastruktur & Hosting

- **Host**: Proxmox-server med Docker via Portainer (stack `it-ticket-system`, id 39)
- **Git**: [GitHub — Antonk123/it-system](https://github.com/Antonk123/it-system)
- **Server-SSH**: `ssh root@10.38.195.180`, repo på `/opt/it-system/itticket-main`

### Miljöer

| Miljö | URL | Syfte |
|-------|-----|-------|
| **Prod** | `https://ticket.prefabmastarna.se` | Live-system |
| **Dev** | `http://10.38.195.180:5174/` | Hot-reload-miljö på servern (bara `git pull` behövs) |
| **Lokal** | `localhost` via `docker-compose.local.yml` | Lokal dev för att testa innan push |

### Portar

| Tjänst | Intern port | Extern port |
|--------|-------------|-------------|
| Backend (Express API, prod) | 3001 | 3002 |
| Backend (dev, tsx watch) | 3001 | 3003 |
| Frontend (nginx/prod) | 80 | 8082 |
| Frontend (Vite/dev) | 5173 | 5174 |

### Kritiska env-vars (prod)

`JWT_SECRET`, `CSRF_SECRET`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, `VAPID_*`, `SMTP_*`, `IMAP_*` (host/port/user/secure/poll, samt OAuth: `IMAP_TENANT_ID`/`CLIENT_ID`/`CLIENT_SECRET`).

Backend `process.exit(1)` om `CSRF_SECRET` saknas — **ovillkorligt, även i dev** (server/src/index.ts, ingen NODE_ENV-gate, ingen fallback). Gäller även `JWT_SECRET` i prod. Portainer-stack-filen är **separat** från repo-versionen — nya env-rader måste läggas till manuellt i Portainer GUI (se `Projekt/IT-System/lessons.md`).

## Deployment

Standardflöde: lokal utveckling → push → Anton bygger images via SSH → **Anton redeployar i Portainer**. Claude kör aldrig `docker-compose up`, `docker run` eller container-livscykel-kommandon — det skapar separat stack som krockar med Portainer.

1. Gör ändringar lokalt (testa via `docker-compose.local.yml` vid behov)
2. `git push` till GitHub
3. SSH till servern: `ssh root@10.38.195.180`
4. `cd /opt/it-system/itticket-main && git pull`
5. Bygg bara nödvändiga images (identifiera om ändring är frontend/backend/båda):
   - Backend: `docker build -t it-ticketing-backend:latest -f Dockerfile.server .`
   - Frontend: `docker build -t it-ticketing-frontend:latest -f Dockerfile.client .`
6. Anton redeployar via Portainer

**Dev-miljön** är Portainer-stack `it-system-dev` (id 40), definierad i `docker-compose.dev.portainer.yml` (versionsspårad källa — Portainer-GUI:t måste spegla den). Den har **egen DB-volym** (`it-ticketing-dev-data`) → delar INTE prod-DB:n, men **delar prod-byggets checkout** `/opt/it-system/itticket-main` (på `main`; worktreet `itticket-dev` togs bort 2026-06-17 när vi gick över till merga-rakt-till-main). Synka dev till senaste main: `git -C /opt/it-system/itticket-main pull --ff-only` (eller `reset --hard origin/main`); tsx watch + Vite hot-reloadar, ingen rebuild. Prod ser inget förrän ny image byggs + deployas. Se `docs/dev-db-isolation-runbook.md`.

## Projektspecifika regler

- Husky pre-commit kör lint-staged. Skippa aldrig `--no-verify`.
- ESLint `no-restricted-syntax` blockerar raw `fetch('/api/...')` — alla mutating-anrop ska gå via `api.request()` i `src/lib/api.ts` (för CSRF-token + auth-header + 401-refresh).
- DB-migrations måste in i `migrations.ts`-arrayen (`runMigrations()` i `initializeDatabase()`). Standalone `npx tsx`-scripts körs inte vid serverstart.
- Dokumentera lärdomar i Obsidian: `Projekt/IT-System/lessons.md`
- Obsidian-dokumentation i övrigt: se `Projekt/IT-System/` i vaultet
- Generella arbetsregler (plan mode, verifiering, subagenter, kvalitet) ärvs från `~/.claude/CLAUDE.md`

## Frontend Aesthetics

<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:

Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.

Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.

Motion: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.

Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics. You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this: it is critical that you think outside the box!
</frontend_aesthetics>
