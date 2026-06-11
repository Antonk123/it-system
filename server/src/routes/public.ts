import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { sendTicketCreatedEmail } from '../lib/email.js';
import { aiEnabled, suggestSolutionFromKB, findRelevantKbArticles } from '../lib/aiHelper.js';
import { stripHtml } from '../lib/htmlUtils.js';
import { sanitizeRichText, sanitizePlainText } from '../lib/htmlSanitizer.js';
import { publicWriteRateLimiter, publicAiRateLimiter } from '../middleware/rateLimit.js';
import { authenticate } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

// ─── Idempotency key store (in-memory, 5-minute TTL) ────────────────────────
// Prevents duplicate ticket creation from network retries on the public form.
const idempotencyStore = new Map<string, { ticketId: string; expiresAt: number }>();
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Periodic cleanup every 60s to evict expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore) {
    if (entry.expiresAt <= now) idempotencyStore.delete(key);
  }
}, 60_000).unref();

interface ContactRow {
  id: string;
  name: string;
  email: string;
}

interface CategoryRow {
  id: string;
  label: string;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  title_template: string;
  description_template: string;
  priority: string;
  category_id: string | null;
}

// Get public templates (for public ticket form)
router.get('/templates', (_req: Request, res: Response) => {
  try {
    const templates = db.prepare('SELECT id, name, description, title_template, description_template, priority, category_id FROM ticket_templates ORDER BY position ASC, name ASC').all() as TemplateRow[];

    // Attach fields to each template
    // Batch-load all fields in one query, then group by template_id
    const allFields = db.prepare('SELECT * FROM template_fields ORDER BY position ASC').all() as (Record<string, unknown> & { template_id: string })[];
    const fieldsByTemplate = new Map<string, typeof allFields>();
    for (const field of allFields) {
      const list = fieldsByTemplate.get(field.template_id) || [];
      list.push(field);
      fieldsByTemplate.set(field.template_id, list);
    }

    const templatesWithFields = templates.map(template => ({
      ...template,
      fields: fieldsByTemplate.get(template.id) || [],
    }));

    res.json(templatesWithFields);
  } catch (error) {
    logger.error('Error fetching public templates:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Get public categories (for public ticket form)
router.get('/categories', (_req: Request, res: Response) => {
  try {
    const categories = db.prepare('SELECT id, label FROM categories ORDER BY position ASC, created_at ASC').all() as CategoryRow[];
    res.json(categories);
  } catch (error) {
    logger.error('Error fetching public categories:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Submit public ticket
router.post('/tickets', publicWriteRateLimiter, (req: Request, res: Response) => {
  // ─── Idempotency: prevent duplicate tickets from network retries ───
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
  if (idempotencyKey) {
    const existing = idempotencyStore.get(idempotencyKey);
    if (existing && existing.expiresAt > Date.now()) {
      return res.status(201).json({
        message: 'Ticket submitted successfully',
        ticketId: existing.ticketId,
      });
    }
  }

  let { name, email, title, description, category, priority, customFields, template_id } = req.body;

  // Validate required fields
  if (!name || !email || !title) {
    return res.status(400).json({ error: 'Name, email, and title are required' });
  }

  // Description is not required if customFields are provided
  if (!description && (!customFields || customFields.length === 0)) {
    return res.status(400).json({ error: 'Either description or custom fields are required' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate lengths
  if (name.length > 100) {
    return res.status(400).json({ error: 'Name must be 100 characters or less' });
  }
  if (title.length > 200) {
    return res.status(400).json({ error: 'Title must be 200 characters or less' });
  }
  if (description && description.length > 5000) {
    return res.status(400).json({ error: 'Description must be 5000 characters or less' });
  }

  // Validate priority
  const validPriorities = ['low', 'medium', 'high', 'critical'];
  const ticketPriority = validPriorities.includes(priority) ? priority : 'medium';

  // Defense-in-depth: sanitera HTML server-side. Public endpoint är extra
  // exponerad — okänd request-origin, ingen auth, så strikt sanitering.
  name = sanitizePlainText(name);
  title = sanitizePlainText(title);
  if (description !== undefined) description = sanitizeRichText(description);

  try {
    // Find or create contact
    let contact = db.prepare('SELECT id FROM contacts WHERE email = ?').get(email) as ContactRow | undefined;

    if (!contact) {
      const contactId = uuidv4();
      db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)').run(contactId, name, email);
      contact = { id: contactId, name, email };
    }

    // Validate category exists if provided
    let categoryId: string | null = null;
    if (category) {
      const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(category);
      if (cat) {
        categoryId = category;
      }
    }

    // Create ticket
    const ticketId = uuidv4();

    // Prepare description: when customFields provided, compose ONLY from them (prevents duplicates)
    let finalDescription: string;
    if (customFields && Array.isArray(customFields) && customFields.length > 0) {
      finalDescription = customFields
        .filter((field: any) => field.fieldLabel)
        .map((field: any) => `**${field.fieldLabel}**: ${field.fieldValue || '(ej angivet)'}`)
        .join('  \n');
    } else {
      finalDescription = description || '';
    }

    db.prepare(`
      INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, template_id)
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?)
    `).run(ticketId, title, finalDescription, ticketPriority, categoryId, contact.id, template_id || null);

    // FTS5 synkas automatiskt via triggers (migration 050)

    // Store custom field values if provided
    if (customFields && Array.isArray(customFields) && customFields.length > 0) {
      const insertFieldStmt = db.prepare(`
        INSERT INTO ticket_field_values (id, ticket_id, field_name, field_label, field_value)
        VALUES (?, ?, ?, ?, ?)
      `);

      customFields.forEach((field: any) => {
        if (field.fieldName && field.fieldLabel) {
          insertFieldStmt.run(uuidv4(), ticketId, field.fieldName, field.fieldLabel, field.fieldValue || '');
        }
      });
    }

    sendTicketCreatedEmail({
      id: ticketId,
      title,
      description: finalDescription,
      status: 'open',
      priority: ticketPriority,
      categoryId,
      requesterName: contact.name,
      requesterEmail: contact.email,
    }).catch((error) => {
      logger.error('Error sending public ticket email:', { error: String(error) });
    });

    // Store idempotency key so retries return the same ticket
    if (idempotencyKey) {
      idempotencyStore.set(idempotencyKey, {
        ticketId,
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
      });
    }

    res.status(201).json({
      message: 'Ticket submitted successfully',
      ticketId
    });
  } catch (error) {
    logger.error('Error creating public ticket:', { error: String(error) });
    res.status(500).json({ error: 'Failed to submit ticket' });
  }
});

// ─── AI deflection — flaggskeppsfunktionen ───────────────────────────────────

/**
 * POST /api/public/ai-suggest
 *
 * Kallas från publika ärendeformuläret INNAN användaren skapar ärende.
 * Söker KB via FTS, anropar AI för att försöka lösa problemet, returnerar
 * förslag + ett deflection-id som senare uppdateras med utfallet.
 *
 * Body: { problemText: string, userEmail?: string }
 * Svar: { deflectionId, hasSolution, solution, confidence, kbReferences }
 */
router.post('/ai-suggest', publicAiRateLimiter, (req: Request, res: Response) => {
  const { problemText, userEmail } = req.body as { problemText?: string; userEmail?: string };

  if (!problemText || typeof problemText !== 'string' || problemText.trim().length < 10) {
    return res.status(400).json({ error: 'Beskriv problemet med minst 10 tecken.' });
  }
  if (problemText.length > 5000) {
    return res.status(400).json({ error: 'Beskrivningen får vara max 5000 tecken.' });
  }

  if (!aiEnabled()) {
    return res.status(503).json({ error: 'AI är inte konfigurerat på denna installation' });
  }

  const handle = async () => {
    try {
      // Steg 1: Hämta alla publicerade KB-titlar, låt AI välja relevanta
      const allArticles = db.prepare(
        `SELECT id, title FROM kb_articles WHERE status = 'published'`
      ).all() as { id: string; title: string }[];

      const relevantIds = await findRelevantKbArticles(problemText, allArticles);

      // Steg 2: Hämta fullständigt innehåll för de valda artiklarna
      let kbHits: { id: string; title: string; content: string }[] = [];
      if (relevantIds.length > 0) {
        const placeholders = relevantIds.map(() => '?').join(',');
        kbHits = db.prepare(
          `SELECT id, title, content FROM kb_articles WHERE id IN (${placeholders}) AND status = 'published'`
        ).all(...relevantIds) as { id: string; title: string; content: string }[];
      }

      const articlesForAI = kbHits.map(a => ({
        title: a.title,
        content: stripHtml(a.content),
      }));

      const suggestion = await suggestSolutionFromKB(problemText, articlesForAI);

      // Logga deflection oavsett utfall — det är data värd att ha
      const deflectionId = uuidv4();
      db.prepare(`
        INSERT INTO ai_deflections (id, problem_text, suggestion_text, kb_article_ids, confidence, outcome, user_email)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        deflectionId,
        problemText.slice(0, 5000),
        suggestion?.solution ?? null,
        JSON.stringify(kbHits.map(a => a.id)),
        suggestion?.confidence ?? 0,
        suggestion?.hasSolution ? 'shown' : 'no_solution',
        userEmail || null
      );

      res.json({
        deflectionId,
        hasSolution: suggestion?.hasSolution ?? false,
        solution: suggestion?.solution ?? null,
        confidence: suggestion?.confidence ?? 0,
        kbReferences: kbHits.map(a => ({ id: a.id, title: a.title })),
      });
    } catch (err) {
      logger.error('Error in ai-suggest:', { error: String(err) });
      res.status(500).json({ error: 'Kunde inte generera förslag' });
    }
  };

  handle().catch(err => logger.error('AI suggest handle error', { error: String(err) }));
});

/**
 * PATCH /api/public/ai-suggest/:id
 *
 * Uppdaterar utfallet för ett deflection-tillfälle.
 * Body: { outcome: 'solved' | 'rejected', ticketId?: string }
 *
 * 'solved'   = användaren markerade att förslaget löste problemet (DEFLECTION!)
 * 'rejected' = användaren gick vidare och skapade ärende ändå
 */
router.patch('/ai-suggest/:id', publicWriteRateLimiter, (req: Request, res: Response) => {
  const { outcome, ticketId } = req.body as { outcome?: string; ticketId?: string };
  if (!outcome || !['solved', 'rejected'].includes(outcome)) {
    return res.status(400).json({ error: 'outcome måste vara "solved" eller "rejected"' });
  }
  try {
    const result = db.prepare(`
      UPDATE ai_deflections
      SET outcome = ?, ticket_id = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(outcome, ticketId || null, req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Deflection-id hittades inte' });
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error patching deflection:', { error: String(err) });
    res.status(500).json({ error: 'Kunde inte uppdatera utfall' });
  }
});

/**
 * GET /api/public/ai-suggest/stats
 * Returnerar deflection-stats senaste 30 dagarna. Konsumeras av Dashboard för
 * alla inloggade användare → kräver authenticate (inte publik längre, trots
 * att den ligger på public-routern). requireAdmin är fel: Dashboard är ej
 * admin-only. Ej publik widget — bara dashboard-statistik.
 */
router.get('/ai-suggest/stats', authenticate, (_req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT outcome, COUNT(*) as n
      FROM ai_deflections
      WHERE created_at >= ?
      GROUP BY outcome
    `).all(since) as { outcome: string; n: number }[];

    const stats = { shown: 0, solved: 0, rejected: 0, no_solution: 0 };
    for (const r of rows) (stats as any)[r.outcome] = r.n;
    const total = stats.shown + stats.solved + stats.rejected;
    const deflectionRate = total > 0 ? Math.round((stats.solved / total) * 100) : 0;

    res.json({ ...stats, total, deflectionRate });
  } catch (err) {
    logger.error('Error fetching deflection stats:', { error: String(err) });
    res.status(500).json({ error: 'Kunde inte hämta stats' });
  }
});

export default router;
