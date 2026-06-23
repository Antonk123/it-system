# IT-Ticket — Handoff till Claude Code

> Statusöverlämning från Cowork-session, uppdaterad 2026-06-23.
> Klistra in detta i Claude Code som kontext när du återupptar arbetet.
>
> **OBS (2026-06-23):** Detta dokument är delvis historiskt — AI-funktionerna nedan
> är sedan länge byggda och deployade. Aktuellt projektläge spåras i Obsidian-vaultet
> (`Projekt/IT-System/`) samt git-historiken, inte här.

---

## ⚠ VIKTIG PRODUKT-PIVOT — läs detta först

En tidigare frontend-implementation placerade en "Föreslå svar (AI)"-knapp vid **interna kommentarer**. Det är fel av två skäl:

1. Interna kommentarer är staff-anteckningar till sig själva — där behövs ingen AI som låtsas vara kundsupport.
2. AI:n vi byggde är konfigurerad för att skriva svar TILL beställaren, inte FRÅN dig till dig själv.

**Den verkliga produktidén — och det starkaste säljargumentet — är deflection-AI:** När en användare öppnar publika portalen och beskriver sitt problem ska AI:n försöka lösa det direkt baserat på KB:n, INNAN ärendet skapas. Ett exempel: Linnea skriver "Min Outlook startar inte" → AI svarar med en steg-för-steg-lösning från KB → Linnea klickar "Det löste det, tack!" → inget ärende skapas, tid sparad både för henne och IT.

Det är den vinkel som ingen konkurrent har och som faktiskt motiverar AI-stämpeln. Allt annat är sekundärt.

---

## Big picture — varför vi gör det här

IT-Ticket har varit ett internt verktyg på Prefabmastarna. Vi ompackar det som en kommersiell produkt för **andra ensam-IT-administratörer på svenska SMB:s (5–50 anställda)** — främst tillverkning, fastighetsförvaltning, små handelsbolag.

**Affärsmodell: installation-per-kund**, INTE multi-tenant SaaS.
- Setup: 35 000 SEK engång
- Månadsavgift: 1 500 SEK/mån (uppdateringar, support, AI-API inkluderat)
- Mål: 3 pilotkunder Q3 2026 → 105 000 SEK initialt + 4 500 SEK MRR

**Differentieringen mot Zendesk/Freshdesk:** AI-deflection på publika portalen, svensk språkförståelse, egen Docker-instans hos kunden, ingen per-användare-licens.

Hela bakgrundsanalysen och 2-helgers-backlogen ligger i `docs/PILOT-PLAN.md` — läs den först.

---

## AI-funktionerna i prioritetsordning

| # | Funktion | Var | Status backend | Status frontend |
|---|----------|-----|----------------|-----------------|
| 1 | **Deflection: AI löser problem före ärende skapas** | Publika portalen | ✅ Klart | ❌ INTE byggd |
| 2 | Auto-kategorisering av nya ärenden | Bakgrund vid POST /tickets | ✅ Klart | ❌ INTE byggd (banner med "AI föreslår: X · Acceptera · Ignorera") |
| 3 | Utkast på svar TILL beställaren | Ärendedetalj — staff-only | ✅ Klart | ⚠ Felplacerad (vid intern-kommentar) — flytta till lös-flödet eller ärendets header |
| 4 | Sammanfattning av långa ärenden | Ärendedetalj — staff-only | ✅ Klart | ❌ INTE byggd (3-radersbox högst upp på ärenden med >5 kommentarer) |

**OBS:** Funktion 1 är flaggskeppet. Bygg den först. Funktion 3 behöver flyttas. Funktion 2 och 4 kan komma sist.

---

## Vad som finns i kod just nu

### Backend — färdigt och inte committat (uncommitted i din working tree)

**`server/src/lib/aiHelper.ts`** (~470 rader)
Fyra publika async-funktioner med graceful fallback:
- `suggestSolutionFromKB()` — **FLAGGSKEPP**: löser problem från publika portalen via KB. Konservativ — säger hellre "vet ej" än hallucinerar.
- `suggestCategory()` — klassificering av nya ärenden
- `draftReply()` — utkast på svar TILL beställaren (för staff att granska + skicka)
- `summarizeTicket()` — sammanfattning av långa ärenden
Plus hjälpare: `buildKbSearchQuery()`, `getUsageStats()`, `aiEnabled()`.

