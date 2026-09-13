# IT-Ticket — Developer Guide

## Project Overview

**IT-Ticket** är ett ärendehanteringssystem för intern IT-support på Prefabmästarna. Fokus är ärenden, kunskapsbas, e-post och praktiska arbetsflöden för intern användning. SLA, fakturering och tidsregistrering är avvecklade; historiska data bevaras.

Inriktning: intern användning. Ingen multi-tenancy — en instans per deployment.

## Tech Stack

| Lager | Teknologi |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, react-router, Tailwind CSS, shadcn/ui, Framer Motion, TipTap, @tanstack/react-query |
| Backend | Node.js, Express 5, TypeScript |
| Databas | SQLite via better-sqlite3, FTS5 contentless för fulltext |
| AI | Anthropic Claude SDK (deflection, draft, summary, kategorisering) |
| Mail | ImapFlow + @azure/msal-node (M365 OAuth2 client credentials) |
| Auth | JWT access tokens (15 min) + rolling refresh tokens, API-nycklar (SHA-256), CSRF (csrf-csrf), webhooks HMAC-signerade |
| PWA | vite-plugin-pwa med Workbox |

## Kommandon (lokalt)

Repo:t har **två** package.json — root (frontend) och `server/` (backend) — med separata vitest-sviter och beroenden. Node **22** (`.nvmrc`).

| Var | Kommando | Syfte |
|-----|----------|-------|
| root | `npm run dev` / `npm test` / `npm run lint` / `npm run build` | Vite dev · frontend-tester · ESLint hela repo:t · prod-build |
| `server/` | `npm run dev` / `npm test` / `npm run build` | tsx watch · backend-tester · `tsc` + kopiera `schema.sql` |

Lokal helhet: `docker-compose.local.yml`.

## Infrastruktur & Hosting

