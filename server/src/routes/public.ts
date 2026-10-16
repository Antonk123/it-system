import { normalizeTemplateValues, missingRequiredTemplateFields, composeDescriptionFromFields } from '../lib/templateValidation.js';
import { ticketImageSubmission, commitTicketImages } from '../lib/ticketImages.js';
import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { sendTicketCreatedEmail } from '../lib/email.js';
import { sanitizeRichText, sanitizePlainText } from '../lib/htmlSanitizer.js';
import { hasVisibleContent } from '../lib/ticketContent.js';
import { publicWriteRateLimiter, createRateLimiter } from '../middleware/rateLimit.js';
import { getBrandingInfo, getStoredLogoPath } from '../lib/branding.js';
import { logger } from '../lib/logger.js';

const router = Router();

// Same style as kb.ts:kbShareRateLimiter and shares.ts:sharePublicRateLimiter
// (/templates and /categories below predate rate limiting on this router's
// plain GETs, but a new unauthenticated read endpoint should not go out
// without one). Window is wider than those two (120/min, not 30/min):
// GET /branding is fetched on every load of the public ticket form AND the
// login screen, so a shared office NAT can plausibly clear 30 req/min from
// ordinary traffic alone. This is a public, cacheable, non-sensitive read —
// 120/min still bounds it without degrading the login page for real users.
const publicBrandingReadRateLimiter = createRateLimiter(60 * 1000, 120);

// Honeypot (dolt fält "website") och minsta ifyllnadstid mot enkla bottar.
const MIN_FORM_FILL_MS = 3000;

/** formStartedAt kan vara epoch-ms eller ISO-sträng; ogiltigt värde ignoreras. */
function formFillTooFast(formStartedAt: unknown): boolean {
  if (formStartedAt === undefined || formStartedAt === null || formStartedAt === '') return false;
  const started = typeof formStartedAt === 'number' ? formStartedAt : Date.parse(String(formStartedAt));
  if (!Number.isFinite(started)) return false;
  const elapsed = Date.now() - started;
  return elapsed >= 0 && elapsed < MIN_FORM_FILL_MS;
}