**Migrationer:**
- `037 add_ai_columns_and_usage_log` — AI-kolumner på `tickets` + `ai_usage_log`-tabellen.
- `038 add_ai_deflections_table` — `ai_deflections` för att räkna sparade ärenden (kritisk för pilotrapportering).

**Routes:**
- `server/src/routes/tickets.ts` — `suggestCategory` wire-up i POST, plus `POST /:id/ai-draft` och `GET /:id/ai-summary`.
- `server/src/routes/public.ts` — **NY**: `POST /api/public/ai-suggest`, `PATCH /api/public/ai-suggest/:id`, `GET /api/public/ai-suggest/stats`.

**Dependency:** `server/package.json` — `@anthropic-ai/sdk: ^0.32.1`.

**Konfig:** `docker-compose.yml` + `docker-compose.local.yml` har `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_MODEL_SMART` i environment-blocket. `.env.example` dokumenterar dem.

### Modellval

**Default-modell för ALLA fyra features: Claude Haiku 4.5** (`claude-haiku-4-5-20251001`).

Vårt användningsfall är "extrahera info ur given KB-kontext och presentera vänligt på svenska" — Haiku är optimerad för det. Snabb (<1s), 5x billigare än Sonnet, tillräcklig kvalitet. Escape-hatch: `AI_MODEL_SMART=claude-sonnet-4-6` uppgraderar `draft` + `summary` (inte categorize/suggest).

Med $10 i kredit täcker vi grovt:
- ~25 000 kategoriseringar
- ~5 000 deflection-förslag (~$0,002 per anrop)
- ~5 000 utkast på svar
- ~10 000 sammanfattningar

---

## Vad som ÄR INTE gjort

### 1. Commit + push av backend (den viktigaste flaskhalsen)

Om Claude CLI redan har committat allt är detta klart — verifiera via `git log`. Annars:

```bash
cd /Users/anton/Downloads/Github/it-system
git add server/src/lib/aiHelper.ts \
        server/src/db/migrations.ts \
        server/src/routes/tickets.ts \
        server/src/routes/public.ts \
        server/package.json \
        docker-compose.yml \
        docker-compose.local.yml \
        .env.example \
        docs/PILOT-PLAN.md \
        docs/landing-page.html \
        docs/HANDOFF.md
git status   # verifiera filerna
git commit -m "feat: AI helper + deflection endpoint (Haiku 4.5 default)"
git push
```

Andra modifierade filer i repot (`.planning/codebase/*`, `claude.md`, otrackade kataloger) ska INTE med — de är från andra sessioner.

### 2. Frontend — primärt arbetspaket

Ordna i denna ordning:

**A. Deflection-UI på publika portalen (FLAGGSKEPP — bygg först)**

I komponenten för publika ärendeformuläret (sannolikt `src/pages/PublicSubmit.tsx` eller liknande):

- När användaren skrivit minst 20 tecken i problembeskrivningen, visa knapp **"🪄 Få hjälp direkt"** under fältet.
- Klick → POST `/api/public/ai-suggest` med `{ problemText, userEmail }`.
- Visa svaret i en modal eller ett expanderat avsnitt:
  - Om `hasSolution=true`: visa `solution` i markdown, lista `kbReferences` med titel, två knappar **"✓ Det löste problemet"** och **"Behöver fortfarande hjälp"**.
  - Om `hasSolution=false`: visa "Jag hittade ingenting i KB:n som matchar — beskriv ditt problem och skapa ärendet" + en knapp **"Fortsätt till ärende"**.
- Vid "Det löste problemet": PATCH `/api/public/ai-suggest/:deflectionId` med `{ outcome: 'solved' }`. Visa tackmeddelande, stäng formuläret.
- Vid "Behöver fortfarande hjälp" eller efter ärendeskapande: PATCH med `{ outcome: 'rejected', ticketId }`. Skicka in ärendet som vanligt.
- CSRF-token måste skickas via `x-csrf-token`-header — använd samma flöde som befintlig publik ticket-submission.

