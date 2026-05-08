# IT-Ticket — Handoff till Claude Code

> Statusöverlämning från Cowork-session, 2026-05-08.
> Klistra in detta i Claude Code som kontext när du återupptar arbetet.

---

## Big picture — varför vi gör det här

IT-Ticket har varit ett internt verktyg på Prefabmastarna. Vi har bestämt att packetera det som en kommersiell produkt riktat till **andra ensam-IT-administratörer på svenska SMB:s (5–50 anställda)** — främst tillverkning, fastighetsförvaltning, små handelsbolag.

**Affärsmodell: installation-per-kund**, INTE multi-tenant SaaS.
- Setup: 35 000 SEK engång
- Månadsavgift: 1 500 SEK/mån (uppdateringar, support, AI-API inkluderat)
- Mål: 3 pilotkunder Q3 2026 → 105 000 SEK initialt + 4 500 SEK MRR

Detta upplägg undviker den största arkitektoniska blockeringen (att bygga om hela datamodellen för multi-tenancy) och låter oss börja sälja på 1–2 helger.

**Differentieringen mot Zendesk/Freshdesk:** AI-nativ från grunden, svensk språkförståelse, egen Docker-instans hos kunden, ingen per-användare-licens.

Hela bakgrundsanalysen och den kompletta planen ligger i `docs/PILOT-PLAN.md` — läs den först.

---

## Vad som är gjort (kod ändrad lokalt)

### Backend, AI-integration

**Ny fil:** `server/src/lib/aiHelper.ts` (327 rader)
Tre publika async-funktioner med graceful fallback (returnerar `null` om API saknas/felar):
- `suggestCategory()` — klassificering av nya ärenden
- `draftReply()` — utkast på svar baserat på KB-artiklar via FTS-sökning
- `summarizeTicket()` — sammanfattning av långa ärenden (status / blockerare / senaste händelse)

Inkluderar token-loggning till `ai_usage_log`-tabellen och en `getUsageStats()`-helper för framtida admin-panel.

**Migration:** `server/src/db/migrations.ts` — migration `037 add_ai_columns_and_usage_log`.
Lägger till på `tickets`: `ai_suggested_category_id`, `ai_suggested_confidence`, `ai_draft_response`, `ai_draft_updated_at`, `ai_summary_json`, `ai_summary_updated_at`. Skapar tabellen `ai_usage_log` med index.

**Routes:** `server/src/routes/tickets.ts`
- Importer för `aiEnabled`, `suggestCategory`, `draftReply`, `summarizeTicket`, `stripHtml`.
- Wire-up av `suggestCategory()` i POST `/api/tickets` — kör non-blocking efter `applyAutoTags`, sparar bara om confidence > 0.6.
- Ny endpoint: `POST /api/tickets/:id/ai-draft` — söker KB via FTS, anropar `draftReply`, sparar utkastet. Skickar tillbaka `{ draft, kbArticlesUsed, kbTitles }`.
- Ny endpoint: `GET /api/tickets/:id/ai-summary` — returnerar cachad summary om < 1h gammal, annars genererar ny. Stöder `?force=1` för att tvinga regenerering.

**Dependency:** `server/package.json` — lade till `@anthropic-ai/sdk: ^0.32.1`.

### Konfig

**`docker-compose.yml` + `docker-compose.local.yml`:** Nya env-rader på backend:
```yaml
- ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
- AI_MODEL=${AI_MODEL:-}
- AI_MODEL_SMART=${AI_MODEL_SMART:-}
```

**`.env.example`** (ny fil): Mall med dokumenterade env-vars.

### Modellval

**Default-modell för ALLA tre features: Claude Haiku 4.5** (`claude-haiku-4-5-20251001`).

Resonemanget: vårt användningsfall är "extrahera info ur given KB-kontext och presentera vänligt på svenska" — Haiku är optimerad för exakt detta. Snabb (<1s), 5x billigare än Sonnet, tillräcklig kvalitet.

Escape-hatch: `AI_MODEL_SMART=claude-sonnet-4-6` uppgraderar bara `draft` + `summary` (inte categorize). Använd om en specifik pilot-kund visar sig ha komplexa ärenden där Haiku-svaren blir för generiska.

Med $10 i kredit täcker vi:
- ~25 000 kategoriseringar
- ~5 000 utkast på svar
- ~10 000 sammanfattningar

### Landningssida

**`docs/landing-page.html`** — single-file HTML med distinkt design (IBM Plex Serif/Sans/Mono, koppar + skogsgrön + crème, ingen lila/Inter). 7 sektioner: hero, AI-features, jämförelse mot Zendesk/Excel-kedjor, pris, installations-timeline, mini-case study, CTA. Kan klistras in i Carrd eller hostas standalone.

---

## Vad som ÄR INTE gjort

### 1. Commit + push

**Allt ovan ligger uncommitted i working tree.** Cowork-sessionen redigerade filer direkt utan att köra `git add`/`commit`. Påminn dig själv:

```bash
cd /Users/anton/Downloads/Github/it-system
git add server/src/lib/aiHelper.ts \
        server/src/db/migrations.ts \
        server/src/routes/tickets.ts \
        server/package.json \
        docker-compose.yml \
        docker-compose.local.yml \
        .env.example \
        docs/PILOT-PLAN.md \
        docs/landing-page.html \
        docs/HANDOFF.md
git status   # verifiera att bara dessa 10 filer är staged
git commit -m "feat: add AI helper (categorize, draft, summarize) using Haiku 4.5"
git push
```

