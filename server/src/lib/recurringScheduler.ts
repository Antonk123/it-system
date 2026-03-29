import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';

interface RecurringTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  priority: string;
  category_id: string | null;
  tags: string;
  interval_type: 'daily' | 'weekly' | 'monthly';
  interval_day: number | null;
  is_active: number;
  last_run: string | null;
  next_run: string;
}

/**
 * Compute next ISO timestamp for a given interval type and optional day.
 * Always computed from now (not from old next_run) to avoid drift.
 *
 * - daily: next calendar day at midnight local time
 * - weekly: next occurrence of intervalDay (0=Sun..6=Sat), always at least 1 day ahead
 * - monthly: next month on Math.min(intervalDay, daysInMonth) at midnight
 */
export function computeNextRun(
  intervalType: 'daily' | 'weekly' | 'monthly',
  intervalDay: number | null | undefined,
  fromDate: Date = new Date()
): string {
  const next = new Date(fromDate);

  if (intervalType === 'daily') {
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  } else if (intervalType === 'weekly') {
    const target = intervalDay ?? 1; // default Monday
    const current = next.getDay();
    const daysUntil = (target - current + 7) % 7 || 7;
    next.setDate(next.getDate() + daysUntil);
    next.setHours(0, 0, 0, 0);
  } else if (intervalType === 'monthly') {
    const targetDay = intervalDay ?? 1; // default 1st of month
    // Move to next month
    next.setMonth(next.getMonth() + 1);
    // Clamp day to last valid day of that month (Pitfall 2: day-31 edge case)
    const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(targetDay, daysInMonth));
    next.setHours(0, 0, 0, 0);
  }

  return next.toISOString();
}

/**
 * Creates a ticket from a recurring template.
 * Runs inside a transaction for atomicity.
 */
function createTicketFromTemplate(template: RecurringTemplate): void {
  const ticketId = uuidv4();
  const now = new Date().toISOString();

  // Parse tags JSON, default to empty array on failure
  let tagIds: string[] = [];
  try {
    const parsed = JSON.parse(template.tags || '[]');
    if (Array.isArray(parsed)) {
      tagIds = parsed;
    }
  } catch {
    tagIds = [];
  }

  // Filter out tag IDs that no longer exist (Pitfall 4: stale tag refs)
  let validTagIds: string[] = [];
  if (tagIds.length > 0) {
    const placeholders = tagIds.map(() => '?').join(',');
    const existingTags = db.prepare(
      `SELECT id FROM tags WHERE id IN (${placeholders})`
    ).all(...tagIds) as { id: string }[];
    validTagIds = existingTags.map(t => t.id);

    if (validTagIds.length < tagIds.length) {
      const removed = tagIds.filter(id => !validTagIds.includes(id));
      console.warn(`Recurring: removed stale tag IDs for template ${template.name}: ${removed.join(', ')}`);
    }
  }

  const createTransaction = db.transaction(() => {
    // Insert ticket
    db.prepare(`
      INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, notes, solution, template_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ticketId,
      template.title,
      template.description,
      'open',
      template.priority,
      template.category_id || null,
      null, // requester_id — system-created
      null, // notes
      null, // solution
      null  // template_id (not referencing ticket_templates)
    );

    // Insert ticket tags
    if (validTagIds.length > 0) {
      const insertTag = db.prepare('INSERT INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)');
      for (const tagId of validTagIds) {
        insertTag.run(ticketId, tagId);
      }
    }

    // Insert ticket history (system action: user_id=NULL)
    db.prepare(`
      INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), ticketId, null, 'created', null, 'recurring:' + template.id);

    // Insert recurring ticket history
    db.prepare(`
      INSERT INTO recurring_ticket_history (id, template_id, ticket_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), template.id, ticketId, now);

    // Advance next_run on the template
    const nextRun = computeNextRun(template.interval_type, template.interval_day);
    db.prepare(`
      UPDATE recurring_templates
      SET last_run = ?, next_run = ?, updated_at = ?
      WHERE id = ?
    `).run(now, nextRun, now, template.id);
  });

  createTransaction();
  console.log(`Recurring: created ticket ${ticketId} from template ${template.name}`);
}

/**
 * Finds all due active recurring templates and creates tickets from them.
 */
function processRecurringTemplates(): void {
  const now = new Date().toISOString();

  const dueTemplates = db.prepare(`
    SELECT * FROM recurring_templates
    WHERE is_active = 1 AND next_run <= ?
  `).all(now) as RecurringTemplate[];

  if (dueTemplates.length === 0) return;

  console.log(`Recurring: processing ${dueTemplates.length} due template(s)`);

  for (const template of dueTemplates) {
    try {
      createTicketFromTemplate(template);
    } catch (error) {
      console.error(`Recurring: failed to create ticket from template ${template.name}:`, error);
    }
  }
}

/**
 * Registers the recurring ticket scheduler to run every minute.
 */
export function startRecurringScheduler(): void {
  cron.schedule('* * * * *', () => {
    try {
      processRecurringTemplates();
    } catch (error) {
      console.error('Recurring scheduler error:', error);
    }
  });

  console.log('Recurring ticket scheduler enabled (every minute)');
}
