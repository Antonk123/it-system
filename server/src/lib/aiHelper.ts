import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

/**
 * AI-helper för IT-Ticket.
 *
 * FYRA publika funktioner — i prioritetsordning:
 *   1. suggestSolutionFromKB — FLAGGSKEPP: hjälper slutanvändare lösa problem
 *      via publika portalen INNAN ärende skapas. Det här är differentierings-
 *      funktionen mot Zendesk i Nordic-segmentet.
 *   2. suggestCategory       — klassificering vid ärendeskapande (intern)
 *   3. draftReply            — utkast på svar till beställare (intern, för staff)
 *   4. summarizeTicket       — sammanfattning av långa ärenden (intern)
 *
 * Designprinciper:
 *   - Alla funktioner returnerar null vid fel — kärnflödet får ALDRIG blockeras.
 *   - suggestSolutionFromKB är KONSERVATIV: säger hellre "vet inte" än hittar på.
 *   - Token-användning loggas i ai_usage_log för kostnadsuppföljning per installation.
 *   - Default-modell konfigurerbar via env (AI_MODEL). AI_MODEL_SMART är en
 *     escape-hatch för att uppgradera draft+summary till en starkare modell.
 *   - Klienten lazy-initieras — om ANTHROPIC_API_KEY saknas är aiEnabled() false
 *     och alla funktioner no-op:ar.
 */

// ─── Klient & konfig ──────────────────────────────────────────────────────────

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

// ─── Consecutive failure tracking (Issue: silent AI outage) ──────────────────
let consecutiveFailures = 0;
const FAILURE_ALERT_THRESHOLD = 5;

/**
 * Strip prompt-injection patterns from KB content before embedding in prompts.
 * Removes lines that look like system/instruction directives and truncates.
 */
function sanitizeForPrompt(text: string, maxLength = 1500): string {
  const injectionPatterns = /^\s*(\[SYSTEM\]|\[INST\]|\[\/INST\]|<<SYS>>|<\/s>|<\|im_start\|>|<\|im_end\|>|### Instruction|### System|SYSTEM:|ASSISTANT:|USER:)/im;
  const lines = text.split('\n').filter(line => !injectionPatterns.test(line));
  return lines.join('\n').slice(0, maxLength);
}

// Default-modell för alla AI-funktioner. Haiku 4.5 är optimerad för exakt vårt
// användningsfall: hämta info ur given kontext (KB-artiklar) och presentera
// den vänligt på svenska. Snabb (oftast <1s), billig (~5x billigare än Sonnet),
// och tillräcklig kvalitet när KB är välskrivet.
//
// Escape-hatch: om du under pilot märker att utkast eller sammanfattningar
// blir för generiska, sätt AI_MODEL_SMART=claude-sonnet-4-6 för att uppgradera
// draft + summary till en starkare modell. Kategorisering använder alltid
// default-modellen — den uppgiften behöver aldrig mer än Haiku.

// Kända Claude-modell-ID:n. Om AI_MODEL/AI_MODEL_SMART inte matchar listan
// loggas en varning och default-värdet används — skyddar mot runtime 400 vid
// felstavning.
const KNOWN_CLAUDE_MODELS = new Set([
  // Haiku-familjen
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
  'claude-haiku-4',
  'claude-3-haiku-20240307',
  'claude-3-5-haiku-20241022',
  // Sonnet-familjen
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-sonnet-20240229',
  // Opus-familjen
  'claude-opus-4-5',
  'claude-opus-4',
  'claude-3-opus-20240229',
]);

const FALLBACK_MODEL_DEFAULT = 'claude-haiku-4-5-20251001';

function resolveModel(envVar: string, envValue: string | undefined, fallback: string): string {
  if (!envValue) return fallback;
  if (KNOWN_CLAUDE_MODELS.has(envValue)) return envValue;
  logger.warn(`Okänt AI-modell-ID i ${envVar} — faller tillbaka till default`, {
    given: envValue,
    fallback,
  });
  return fallback;
}

const MODEL_DEFAULT = resolveModel('AI_MODEL', process.env.AI_MODEL, FALLBACK_MODEL_DEFAULT);
const MODEL_SMART = resolveModel('AI_MODEL_SMART', process.env.AI_MODEL_SMART, MODEL_DEFAULT);

export const aiEnabled = (): boolean => client !== null;

// ─── Monthly budget circuit breaker ──────────────────────────────────────────

const AI_MONTHLY_TOKEN_LIMIT = parseInt(process.env.AI_MONTHLY_TOKEN_LIMIT || '5000000', 10);
let budgetCache: { withinBudget: boolean; checkedAt: number } | null = null;
const BUDGET_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function isWithinBudget(): boolean {
  const now = Date.now();
  if (budgetCache && (now - budgetCache.checkedAt) < BUDGET_CACHE_TTL) {
    return budgetCache.withinBudget;
  }
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const row = db.prepare(
      'SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total FROM ai_usage_log WHERE created_at >= ?'
    ).get(monthStart.toISOString()) as { total: number };
    const withinBudget = row.total < AI_MONTHLY_TOKEN_LIMIT;
    budgetCache = { withinBudget, checkedAt: now };
    if (!withinBudget) {
      logger.warn('AI monthly token budget exceeded', { total: row.total, limit: AI_MONTHLY_TOKEN_LIMIT });
    }
    return withinBudget;
  } catch {
    // On error, allow usage (fail-open for the budget check)
    return true;
  }
}