OBS: det finns *andra* otrelaterade ändringar i repot (`.planning/codebase/*`, `claude.md`, otrackade kataloger som `.superpowers/`, `server/data/`, m.fl.). Lämna dem — de är inte från denna session.

### 2. Dev-test

Ingenting har testats i dev-miljön (`10.38.195.180:5174`). Kedjan att verifiera:

1. Push till git (steg ovan)
2. SSH eller Portainer-pull på dev-servern → `cd /opt/it-system/itticket-main && git pull`
3. Sätt `ANTHROPIC_API_KEY` i Portainer-stackens environment variables
4. "Update the stack" → Portainer drar ändringarna, `npm install` kör automatiskt och plockar upp `@anthropic-ai/sdk`
5. `docker logs it-ticketing-backend-dev -f`

Förvänta i loggen: `npm install` slutar → server startar → `037 add_ai_columns_and_usage_log` körs → vid första nya ärendet `🤖 AI-kategori föreslagen för <id>: ... (conf 0.xx)`.

**Sidnot:** dev-stackens `JWT_SECRET` är hårdkodad i compose-filen (`wfDzB+GjcdaAqkntaf9G86Qlv5FQuk2D`). Inte akut säkerhetsproblem på intern dev, men flytta till env-variabel innan stack-definitionen någonsin delas.

### 3. Frontend-UI

Backend är byggd, **frontend är inte rörd**. Tre saker återstår i `src/components/` (troligen `TicketDetail.tsx` eller motsvarande):

1. **AI-utkast-knapp:** `✨ Föreslå svar (AI)`-knapp på ärendedetalj. Klick → POST `/api/tickets/:id/ai-draft`. Visa resultatet i en redigerbar `<textarea>` med `Använd som svar`-knapp som flyttar texten till kommentarsfältet.

2. **AI-kategoriförslag-banner:** Om `ai_suggested_category_id` finns och kategori är tom på ärendet, visa banner: `🤖 AI föreslår: [kategorinamn] (78% säker) · Acceptera · Ignorera`. Acceptera = PUT på ärendet med `category_id`. Ignorera = nullställ förslaget.

3. **AI-sammanfattning-box:** På ärenden med fler än 5 kommentarer, fetcha `GET /api/tickets/:id/ai-summary` på mount och visa de tre raderna högst upp på detaljsidan: status, blockerare, senaste händelse. Liten "Uppdatera"-länk som anropar med `?force=1`.

Inget av detta är komplicerat — alla tre använder befintliga shadcn-komponenter (Button, Card, Textarea, Alert).

---

## Föreslagen ordning för Claude Code-session

1. **Verifiera lokal status** — `git status` + läs `docs/PILOT-PLAN.md` om det är längesedan
2. **Commit + push** AI-backend-arbetet (om inte redan gjort)
3. **Dev-test** — pulla på 10.38.195.180, verifiera logg, skapa ett ärende, kolla DB att `ai_suggested_category_id` fylls i
4. **Frontend-integration** — bygg de tre UI-elementen ovan
5. **Test end-to-end i dev** — skapa ärende, klicka AI-utkast-knapp, acceptera kategori, generera summary
6. **Merge/deploy till prod** — endast efter dev-validering, per CLAUDE.md-regeln "tested in dev innan push"
7. **Helg 2-arbetet** (från PILOT-PLAN.md): utöka `setup.sh`, skriv `RUNBOOK.md`, finputsa landningssidan, gör mini-case study

---

## Filer att läsa först i Claude Code

| Prio | Fil | Varför |
|------|-----|--------|
| 1 | `docs/PILOT-PLAN.md` | Hela strategin + 2-helgers backlog |
| 2 | `docs/HANDOFF.md` | (denna fil) |
| 3 | `server/src/lib/aiHelper.ts` | Förstå AI-kontraktet |
| 4 | `server/src/routes/tickets.ts` (rader 1130–1310) | Wire-up och nya endpoints |
| 5 | `docs/landing-page.html` | Säljvinkeln när du tappar fokus |

---

## Snabbreferens — viktiga beslut

- **Modell:** Haiku 4.5 default på alla tre features. Escape-hatch via `AI_MODEL_SMART`.
- **Multi-tenancy:** skjuts till efter pilot. Per-kund-installation undviker problemet helt.
- **Tester:** noll testtäckning idag. För pilot räcker manuell verifiering. Börja med tester på AI-helpern + auth-flödet *efter* första pilotkunden.
- **GDPR:** Anthropic är OK för pilot, måste upp på avtal för större kunder. Logga inga personuppgifter i prompts om möjligt.
- **AI-utkast får ALDRIG auto-skickas.** Måste alltid godkännas av människa. Tydligt i UI: "AI-utkast — granska innan du skickar."
- **Kärnflödet får aldrig blockeras av AI-fel** — alla AI-funktioner returnerar `null` vid fel, kategorisering är non-blocking i POST.

---

*Slut på handoff. Lycka till med ryket — det är snubblande nära att bli en riktig produkt.*
