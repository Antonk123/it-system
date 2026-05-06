# IT-Ticket — Pilot Readiness Plan

> **Mål:** 2 helger till första betalande pilotkund.
> **Strategi:** Installation-per-kund-modell (en Docker-instans per företag), inte multi-tenant SaaS.
> **Varför:** Tar bort den största arkitektoniska blockeringen (multi-tenancy) och låter dig sälja idag.

---

## Sammanfattning

Du har redan byggt 70 % av en kommersiell ärendehanterare. Det som saknas för att börja sälja är inte fler funktioner — det är paketering + en uppenbar AI-vinkel som ingen konkurrent har.

**Realistisk pilot-modell:**
- Setup-avgift: 35 000 SEK per kund (engång, 50 % i förskott).
- Månadsavgift: 1 500 SEK/mån (uppdateringar, support, AI-API-kostnad inkluderad).
- Mål: 3 pilotkunder innan utgången av Q3 2026 → 105 000 SEK initialt + 4 500 SEK MRR.

---

## Fas 1 — Hårdning + AI-integration (Helg 1, ~8 timmar)

### Lördag (4 tim) — Hårdning & AI-bibliotek

**1. TypeScript strict-läge** (1 tim)

Sätt i `tsconfig.json` (root):
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```
Kör `npm run typecheck`. Förvänta dig 50–100 fel. Fixa de 10 viktigaste (bara där `any` döljer riktiga buggar — resten kan vara `unknown` eller TODO-kommentar).

**2. Bygg `server/src/lib/aiHelper.ts`** (3 tim)

Detta är det nya AI-biblioteket. Tre exporterade funktioner, alla async, alla med graceful fallback om API är nere.

```typescript
// server/src/lib/aiHelper.ts
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

export const aiEnabled = () => client !== null;

// ─── Feature 1: AI-kategorisering ──────────────────────────────────────
// Modell: Haiku 4.5 (snabb, billig — ~$0,001 per ärende)
// Anrop: vid ärendeskapande, parallellt med detectAutoPriority
export async function suggestCategory(
  title: string,
  description: string,
  categories: { id: string; label: string }[]
): Promise<{ categoryId: string; confidence: number } | null> {
  if (!client) return null;
  try {
    const labels = categories.map(c => `- ${c.label} (id: ${c.id})`).join('\n');
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Klassificera detta IT-ärende. Svara ENDAST med JSON: {"categoryId": "<id>", "confidence": 0.0-1.0}.

Tillgängliga kategorier:
${labels}

Ärende:
Titel: ${title}
Beskrivning: ${description}`
      }]
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const match = text.match(/\{[^}]+\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('AI categorization failed:', err);
    return null;
  }
}

// ─── Feature 2: AI-utkast på svar baserat på KB ────────────────────────
// Modell: Sonnet 4.6 (kvalitet matter — ~$0,005 per utkast)
// Anrop: explicit knapp i UI, inte automatiskt
export async function draftReply(
  ticket: { title: string; description: string },
  relevantKbArticles: { title: string; content: string }[]
): Promise<string | null> {
  if (!client) return null;
  try {
    const kbContext = relevantKbArticles
      .map((a, i) => `[KB ${i+1}] ${a.title}\n${a.content.slice(0, 1500)}`)
      .join('\n\n---\n\n');
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Du är IT-supporten på ett svenskt SMB. Skriv ett professionellt, vänligt svar på ärendet nedan. Använd informationen från kunskapsbasen om relevant. Skriv på svenska. Var konkret och steg-för-steg om det är en lösning. Avsluta med "Hör av dig om det inte löste problemet." Skriv INGET annat än mejlsvaret.

KUNSKAPSBAS:
${kbContext || '(inga relevanta artiklar hittades)'}

ÄRENDE:
Titel: ${ticket.title}
Beskrivning: ${ticket.description}`
      }]
    });
    return msg.content[0].type === 'text' ? msg.content[0].text : null;
  } catch (err) {
    console.error('AI draft reply failed:', err);
    return null;
  }
}