// ─── Token-logg (för kostnadsuppföljning) ─────────────────────────────────────

interface UsageRecord {
  feature: 'categorize' | 'draft' | 'summary' | 'suggest';
  model: string;
  input_tokens: number;
  output_tokens: number;
  ticket_id: string | null;
  duration_ms: number;
  ok: boolean;
}

function logUsage(record: UsageRecord): void {
  // Track consecutive failures for outage alerting
  if (record.ok) {
    if (consecutiveFailures >= FAILURE_ALERT_THRESHOLD) {
      logger.info('AI API: recovered after consecutive failures', { count: consecutiveFailures });
    }
    consecutiveFailures = 0;
  } else {
    consecutiveFailures++;
    if (consecutiveFailures >= FAILURE_ALERT_THRESHOLD) {
      logger.warn('AI API: consecutive failures — check ANTHROPIC_API_KEY and service status', { count: consecutiveFailures });
    }
  }

  try {
    db.prepare(`
      INSERT INTO ai_usage_log (id, feature, model, input_tokens, output_tokens, ticket_id, duration_ms, ok, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      uuidv4(),
      record.feature,
      record.model,
      record.input_tokens,
      record.output_tokens,
      record.ticket_id,
      record.duration_ms,
      record.ok ? 1 : 0
    );
  } catch (err) {
    // Logging fel ska aldrig bryta huvudflödet
    logger.error('AI usage log failed (non-fatal)', { err: String(err) });
  }
}

// Hjälpfunktion: extrahera JSON ur LLM-output även om det finns kringtext
function extractJson<T>(text: string): T | null {
  // Greedy match — fångar nestade objekt också
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

// ─── Hjälpare: bygg FTS-fråga från fri text ───────────────────────────────────

/**
 * Bygger en SQLite FTS5-kompatibel sökfråga från fri text.
 * Strippar interpunktion, filtrerar bort korta ord, OR:ar de N starkaste orden.
 * Används av både public ai-suggest och tickets ai-draft.
 */
export function buildKbSearchQuery(text: string, maxTerms = 10): string {
  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  const terms = words.slice(0, maxTerms).map(w => `${w}*`);
  return terms.join(' OR ');
}

// ─── Steg 1: Låt AI välja relevanta KB-artiklar baserat på problemtext ───────

export async function findRelevantKbArticles(
  problemText: string,
  articles: { id: string; title: string }[]
): Promise<string[]> {
  if (!client || articles.length === 0) return [];
  try {
    const articleList = articles.map((a, i) => `${i + 1}. [${a.id}] ${a.title}`).join('\n');
    const msg = await client.messages.create({
      model: MODEL_DEFAULT,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Du är en IT-support-assistent. En användare beskriver ett problem. Vilka av följande kunskapsbasartiklar KAN vara relevanta?

<user_problem>
${problemText.slice(0, 4000)}
</user_problem>

ARTIKLAR:
${articleList}

Svara ENDAST med en JSON-array av artikel-ID:n, t.ex. ["id1", "id2"]. Om ingen artikel verkar relevant, svara [].`
      }]
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch (err) {
    logger.error('AI article selection failed', { err: String(err) });
    return [];
  }
}