interface ContactRow {
  company_id?: string | null;
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

interface CustomFieldInput {
  fieldName: string;
  fieldLabel: string;
  fieldValue?: string;
}

// Caps for the public customFields path (mirrors tickets.ts PUT: title 200 /
// description 5000). No auth on this endpoint, so bound both the number of
// fields and their lengths in addition to the composed description below.
const MAX_CUSTOM_FIELDS = 30;
const MAX_FIELD_LABEL_LENGTH = 200;
const MAX_FIELD_VALUE_LENGTH = 2000;

// Get public templates (for public ticket form)
router.get('/templates', publicBrandingReadRateLimiter, (_req: Request, res: Response) => {
  try {
    const templates = db.prepare('SELECT id, name, description, title_template, description_template, priority, category_id FROM ticket_templates ORDER BY position ASC, name ASC').all() as TemplateRow[];

    // Attach fields to each template
    // Batch-load alla fält i en fråga — explicit kolumnlista exponerar bara det
    // som publika formuläret behöver; interna/känsliga kolumner hålls dolda.
    const allFields = db.prepare(
      'SELECT id, template_id, field_name, field_label, field_type, placeholder, required, options, position FROM template_fields ORDER BY position ASC'
    ).all() as (Record<string, unknown> & { template_id: string })[];
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
router.get('/categories', publicBrandingReadRateLimiter, (_req: Request, res: Response) => {
  try {
    const categories = db.prepare('SELECT id, label FROM categories ORDER BY position ASC, created_at ASC').all() as CategoryRow[];
    res.json(categories);
  } catch (error) {
    logger.error('Error fetching public categories:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Instance branding: which logo (if any) the client should render, with a
// cache-busting query param. { logoUrl: null } means "no custom logo — use
// the client's built-in default mark".
router.get('/branding', publicBrandingReadRateLimiter, (_req: Request, res: Response) => {
  try {
    res.json(getBrandingInfo());
  } catch (error) {
    logger.error('Error fetching branding info:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch branding info' });
  }
});

// Serves the configured logo's bytes. Unauthenticated by design (the logo
// must render on the public ticket form / login screen, before any session
// exists).
router.get('/branding/logo', publicBrandingReadRateLimiter, (_req: Request, res: Response) => {
  try {
    const logo = getStoredLogoPath();
    if (!logo) {
      return res.status(404).json({ error: 'No logo configured' });
    }

    // Content-Type comes from a server-defined map keyed by the stored mime
    // string (see lib/branding.ts) — never echoed from any user-controlled input.
    res.setHeader('Content-Type', logo.contentType);

    // SÄKERHETSUNDANTAG från attachments.ts-invarianten (som ALLTID tvingar
    // Content-Disposition: attachment): en logotyp måste RENDERAS av
    // webbläsaren, inte laddas ned, så vi sätter `inline` här. Det vilar på
    // TRE garantier, inte två — läs (2) noga, den är svagare än den låter:
    //   (1) lib/branding.ts:ALLOWED_LOGO_MIME_TYPES utesluter image/svg+xml
    //       (och alla andra script-bärande format).
    //   (2) hasValidLogoMagicBytes verifierar ett PREFIX av filens faktiska
    //       byte efter uppladdning (3 byte för JPEG, 8 för PNG, RIFF+4 fria
    //       byte+WEBP för WebP) — INTE att hela filen är en giltig,
    //       avkodningsbar bild. En polyglot som börjar med giltiga
    //       JPEG-magic-bytes och sedan fortsätter med
    //       `<script>alert(document.domain)</script>` PASSERAR den här
    //       kontrollen (verifierat i säkerhetsgranskning: upload 200, serve
    //       200, Content-Type: image/jpeg, Content-Disposition: inline).
    //       (2) ensam gör alltså INTE `inline` säkert.
    //   (3) `X-Content-Type-Options: nosniff` (satt av helmet i app.ts och av
    //       nginx på servernivå) hindrar webbläsaren från att sniffa om
    //       innehållet till text/html trots Content-Type: image/*. Det är
    //       DEN HÄR garantin som faktiskt neutraliserar polyglot-fallet ovan
    //       — se branding.test.ts som asserterar på headern.
    // Ändra ALDRIG denna route till att servera andra filtyper, och ta
    // ALDRIG bort nosniff-headern, utan att först ha ersatt (2) med en riktig
    // bildavkodning (t.ex. läsa in filen med ett bildbibliotek som verifierar
    // hela strukturen, inte bara de första byten).
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=300');

    // CORP: helmet sätter Cross-Origin-Resource-Policy: same-origin globalt
    // (app.ts), vilket gör att webbläsaren blockerar en <img>-laddning av den
    // här resursen så fort frontend och API ligger på olika origin — vilket
    // projektets dev-stack (och andra reverse-proxy-uppsättningar) gör. Denna
    // fil är AVSIKTLIGT publik, oautentiserad och icke-känslig — CORP skyddar
    // ingenting här — så vi mjukar upp den ENBART på det här svaret.
    // Generalisera INTE detta undantag till andra routes: attachments och
    // andra filer är fortfarande auktoriserade resurser som ska hålla
    // same-origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    res.sendFile(logo.path);
  } catch (error) {
    logger.error('Error serving branding logo:', { error: String(error) });
    res.status(500).json({ error: 'Failed to serve branding logo' });
  }
});

// Submit public ticket
router.post('/tickets', publicWriteRateLimiter, ticketImageSubmission, (req: Request, res: Response) => {
  let { name, email, title, description, category, priority, customFields, template_id } = req.body;
  const { website, formStartedAt } = req.body;

  // Honeypot: riktiga användare ser aldrig fältet. Boten får ett falskt
  // lyckat svar men ingenting sparas.
  if (typeof website === 'string' && website.trim() !== '') {
    logger.warn('Public ticket honeypot triggered', { ip: req.ip });
    return res.status(200).json({ message: 'Ticket submitted successfully', ticketId: randomUUID() });
  }
  if (formFillTooFast(formStartedAt)) {
    return res.status(400).json({ error: 'Formuläret skickades för snabbt. Vänta en stund och försök igen.' });
  }

  // Validate required fields
  if (!name || !email || !title) {
    return res.status(400).json({ error: 'Namn, e-post och ärenderubrik krävs.' });
  }

  // Icke-strängar (objekt, tal, array) skulle annars krascha längd-/regexkontrollerna till en 500.
  if (typeof name !== 'string' || typeof email !== 'string' || typeof title !== 'string'
    || (description != null && typeof description !== 'string')) {
    return res.status(400).json({ error: 'Namn, e-post, ärenderubrik och beskrivning måste vara text.' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Ogiltigt e-postformat.' });
  }

  // Validate lengths
  if (name.length > 100) {
    return res.status(400).json({ error: 'Namnet får vara högst 100 tecken.' });
  }
  if (title.length > 200) {
    return res.status(400).json({ error: 'Ärenderubriken får vara högst 200 tecken.' });
  }
  if (description && description.length > 5000) {
    return res.status(400).json({ error: 'Beskrivningen får vara högst 5000 tecken.' });
  }

  // Validate customFields shape and caps BEFORE any DB work, so a rejected
  // submission never creates a contact/ticket row as a side effect.
  if (customFields !== undefined) {
    if (!Array.isArray(customFields)) {
      return res.status(400).json({ error: 'Mallfält måste vara en lista.' });
    }
    if (customFields.length > MAX_CUSTOM_FIELDS) {
      return res.status(400).json({ error: `Högst ${MAX_CUSTOM_FIELDS} mallfält är tillåtna.` });
    }
    for (const field of customFields as CustomFieldInput[]) {
      // Icke-strängar (objekt/array/boolean) skulle annars kringgå caps och
      // krascha sanitize-html till en 500 — avvisa allt utom string/undefined.
      if (field?.fieldName !== undefined && typeof field.fieldName !== 'string') {
        return res.status(400).json({ error: 'Mallfältets namn måste vara text.' });
      }
      if (field?.fieldLabel !== undefined && typeof field.fieldLabel !== 'string') {
        return res.status(400).json({ error: 'Mallfältets etikett måste vara text.' });
      }
      if (field?.fieldValue !== undefined && typeof field.fieldValue !== 'string') {
        return res.status(400).json({ error: 'Mallfältets värde måste vara text.' });
      }
      if (typeof field?.fieldName === 'string' && field.fieldName.length > MAX_FIELD_LABEL_LENGTH) {
        return res.status(400).json({ error: `Mallfältets namn får vara högst ${MAX_FIELD_LABEL_LENGTH} tecken.` });
      }
      if (typeof field?.fieldLabel === 'string' && field.fieldLabel.length > MAX_FIELD_LABEL_LENGTH) {
        return res.status(400).json({ error: `Mallfältets etikett får vara högst ${MAX_FIELD_LABEL_LENGTH} tecken.` });
      }
      if (typeof field?.fieldValue === 'string' && field.fieldValue.length > MAX_FIELD_VALUE_LENGTH) {
        return res.status(400).json({ error: `Mallfältets värde får vara högst ${MAX_FIELD_VALUE_LENGTH} tecken.` });
      }
    }
  }

  // Validate priority
  const validPriorities = ['low', 'medium', 'high', 'critical'];
  const ticketPriority = validPriorities.includes(priority) ? priority : 'medium';

  // Defense-in-depth: sanitera HTML server-side. Public endpoint är extra
  // exponerad — okänd request-origin, ingen auth, så strikt sanitering.
  name = sanitizePlainText(name);
  title = sanitizePlainText(title);
  if (description !== undefined) description = sanitizeRichText(description);

  // Match internal templates: sanitize rich field values once and retain inline images.
  const sanitizedCustomFields = customFields === undefined ? [] : normalizeTemplateValues(customFields);
  if (!sanitizedCustomFields) return res.status(400).json({ error: 'Ogiltiga mallfält' });
  // Fältnamn och tom HTML räknas inte som ett ärendeinnehåll.
  const hasSubmittedContent = sanitizedCustomFields.length > 0
    ? sanitizedCustomFields.some(field => hasVisibleContent(field.fieldValue))
    : hasVisibleContent(description || '');
  if (!hasSubmittedContent
    && res.locals.ticketSubmission.files.length === 0) {
    return res.status(400).json({ error: 'Skriv en kort beskrivning eller bifoga en bild.' });
  }
  const fieldErrors = missingRequiredTemplateFields(typeof template_id === 'string' ? template_id : null, sanitizedCustomFields);
  if (Object.keys(fieldErrors).length) return res.status(400).json({ error: 'Fyll i obligatoriska mallfält', fieldErrors });
  const finalDescription = sanitizedCustomFields.length ? composeDescriptionFromFields(sanitizedCustomFields) : description || '';

  // The composed description shares the same cap as a free-text description.
  if (finalDescription.length > 5000) {
    return res.status(400).json({ error: 'Beskrivningen får vara högst 5000 tecken.' });
  }

  try {
    // Kontakt, ärende och fältvärden skrivs i en transaktion så ett fel
    // mitt i inte lämnar en föräldralös kontakt eller ett ärende utan fält.
    const createTicket = db.transaction(() => {
      // Find or create contact (e-post matchas skiftlägesokänsligt)
      const now = new Date().toISOString();
      let contact = db.prepare('SELECT id, name, email, company_id FROM contacts WHERE lower(email) = lower(?)').get(email) as ContactRow | undefined;

      if (!contact) {
        const contactId = randomUUID();
        db.prepare('INSERT INTO contacts (id, name, email, created_at) VALUES (?, ?, ?, ?)').run(contactId, name, email, now);
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

      // Validate template exists if provided. Coerce to NULL on miss instead of
      // 400 — en publik inlämnare ska inte blockeras av ett trasigt template_id.
      let templateId: string | null = null;
      if (template_id) {
        const tpl = db.prepare('SELECT id FROM ticket_templates WHERE id = ?').get(template_id);
        if (tpl) {
          templateId = template_id;
        } else {
          logger.warn('Public ticket submitted with unknown template_id — coercing to NULL', { template_id: String(template_id) });
        }
      }

      // finalDescription was already composed (from sanitizedCustomFields or
      // description) and length-validated above, before any DB writes.
      const ticketId = randomUUID();
      db.prepare(`
        INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, template_id, company_id, created_at, updated_at)
        VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
      `).run(ticketId, title, finalDescription, ticketPriority, categoryId, contact.id, templateId, contact.company_id || null, now, now);

      // FTS5 synkas automatiskt via triggers (migration 050)

      // Store custom field values if provided (already sanitized above)
      if (sanitizedCustomFields.length > 0) {
        const insertFieldStmt = db.prepare(`
          INSERT INTO ticket_field_values (id, ticket_id, field_name, field_label, field_value, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        sanitizedCustomFields.forEach((field) => {
          if (field.fieldName && field.fieldLabel) {
            insertFieldStmt.run(randomUUID(), ticketId, field.fieldName, field.fieldLabel, field.fieldValue || '', now);
          }
        });
      }

      commitTicketImages(res, ticketId);
      return { ticketId, categoryId, contact };
    });

    const { ticketId, categoryId, contact } = createTicket();

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


    res.status(201).json({
      message: 'Ticket submitted successfully',
      ticketId
    });
  } catch (error) {
    logger.error('Error creating public ticket:', { error: String(error) });
    res.status(500).json({ error: 'Failed to submit ticket' });
  }
});

export default router;