// ─── Feature 3: AI-sammanfattning av långa ärenden ─────────────────────
// Modell: Sonnet 4.6 (kontext-tungt — ~$0,003 per sammanfattning)
// Anrop: när ärendet har > 5 kommentarer; cachas i 1 timme
export async function summarizeTicket(
  ticket: { title: string; description: string },
  comments: { author: string; content: string; created_at: string }[]
): Promise<{ status: string; blockers: string; lastAction: string } | null> {
  if (!client) return null;
  try {
    const timeline = comments
      .map(c => `[${c.created_at}] ${c.author}: ${c.content}`)
      .join('\n');
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Sammanfatta detta IT-ärende. Svara ENDAST med JSON: {"status": "...", "blockers": "...", "lastAction": "..."}. Allt på svenska, en mening per fält.

Ärende: ${ticket.title}
Beskrivning: ${ticket.description}

Tidslinje:
${timeline}`
      }]
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const match = text.match(/\{[\s\S]+\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('AI summary failed:', err);
    return null;
  }
}
```

Lägg till i `server/package.json`:
```bash
cd server && npm install @anthropic-ai/sdk
```

### Söndag (4 tim) — Wire-up + UI + dev-test

**3. Koppla in i `tickets.ts`** (1,5 tim)

I POST-handlern (där `applyAutoTags` redan körs), lägg till parallellt:
```typescript
// Efter ticket är skapad, kör AI-features non-blocking
if (aiEnabled()) {
  suggestCategory(title, description, allCategories).then(suggestion => {
    if (suggestion && suggestion.confidence > 0.7) {
      db.prepare('UPDATE tickets SET ai_suggested_category_id = ? WHERE id = ?')
        .run(suggestion.categoryId, ticketId);
    }
  });
}
```

Lägg till migration `server/src/db/migrations.ts`:
```sql
ALTER TABLE tickets ADD COLUMN ai_suggested_category_id TEXT;
ALTER TABLE tickets ADD COLUMN ai_draft_response TEXT;
ALTER TABLE tickets ADD COLUMN ai_summary_json TEXT;
ALTER TABLE tickets ADD COLUMN ai_summary_updated_at TEXT;
```

Två nya endpoints i `tickets.ts`:
- `POST /api/tickets/:id/ai-draft` — kör `draftReply` (söker KB med FTS först), sparar i `ai_draft_response`, returnerar.
- `GET /api/tickets/:id/ai-summary` — om `ai_summary_updated_at` är < 1h gammal, returnera cache; annars kör `summarizeTicket` och cacha.

**4. Frontend UI** (1,5 tim)

I `TicketDetail.tsx` (eller motsvarande):
- Knapp **"✨ Föreslå svar (AI)"** som anropar `/ai-draft` och visar resultatet i en redigerbar textarea ovanför kommentarsfältet med "Använd som svar"-knapp.
- Liten **"AI-sammanfattning"-box** högst upp på ärendet om antal kommentarer > 5. Anropar `/ai-summary` på mount.
- Om `ai_suggested_category_id` finns och kategori är tom: visa **"AI föreslår: [kategori] · Acceptera · Ignorera"**.

**5. Test i dev-miljö** (1 tim)
Pusha till dev-server (10.38.195.180:5174). Skapa 5 ärenden, ett långt med 10 kommentarer, ett där KB har relevant artikel. Verifiera alla tre features.

---

## Fas 2 — Pilot-paketering (Helg 2, ~8 timmar)

### Lördag (4 tim)

**1. Utöka `setup.sh`** (2 tim) — interaktivt installationsscript:
```bash
./setup.sh \
  --company-name "Företag AB" \
  --admin-email "anton@foretag.se" \
  --domain "ticket.foretag.se" \
  --anthropic-key "sk-ant-..."
```
Skapar `.env`, kör `docker-compose up -d --build`, skapar admin-användare via en bootstrap-endpoint, skickar lösenordsmejl. Mål: från 0 till körande system på 5 minuter.

**2. Backup/restore-runbook** (1 tim)
Skriv `docs/RUNBOOK.md` med exakta kommandon för: daglig backup-cron, restore från backup, uppgraderingsprocedur (`git pull && docker-compose up -d --build`), rollback, log-platser.

**3. `.env.example` för kund** (1 tim)
Tydligt kommenterat med vad varje variabel gör. Sektion högst upp: "Det här MÅSTE du fylla i". Sektion längst ned: "Det här kan du strunta i".

### Söndag (4 tim)

**4. Landningssida på Carrd ($19/år)** (2 tim)
- Hero: "AI-driven ärendehantering för svenska SMB:s. Installerad hos er på en dag."
- Tre punkter: AI-utkast, AI-kategorisering, AI-sammanfattning.
- Skärmdumpar från ditt eget system.
- Pris transparent: 35 000 SEK setup + 1 500 SEK/mån.
- En CTA: "Boka 15 min demo" → Calendly.

**5. Case study från Prefabmastarna** (2 tim)
- 1-sidig PDF: "Hur Prefabmastarna sparade X timmar/vecka med IT-Ticket."
- Före/efter-siffror: hur många ärenden, hur lång tid på lösning, vad ni ersatte (mejl/Excel/whatever).
- Citat från Jenny eller Markus om värdet (be om tillstånd).

---

## Tekniska beslut (kort)

| Område | Beslut | Varför |
|--------|--------|--------|
| AI-modell, kategorisering | Claude Haiku 4.5 | Billig, snabb, tillräcklig precision |
| AI-modell, utkast/summary | Claude Sonnet 4.6 | Kvalitet på text spelar roll |
| API | Anthropic SDK direkt | Inga abstraktioner, en fil att felsöka |
| API-nyckel | Per installation (`ANTHROPIC_API_KEY`) | Kund kan välja egen eller dela din |
| Cache | Sammanfattningar 1h, kategorisering permanent | Begränsa kostnad |
| Fallback | Returnera `null` om API nere | AI-features får ALDRIG blockera kärnflödet |
| Multi-tenancy | Skjuts till senare | Per-kund-installation undanröjer behovet |

## Säljfraser för demon

- "Vi använder samma LLM som driver Cursor och GitHub Copilot."
- "AI:n läser er KB innan den föreslår svar — den hittar alltid på något, men det är alltid baserat på era egna dokument."
- "Setup är gjort på en eftermiddag. Sen är det er data, er server, era ärenden."
- "Ni betalar inte per användare. Ni betalar för installationen och en månadsavgift som täcker AI-användningen."

## Risker att aktivt hantera

- **Hallucinationer i AI-utkast:** Kommunicera tydligt i UI: "AI-utkast — granska innan du skickar." Aldrig auto-skicka.
- **Kostnadsöverraskningar:** Logga alla AI-anrop med token-count i en tabell (`ai_usage_log`). Lägg in mjuk gräns i koden (t.ex. 10 000 tokens/dag/installation som default, kan höjas).
- **GDPR & data till USA:** Anthropic har EU-residency-option för Enterprise. För pilot räcker det att informera kunden — för större kunder ska detta upp på avtalet.
- **Kunden klagar på en bug:** Du är ensam supporten. Sätt en realistisk SLA i avtalet (svar inom 1 arbetsdag, fix inom 5).

## Mätvärden att följa under pilot

- AI-utkast använda (Antal "Använd som svar"-klick / antal genererade utkast). Mål: > 40 %.
- Tid till första svar (median, före/efter AI). Mål: -50 %.
- AI-API-kostnad per installation per månad. Mål: < 200 SEK.
- NPS från pilotkunden efter 30 dagar. Mål: > 8.

---

## Backlog efter pilot (skjut tills 3 kunder validerat)

- Multi-tenancy (om SaaS-pivot)
- i18n (om internationell expansion)
- Test-suite (auth, billing, ticket flow)
- CI/CD via GitHub Actions
- Self-serve onboarding och billing-portal (Stripe Checkout)
- M365/Teams-integration (logga in via Azure AD, posta ärenden till Teams-kanal)
- Fortnox/Visma-koppling för fakturering

---

*Senast uppdaterad: 2026-05-06. Status: redo att börja Fas 1 nästa helg.*