- **Host**: Proxmox-server med Docker via Portainer (stack `it-ticket-system`, id 39)
- **Git**: [GitHub — Antonk123/it-system](https://github.com/Antonk123/it-system)
- **Server-SSH**: `ssh <server>` — riktigt host-värde i `CLAUDE.local.md` (gitignorad); repo på `/opt/it-system/itticket-main`

### Miljöer

| Miljö | URL | Syfte |
|-------|-----|-------|
| **Prod** | `https://ticket.prefabmastarna.se` | Live-system |
| **Lokal (hot-reload)** | `npm run dev` (Vite :5173) + `cd server && npm run dev` (tsx :3001) | **Test-ytan före push.** Här granskas UI och körs debug-loopar. |
| **Lokal (byggd)** | `docker-compose.local.yml` (:8082 / :3002) | Kör prod-imagerna lokalt när själva bygget ska testas, inte källkoden. |

> Det fanns tidigare en dev-stack på servern (Portainer id 40, portar 5174/3003).
> Den avvecklades 2026-09-13 — den användes sällan, dess backend hade legat död i
> ~9 dagar obemärkt, och localhost täcker samma behov. Återuppliva den inte utan
> att först läsa beslutet i Obsidian (`Projekt/IT-System/decisions.md`).

### Portar

| Tjänst | Intern port | Extern port |
|--------|-------------|-------------|
| Backend (Express API, prod) | 3001 | 3002 |
| Frontend (nginx/prod) | 80 | 8082 |
| Backend lokalt (tsx watch) | 3001 | — |
| Frontend lokalt (Vite) | 5173 | — |

`Dockerfile.client` bakar in `VITE_API_URL` som build-time `ARG` — den kan alltså **inte** sättas vid container-runtime, bara vid image-bygget. För runtime-flexibilitet krävs en JS-config som injiceras i `index.html`.

### Kritiska env-vars (prod)

`JWT_SECRET`, `CSRF_SECRET`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, `VAPID_*`, `SMTP_*`, `IMAP_*` (host/port/user/secure/poll, samt OAuth: `IMAP_TENANT_ID`/`CLIENT_ID`/`CLIENT_SECRET`).

Backend `process.exit(1)` om `CSRF_SECRET` eller `JWT_SECRET` **saknas** — ovillkorligt i alla miljöer (CSRF: `server/src/app.ts`, JWT: `server/src/config/passport.ts`; **inte** `index.ts`). Är secret satt men **kortare än 32 tecken** failar den också closed (`process.exit(1)`) — utom när `ALLOW_WEAK_SECRETS=1` **och** `NODE_ENV` ∈ `development`/`test` (dubbel-gate), då bara en varning loggas. Portainer-stack-filen är **separat** från repo-versionen — nya env-rader måste läggas till manuellt i Portainer GUI (se `Projekt/IT-System/lessons.md`).

## Deployment

Standardflöde: lokal utveckling → `git push` → SSH till servern, `git pull` + bygg nödvändiga images (**Claude får göra detta** — `docker build`) → **Anton redeployar i Portainer**. Claude kör aldrig `docker run`, `docker compose up/down` eller annan container-livscykel **från terminalen** — då skapas containrar utanför Portainers hantering så Portainer tappar kopplingen/översikten över dem. Att bygga images är OK.

1. Gör ändringar lokalt (testa via `docker-compose.local.yml` vid behov)
2. `git push` till GitHub
3. SSH till servern: `ssh <server>` (se `CLAUDE.local.md`)
4. `cd /opt/it-system/itticket-main && git pull`
5. Bygg bara nödvändiga images (identifiera om ändring är frontend/backend/båda):
   - Backend: `docker build -t it-ticketing-backend:latest -f Dockerfile.server .`
   - Frontend: `docker build -t it-ticketing-frontend:latest -f Dockerfile.client .`
6. Anton redeployar via Portainer

> [!warning] Portainer-stacken är en SEPARAT kopia av compose-filen
> Stack 39:s definition lever i Portainers GUI, inte i repot. `git pull` på servern
> uppdaterar den **aldrig** — och det gäller *hela* filen, inte bara env-rader:
> `command:`, `volumes:`, `ports:` och `image:` kan alla divergera tyst.
> Ändrar du `docker-compose.yml` i repot måste Anton klistra in den nya versionen
> i Portainer-GUI:t och redeploya, annars körs den gamla definitionen vidare.
>
> Verifiera vad som faktiskt körs innan du felsöker:
> `ssh <server> "docker inspect <container> --format '{{json .Config.Cmd}}'"`
>
> Precedens: dev-stacken crash-loopade 13 117 gånger i ~9 dagar för att `--ignore-scripts`
> fanns i repots compose-fil men aldrig klistrades in i Portainer (2026-09-13).

## Projektspecifika regler

- Husky pre-commit kör lint-staged. Skippa aldrig `--no-verify`.
- ESLint `no-restricted-syntax` blockerar raw `fetch('/api/...')` — alla mutating-anrop ska gå via `api.request()` i `src/lib/api.ts` (för CSRF-token + auth-header + 401-refresh).
- DB-migrations måste in i `migrations.ts`-arrayen (`runMigrations()` i `initializeDatabase()`). Standalone `npx tsx`-scripts körs inte vid serverstart.
- **Två installationsvägar måste landa i samma schema:** prod är *uppgraderad* (ALTER för ALTER sedan feb 2026), CI/dev/nya installationer är *fresh* (dagens `schema.sql`). `server/src/db/schema-path-parity.test.ts` kör båda och fäller på skillnader — se `db-migration`-skillen för fällorna (index inuti `columnExists`-guard, retrofittad kolumn deklarerad inline, rebuild av tabell med CASCADE-barn).
- Dokumentera lärdomar i Obsidian: `Projekt/IT-System/lessons.md`
- Obsidian-dokumentation i övrigt: se `Projekt/IT-System/` i vaultet
- Generella arbetsregler (plan mode, verifiering, subagenter, kvalitet) ärvs från `~/.claude/CLAUDE.md`

## Automatiseringar (projektets egna)

Detta register laddas varje session så Claude vet vad som finns och *när* det ska användas — du ska aldrig behöva minnas att köra något manuellt. **Lägg till nya hooks/skills/agenter här när de skapas.**

**Hur de fyrar:**
- **Hooks** → körs av Claude Code automatiskt på tool-events (noll minnesbörda).
- **Subagenter** → auto-fyrar *inte*; Claude anropar dem själv när tasken matchar tabellen nedan. Det här registret + agenternas description är det som gör att Claude vet att de finns.
- **Skills** → model-invocable skills väljer Claude själv via sin description.
- **MCP-servrar** → verktygen blir tillgängliga varje session; Claude väljer dem när uppgiften matchar.

### Subagenter (`.claude/agents/`)

| Agent | Anropa när |
|-------|-----------|
| `security-reviewer` | Diff rör auth/secrets/CSRF/JWT/API-nycklar/webhooks/HMAC, ny Express-route, raw SQL med template-literals (`SET ${...}`), `dangerouslySetInnerHTML`, eller före merge av säkerhetskänsligt arbete. |
| `a11y-ui-reviewer` | Frontend-ändring i `src/components/**` / `src/pages/**`, dialoger/forms/tabeller/Kanban (dnd-kit), nya interaktiva element, eller före merge av en frontend-feature. |
| `db-migration-reviewer` | Diff rör `server/src/db/migrations.ts` eller `schema.sql`, ny CREATE/ALTER/DROP-DDL, FTS5-ändring, eller "varför kördes inte min migrering". |
| `ai-integration-reviewer` | Diff rör `server/src/lib/aiHelper.ts`, `/ai-suggest` eller andra AI-routes, `client.messages.create`, modell-fallback/`max_tokens`/prompt-bygge från ärende-/mejltext, eller AI-kostnad/modell-id. |
| `bug-detective` | Buggrapport, oväntat beteende, UX-/prestanda-regression (befintlig). |
| `code-reviewer` | Efter avslutat större steg, före merge mot main (befintlig). |

### Hooks (`.claude/settings.json`)

Körs automatiskt av Claude Code — du behöver inte göra något. Kräver `jq`.

| Hook | Event | Vad |
|------|-------|-----|
| `.env`-skydd | PreToolUse `Write\|Edit` | Blockerar redigering av `.env*` (släpper `.env.example`) — skyddar secrets. |
| Portainer-skydd | PreToolUse `Bash` | Blockerar container-livscykel från terminal — `compose up/down/...`, `run/create/start/stop/restart/rm/kill/pause`, samt `container`/`stack`/`service`/`prune`-subkommandon (krockar med Portainer-stackarna). Tål flaggor mellan `compose` och verbet (t.ex. `-f <fil>`) och **strippar citerade strängar** först → blockerar inte längre commit-/echo-text som bara *nämner* kommandona. Bygg/läs-kommandon (`build/ps/logs/exec/inspect/images/pull`) släpps. |
| migrations-påminnelse | PostToolUse `Write\|Edit` | Påminner om `migrations.ts`-arrayen vid ändringar under `server/src/db/`. |

(En 4:e föreslagen hook — `eslint --fix` per edit — valdes bort medvetet; eslint körs ändå i CI + via lint-staged.)

### Skills (`.claude/skills/`)

| Skill | Triggar | Auto? |
|-------|---------|-------|
| `db-migration` | DB/schema/migration-arbete — säkrar `migrations.ts`-arrayen + `schema.sql`-synk + FTS5. | ✅ Claude auto-väljer |
| `express-api-route` | Ny/ändrad endpoint — auth/CSRF/parametriserad SQL/mount + `api.request`. | ✅ Claude auto-väljer |
| `deploy-it-ticket` | Deploy-runbooket: gates → push → SSH `git pull` → `docker build` (Claude bygger image). **Anton** redeployar i Portainer; aldrig `docker run`/`compose up` från terminal. | ✅ Claude auto-väljer — men ENDAST vid explicit deploy-/ship-begäran (gatas av skillens description + hard rules) |

### MCP-servrar

| Server | Vad | Scope |
|--------|-----|-------|
| `sqlite-itticket-ro` | Read-only-frågor mot lokala dev-DB:n (`tools/sqlite-mcp/`, better-sqlite3 `readonly`) — använd istället för engångs-`tsx`-scripts för att inspektera schema/migrationer/FTS5. Verktyg: `list_tables`, `describe_table`, `read_query`. | lokal (per maskin; `.mcp.json` gitignorad). Registrera: se `tools/sqlite-mcp/README.md`. |

Redan anslutna på harness-/plugin-nivå (dubblera inte): context7, playwright, supabase, claude_ai (Gmail/Calendar/Drive/M365). GitHub nås via `gh` CLI — ingen MCP.

## UI-arbete

IT-Ticket har **redan** ett designsystem (Tailwind + shadcn/ui + CSS-var-teman). Standardjobbet är
förfining inuti det systemet — inte att ta fram en ny visuell identitet. Välj lager efter det:

| Situation | Arbetssätt |
|---|---|
| **Ändra befintlig vy** (default) | Skärmdumpsloop, se nedan. Ingen ny palett, inga nya typsnitt — återanvänd befintliga tokens och shadcn-komponenter. |
| **Ny yta utan förebild i appen** | `frontend-design`-skillen först: tokenplan + ASCII-wireframe → självkritik mot anti-slop-listan → sedan kod. |
| **Vill jämföra riktningar** | `/design` (canvas-artboards Anton kan dra i) eller `gsd-sketch` (2–3 slit-och-släng-HTML). Före kod, inte istället för. |
| **Före merge** | `a11y-ui-reviewer`-agenten — obligatorisk vid diff mot `src/components/**` eller `src/pages/**`. |

### Skärmdumpsloop (default för all UI-ändring)

Textbeskrivningar av UI är otillförlitliga. Titta på resultatet.

1. **Starta lokalt.** `npm run dev` (Vite :5173). För inloggade vyer behövs även
   backenden: `cd server && npm run dev` (:3001). Enbart frontend räcker för
   layout-, tema- och responsivitetsgranskning.
2. Öppna vyn via Claude Browser eller Playwright-MCP. Logga in en gång — sessionen persisterar
   över iterationer.
3. Skärmdump **före** och **efter** varje ändring — även `mobile`-viewport (375×812), inte bara desktop.
4. **Tema byts via localStorage, inte `colorScheme`.** Appen kör `enableSystem={false}`, så
   `prefers-color-scheme`-emulering gör *ingenting* — en "mörkt läge verifierat"-slutsats från den
   spaken är alltid falsk. Tre oberoende klasser på `<html>`, nycklar i `src/lib/appearance.ts`:

   | localStorage-nyckel | Värden | Default |
   |---|---|---|
   | `app-mode-theme` | `light`, `dark` | `light` |
   | `theme` | `theme-default`, `theme-midnight`, `theme-graphite`, `theme-stone`, `theme-linear`, `theme-spotify` | `theme-default` |
   | `app-font-theme` | `font-jakarta`, `font-crimson`, `font-libre`, `font-jetbrains`, `font-inter` | `font-inter` |

   Sätt nyckeln, **ladda om**, och bekräfta med `document.documentElement.className`
   (ska bli t.ex. `font-inter dark theme-stone`).
5. Vid tveksamhet: skicka **bara skärmdumpen** till en subagent utan kontext och fråga "vad är fel
   här?". En informerad läsare läser in avsikten och missar det en användare faktiskt ser.

### Estetik-skills — vilken, när

- **`frontend-design`** (plugin, Anthropic) — förstahandsval när en ny visuell riktning verkligen
  behövs. Tvingar plan → självkritik → kod och jagar konkreta AI-slop-tells (cream #F4F1EA + serif +
  terracotta #D97757, SaaS-kortkittet, ALL-CAPS-eyebrows, `→` i knapptext, `01/02/03`-markörer på
  innehåll som inte är en sekvens).
- **`ui-ux-pro-max`** — använd **bara** pre-delivery-checklistan och mätvärdena: kontrast 4.5:1,
  touch 44×44pt, animation 150–300 ms, breakpoints 375/768/1024/1440, 4/8dp-spacing.
  Kör **inte** `search.py --design-system` i det här repot — den föreslår en ny palett och typografi
  ur en fast databas och krockar med appens befintliga system.
- **`anthropic-skills:frontend-aesthetics`** — delmängd av `frontend-design`. Hoppa över.

## Obsidian-skills — auto-trigg (gäller allt vault-arbete)

Trigg-registret ligger i globala `~/.claude/CLAUDE.md` → Kunskapsbas → **"Obsidian-skills — register"**.
Claude konsulterar det själv — Anton ska aldrig behöva be om en skill. Kort:

| Skill | Trigga när |
|-------|-----------|
| `obsidian:obsidian-markdown` | **Alltid** vid skapa/redigera `.md` i `~/Obsidian` (properties, `[[wikilinks]]`, callouts) |
| `obsidian:obsidian-bases` | Översikt/index/filtrerad vy över noter → `.base` i stället för handskriven lista |
| `obsidian:json-canvas` | Något ska förklaras visuellt (arkitektur, flöde, beslutsträd) → `.canvas` |
| `obsidian:obsidian-cli` | Sök över hela vaultet, eller Obsidian-plugin/tema-debug (kräver att appen körs) |
| `obsidian:defuddle` | Anton klistrar in en artikel-/dok-URL som ska läsas eller sparas |

Dokumentation för det här projektet skrivs till `~/Obsidian/Projekt/IT-System/`
(`decisions.md`, `bugs.md`, `notes.md`, `SUMMARY.md`) — inte i repot.