// ─── FLAGGSKEPP: Föreslå lösning till slutanvändare via publika portalen ──────

export interface SolutionSuggestion {
  hasSolution: boolean;     // false = AI kunde inte hjälpa, användaren ska fortsätta skapa ärende
  solution: string | null;  // Markdown-formatterat svar för slutanvändaren
  confidence: number;       // 0.0–1.0
  reason?: string;          // När hasSolution=false, kort förklaring (loggas, visas ej)
}

/**
 * Föreslår en lösning på ett IT-problem baserat på företagets kunskapsbas,
 * INNAN ett ärende skapas. Detta är deflection-AI:n — flaggskeppsfunktionen.
 *
 * KONSERVATIV: Funktionen är hellre tystlåten än hjälpsam. Om KB inte täcker
 * problemet returnerar den hasSolution=false så att användaren skapar ett ärende
 * istället. Hallucinerade lösningar är en värre upplevelse än ingen lösning alls.
 *
 * Modell: default (Haiku) — ca 2000 input + 300 output tokens ≈ $0,002 per förfrågan.
 *   Lika billigt som ett utkast, så även med 90 % deflection-rate sparas pengar
 *   netto eftersom varje undvikt ärende sparar 30+ minuters IT-tid.
 */
export async function suggestSolutionFromKB(
  problemText: string,
  relevantKbArticles: { title: string; content: string }[]
): Promise<SolutionSuggestion | null> {
  if (!client) return null;
  if (!isWithinBudget()) return null;

  const start = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let ok = false;

  try {
    // Om vi inte ens hittade KB-artiklar via FTS — säg det direkt utan API-anrop
    if (relevantKbArticles.length === 0) {
      ok = true;
      return {
        hasSolution: false,
        solution: null,
        confidence: 0,
        reason: 'Inga relevanta KB-artiklar hittades via sökning',
      };
    }

    const kbContext = relevantKbArticles
      .slice(0, 5)
      .map((a, i) => `[KB ${i + 1}] ${sanitizeForPrompt(a.title, 200)}\n${sanitizeForPrompt(a.content)}`)
      .join('\n\n---\n\n');

    const systemPrompt = `Du är en hjälpsam IT-assistent på en svensk arbetsplats. Din uppgift är att hjälpa medarbetare lösa enkla IT-problem INNAN de skapar ett ärende — men ENDAST när du faktiskt kan ge en bra lösning baserat på företagets kunskapsbas.

STRIKTA REGLER:
1. Använd ENDAST informationen i kunskapsbasen nedan. Hitta INTE på.
2. Om KB inte innehåller en relevant lösning — sätt hasSolution=false. Det är OK.
3. Om problemet kräver fysisk åtgärd, hårdvarutillgång, eller administratörsrättigheter — sätt hasSolution=false.
4. Om problemet är vagt eller du är osäker — sätt hasSolution=false eller låg confidence.
5. Skriv på svenska, vänligt 'du'-tilltal.
6. Vid lösning: max 5 numrerade konkreta steg.

Svara ENDAST med JSON i formatet:
{"hasSolution": true|false, "solution": "...", "confidence": 0.0-1.0, "reason": "..."}

Fält:
- solution: själva svaret (markdown OK, eller null om hasSolution=false)
- confidence: 0.0–1.0. Sätt 0.7+ bara om du är riktigt säker. Mellan 0.4 och 0.7 = visa men markera som "kanske". Under 0.4 = sätt hasSolution=false.
- reason: kort förklaring (1 mening) varför du sa nej. Loggas internt.`;

    const userPrompt = `KUNSKAPSBAS:
${kbContext}

ANVÄNDARENS PROBLEM:
${sanitizeForPrompt(problemText, 2000)}

Bedöm om du kan hjälpa baserat på KB ovan.`;

    const msg = await client.messages.create({
      model: MODEL_DEFAULT,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    inputTokens = msg.usage?.input_tokens ?? 0;
    outputTokens = msg.usage?.output_tokens ?? 0;

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const parsed = extractJson<SolutionSuggestion>(text);
    if (!parsed) return null;

    // Validera och normalisera output
    const result: SolutionSuggestion = {
      hasSolution: !!parsed.hasSolution,
      solution: parsed.hasSolution ? (parsed.solution || null) : null,
      confidence: typeof parsed.confidence === 'number' ?
        Math.max(0, Math.min(1, parsed.confidence)) : 0,
      reason: parsed.reason,
    };

    // Säkerhetsregel: om confidence < 0.4, tvinga hasSolution=false
    if (result.confidence < 0.4) {
      result.hasSolution = false;
      result.solution = null;
    }

    ok = true;
    return result;
  } catch (err) {
    logger.error('AI solution suggestion failed', { err: String(err) });
    return null;
  } finally {
    logUsage({
      feature: 'suggest',
      model: MODEL_DEFAULT,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      ticket_id: null,  // Det finns inget ärende än — det är ju hela poängen
      duration_ms: Date.now() - start,
      ok,
    });
  }
}

// ─── Feature 1: AI-kategorisering ─────────────────────────────────────────────

export interface CategorySuggestion {
  categoryId: string;
  confidence: number;
}

/**
 * Föreslår en kategori för ett ärende baserat på titel + beskrivning.
 * Returnerar null om: AI är avslagen, API-fel, eller LLM-output ej parserbar.
 *
 * Anropet är icke-blockerande — kalla utan await i POST /tickets om du vill
 * att ärendet ska skapas direkt och kategorisera asynkront.
 *
 * Modell: default (Haiku) — ca 200 input + 50 output tokens per anrop ≈ $0,0004.
 *   $10 i kredit räcker till ~25 000 kategoriseringar.
 */
export async function suggestCategory(
  title: string,
  description: string,
  categories: { id: string; label: string }[],
  ticketId: string | null = null
): Promise<CategorySuggestion | null> {
  if (!client || categories.length === 0) return null;
  if (!isWithinBudget()) return null;

  const start = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let ok = false;

  try {
    const labels = categories.map(c => `- ${c.label} (id: ${c.id})`).join('\n');
    const msg = await client.messages.create({
      model: MODEL_DEFAULT,
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Klassificera detta IT-ärende i en av kategorierna nedan. Svara ENDAST med JSON i formatet: {"categoryId": "<id>", "confidence": 0.0-1.0}. Sätt confidence till 0.5 eller lägre om du är osäker.

Tillgängliga kategorier:
${labels}

Ärende:
Titel: ${sanitizeForPrompt(title, 200)}
Beskrivning: ${sanitizeForPrompt(description, 800)}`
      }]
    });

    inputTokens = msg.usage?.input_tokens ?? 0;
    outputTokens = msg.usage?.output_tokens ?? 0;

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const parsed = extractJson<CategorySuggestion>(text);

    // Validera att den föreslagna kategorin finns i listan OCH fortfarande i DB
    // (skyddar mot race condition om kategori raderas medan AI-anropet körs)
    if (!parsed || !categories.find(c => c.id === parsed.categoryId)) return null;
    if (typeof parsed.confidence !== 'number') return null;
    const stillExists = db.prepare('SELECT 1 FROM categories WHERE id = ?').get(parsed.categoryId);
    if (!stillExists) return null;

    ok = true;
    return parsed;
  } catch (err) {
    logger.error('AI categorize failed', { err: String(err) });
    return null;
  } finally {
    logUsage({
      feature: 'categorize',
      model: MODEL_DEFAULT,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      ticket_id: ticketId,
      duration_ms: Date.now() - start,
      ok,
    });
  }
}

// ─── Feature 2: AI-utkast på svar baserat på KB ───────────────────────────────

/**
 * Genererar ett svar på ett ärende baserat på relevanta KB-artiklar.
 * KB-artiklarna förväntas vara förfiltrerade via FTS-sökning (kallaren ansvarar).
 *
 * Modell: default (Haiku) — ca 1500 input + 400 output tokens ≈ $0,002 per utkast.
 *   $10 i kredit räcker till ~5 000 utkast.
 *   Sätt AI_MODEL_SMART=claude-sonnet-4-6 om du vill uppgradera kvaliteten (~5x dyrare).
 */
export async function draftReply(
  ticket: { title: string; description: string },
  relevantKbArticles: { title: string; content: string }[],
  ticketId: string | null = null,
  attachments: { file_name: string; content: string }[] = []
): Promise<string | null> {
  if (!client) return null;
  if (!isWithinBudget()) return null;

  const start = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let ok = false;

  try {
    const kbContext = relevantKbArticles
      .slice(0, 5)
      .map((a, i) => `[KB ${i + 1}] ${sanitizeForPrompt(a.title, 200)}\n${sanitizeForPrompt(a.content)}`)
      .join('\n\n---\n\n');

    const attachmentContext = attachments.length > 0
      ? attachments.map((a, i) => `[Bilaga ${i + 1}] ${sanitizeForPrompt(a.file_name, 200)}\n${sanitizeForPrompt(a.content, 3000)}`).join('\n\n---\n\n')
      : '';

    const systemPrompt = `Du är IT-supporten på ett svenskt SMB. Du skriver tydliga, vänliga, professionella svar till medarbetare som rapporterat ett ärende. Använd "du" inte "ni". Var konkret och steg-för-steg om det är en lösning. Avsluta alltid med "Hör av dig om det inte löste problemet, så tar vi det vidare." Skriv ENDAST mejlsvaret — ingen rubrik, ingen signatur, inga rubriker som "Hej" eller "Med vänliga hälsningar" (de läggs till av systemet).${attachments.length > 0 ? ' Om bilagor innehåller loggfiler eller felmeddelanden, analysera dem och referera till specifika rader eller fel i ditt svar.' : ''}`;

    const userPrompt = `KUNSKAPSBAS (relevanta artiklar från ert egna interna underlag):
${kbContext || '(inga relevanta artiklar hittades — basera svaret på generell IT-praxis)'}
${attachmentContext ? `\nBIFOGADE FILER (bilagor som medarbetaren skickat med ärendet):\n${attachmentContext}\n` : ''}
ÄRENDE FRÅN MEDARBETARE:
Titel: ${sanitizeForPrompt(ticket.title, 200)}
Beskrivning: ${sanitizeForPrompt(ticket.description, 2000)}

Skriv ditt svar nu.`;

    const msg = await client.messages.create({
      model: MODEL_SMART,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    inputTokens = msg.usage?.input_tokens ?? 0;
    outputTokens = msg.usage?.output_tokens ?? 0;

    const text = msg.content[0].type === 'text' ? msg.content[0].text : null;
    if (!text || text.trim().length < 20) return null;

    ok = true;
    return text.trim();
  } catch (err) {
    logger.error('AI draft reply failed', { err: String(err) });
    return null;
  } finally {
    logUsage({
      feature: 'draft',
      model: MODEL_SMART,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      ticket_id: ticketId,
      duration_ms: Date.now() - start,
      ok,
    });
  }
}

// ─── Feature 3: AI-sammanfattning av långa ärenden ────────────────────────────

export interface TicketSummary {
  status: string;
  blockers: string;
  lastAction: string;
}

/**
 * Sammanfattar ett ärende inklusive tidslinje. Endpoint:n cachar resultatet
 * i 1 timme via ai_summary_updated_at — kalla bara den här när cache är gammal.
 *
 * Modell: default (Haiku) — ca 800 input + 200 output tokens ≈ $0,001 per sammanfattning.
 *   $10 i kredit räcker till ~10 000 sammanfattningar.
 *   Haiku är särskilt bra på just sammanfattning — uppgradera bara om ni har
 *   nischade ärenden där svaren behöver mer abstrakt resonemang.
 */
export async function summarizeTicket(
  ticket: { title: string; description: string },
  comments: { author: string; content: string; created_at: string }[],
  ticketId: string | null = null
): Promise<TicketSummary | null> {
  if (!client) return null;
  if (!isWithinBudget()) return null;

  const start = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let ok = false;

  try {
    // Begränsa antalet kommentarer för att hålla token-kostnaden nere
    const maxComments = parseInt(process.env.AI_MAX_SUMMARY_COMMENTS || '30', 10);
    const recent = comments.slice(-maxComments);
    const timeline = recent
      .map(c => `[${c.created_at}] ${sanitizeForPrompt(c.author, 100)}: ${sanitizeForPrompt(c.content, 500)}`)
      .join('\n');

    const msg = await client.messages.create({
      model: MODEL_SMART,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Sammanfatta detta IT-ärende. Svara ENDAST med JSON i formatet: {"status": "...", "blockers": "...", "lastAction": "..."}. Allt på svenska, EN konkret mening per fält. Ingen kringtext.

- status: var ärendet står just nu
- blockers: vad som hindrar progress (eller "Inget" om inget)
- lastAction: vad som hände senast

Ärende: ${sanitizeForPrompt(ticket.title, 200)}
Beskrivning: ${sanitizeForPrompt(ticket.description, 800)}

Tidslinje (senaste ${recent.length}):
${timeline}`
      }]
    });

    inputTokens = msg.usage?.input_tokens ?? 0;
    outputTokens = msg.usage?.output_tokens ?? 0;

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const parsed = extractJson<TicketSummary>(text);
    if (!parsed || !parsed.status || !parsed.lastAction) return null;

    ok = true;
    return parsed;
  } catch (err) {
    logger.error('AI summary failed', { err: String(err) });
    return null;
  } finally {
    logUsage({
      feature: 'summary',
      model: MODEL_SMART,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      ticket_id: ticketId,
      duration_ms: Date.now() - start,
      ok,
    });
  }
}

// ─── Cleanup av gammal AI-logg ────────────────────────────────────────────────

/**
 * Raderar ai_usage_log-rader äldre än 90 dagar.
 * Körs via cron i index.ts (daily).
 */
export function cleanupOldAiUsage(): void {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM ai_usage_log WHERE created_at < ?').run(cutoff);
  logger.info('AI usage cleanup completed', { deletedRows: result.changes });
}

// ─── Kostnadsöversikt (helper för admin-panel senare) ─────────────────────────

/**
 * Returnerar token- och anrop-statistik för senaste N dagarna.
 * Används av endpoint:en GET /api/ai/usage-stats (lägg till senare i admin-flow).
 */
export interface UsageStats {
  feature: string;
  total_calls: number;
  ok_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  avg_duration_ms: number;
}

export function getUsageStats(days = 30): UsageStats[] {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT
      feature,
      COUNT(*) as total_calls,
      SUM(ok) as ok_calls,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      ROUND(AVG(duration_ms)) as avg_duration_ms
    FROM ai_usage_log
    WHERE created_at >= ?
    GROUP BY feature
  `).all(since) as UsageStats[];
}