Statistiken från `GET /api/public/ai-suggest/stats` (`{shown, solved, rejected, no_solution, deflectionRate}`) blir ovärderlig för pilotrapportering — men den syns inte än, kommer i admin-panelen senare.

**B. Flytta "Föreslå svar"-knappen från intern-kommentar (BUGGFIX)**

Knappen ska INTE ligga vid intern-kommentar-fältet. Den genererar ett externt svar till beställaren. Bättre placering — välj en:
- Som primär CTA på ärendets header, intill statusväljaren ("Föreslå svar till beställaren")
- Som ett auto-utlöst utkast när status sätts till "Löst"
- I en separat "Svara"-flik om det finns

Resultatet ska gå till antingen mejl-utskick eller till `solution`-fältet — INTE till intern-kommentar.

**C. AI-kategoriförslag-banner på ärendet**

Om `ai_suggested_category_id` finns och `category_id` saknas, visa banner:
*"🤖 AI föreslår kategori: [namn] (78 % säker) · Acceptera · Ignorera"*

Acceptera = PUT på ärendet med `category_id`. Ignorera = nullställ förslaget i DB:n.

**D. AI-sammanfattningsbox**

På ärenden med fler än 5 kommentarer, fetcha `GET /api/tickets/:id/ai-summary` på mount och visa:
*Status: …* / *Blockerare: …* / *Senaste: …* med en liten "Uppdatera"-länk (anropar `?force=1`).

### 3. Dev-test

Cyklerna efter respektive frontend-task:

1. Pull på dev-server `/opt/it-system/itticket-main`
2. Sätt `ANTHROPIC_API_KEY` i Portainer-stacken
3. "Update the stack" → `docker logs it-ticketing-backend-dev -f`
4. Verifiera migration `037` och `038` körs i loggen
5. Testa flödet i UI:t

**Testfall för deflection:** Skapa publik ärendeansökan med text *"Min Outlook startar inte och visar fel om certifikat"*. Klicka "Få hjälp direkt". Förvänta att AI svarar med stegen från en relevant KB-artikel (om det finns en) eller säger "hittade inget" om KB är tom.

---

## Snabbreferens — viktiga beslut

- **Modell:** Haiku 4.5 default på alla fyra features. Escape-hatch via `AI_MODEL_SMART`.
- **suggestSolutionFromKB är KONSERVATIV.** Om confidence < 0.4 tvingar koden `hasSolution=false`. Hallucinerade lösningar är värre än ingen lösning.
- **Multi-tenancy:** skjuts till efter pilot. Per-kund-installation undviker problemet helt.
- **Tester:** noll testtäckning idag. För pilot räcker manuell verifiering. Börja med tester på AI-helpern + auth efter första pilotkunden.
- **GDPR:** Anthropic är OK för pilot, måste upp på avtal för större kunder. Logga inga personuppgifter i prompts om möjligt.
- **AI-utkast får ALDRIG auto-skickas.** Måste alltid godkännas av människa.
- **Kärnflödet får aldrig blockeras av AI-fel** — alla AI-funktioner returnerar `null` vid fel.
- **Rate limiting på `/api/public/ai-suggest`** är inte påslaget än. Om portalen exponeras öppet på internet — lägg till IP-baserad rate limit före pilot för att inte bränna API-kredit på spam.

---

## Filer att läsa först i Claude Code-session

| Prio | Fil | Varför |
|------|-----|--------|
| 1 | `docs/HANDOFF.md` | (denna fil) |
| 2 | `docs/PILOT-PLAN.md` | Hela strategin + 2-helgers backlog |
| 3 | `server/src/lib/aiHelper.ts` | Förstå AI-kontraktet — speciellt `suggestSolutionFromKB` |
| 4 | `server/src/routes/public.ts` (rader 180+) | De nya deflection-endpoints |
| 5 | `server/src/routes/tickets.ts` (rader 1130–1310) | Wire-up och staff-AI-endpoints |
| 6 | `docs/landing-page.html` | Säljvinkeln när du tappar fokus |

---

*Slut på handoff. Lycka till. Kom ihåg: deflection-AI är produkten, allt annat är staff-bekvämlighet.*
