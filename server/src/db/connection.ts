import Database, { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/database.sqlite');

export const db: DatabaseType = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Enable WAL mode for better concurrency and performance
// WAL mode allows concurrent readers and writers, improving performance
db.pragma('journal_mode = WAL');

// Set synchronous mode to NORMAL for better write performance
// NORMAL is safe for most applications and much faster than FULL
db.pragma('synchronous = NORMAL');

// Increase cache size to 64MB for better performance
db.pragma('cache_size = -64000');

const tableExists = (name: string) => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { name: string } | undefined;
  return !!row;
};

const VALID_TABLE_NAMES = new Set([
  'tickets', 'categories', 'contacts', 'users', 'tags', 'ticket_tags',
  'ticket_templates', 'template_checklists', 'template_fields', 'ticket_field_values',
  'ticket_attachments', 'ticket_comments', 'ticket_history', 'ticket_reminders',
  'ticket_checklists', 'checklist_templates', 'checklist_template_items',
  'kb_articles', 'kb_articles_fts', 'kb_categories', 'kb_article_tags', 'kb_article_links', 'kb_article_shares',
  'recurring_templates', 'recurring_ticket_history', 'filter_views',
  'time_entries',
  'push_subscriptions',
]);

const columnExists = (tableName: string, columnName: string) => {
  if (!VALID_TABLE_NAMES.has(tableName)) {
    throw new Error(`columnExists: unknown table "${tableName}"`);
  }
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return columns.some((column) => column.name === columnName);
};

const ensureCategoryPositionColumn = () => {
  if (!tableExists('categories')) {
    return;
  }

  if (!columnExists('categories', 'position')) {
    db.exec('ALTER TABLE categories ADD COLUMN position INTEGER DEFAULT 0;');
    try {
      db.exec(`
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) - 1 AS pos
          FROM categories
        )
        UPDATE categories
        SET position = (SELECT pos FROM ordered WHERE ordered.id = categories.id)
      `);
    } catch (error) {
      console.warn('Could not backfill category positions automatically:', error);
    }
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_categories_position ON categories(position);');
};

const ensureTicketTemplateIdColumn = () => {
  if (!tableExists('tickets')) {
    return;
  }
  if (!columnExists('tickets', 'template_id')) {
    db.exec('ALTER TABLE tickets ADD COLUMN template_id TEXT;');
    console.log('Added template_id column to tickets table');
  }
};

const ensureTicketTemplatesTable = () => {
  if (tableExists('ticket_templates')) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      title_template TEXT NOT NULL,
      description_template TEXT NOT NULL,
      priority TEXT DEFAULT 'medium',
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      notes_template TEXT,
      solution_template TEXT,
      position INTEGER DEFAULT 0,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_templates_position ON ticket_templates(position);
  `);
  console.log('Created missing table: ticket_templates');

  // Insert default templates
  const defaultTemplates = [
    {
      id: 'template-3',
      name: 'Hårdvarubeställning',
      description: 'Mall för hårdvarubeställning',
      title_template: 'Hårdvarubeställning: [typ av utrustning]',
      description_template: 'Beställning av ny hårdvara.\n\nTyp av utrustning: \nAntal: \nMotivering: \nBudget: \nLeveransadress: \n\nSpecifikationer:\n',
      priority: 'low',
      notes_template: 'Säkerställ att budget finns innan beställning.',
      position: 0
    }
  ];

  const insertStmt = db.prepare(`
    INSERT INTO ticket_templates (id, name, description, title_template, description_template, priority, notes_template, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const template of defaultTemplates) {
    insertStmt.run(
      template.id,
      template.name,
      template.description,
      template.title_template,
      template.description_template,
      template.priority,
      template.notes_template,
      template.position
    );
  }
  console.log('Inserted default ticket templates');
};

const ensureTemplateChecklistsTable = () => {
  if (tableExists('template_checklists')) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS template_checklists (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES ticket_templates(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_template_checklists_template ON template_checklists(template_id);
  `);
  console.log('Created missing table: template_checklists');
};

const ensureTemplateFieldsTable = () => {
  if (tableExists('template_fields')) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS template_fields (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES ticket_templates(id) ON DELETE CASCADE,
      field_name TEXT NOT NULL,
      field_label TEXT NOT NULL,
      field_type TEXT NOT NULL CHECK(field_type IN ('text', 'textarea', 'number', 'select', 'date', 'checkbox')),
      placeholder TEXT,
      default_value TEXT,
      required INTEGER DEFAULT 0,
      options TEXT,
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_template_fields_template ON template_fields(template_id);
    CREATE INDEX IF NOT EXISTS idx_template_fields_position ON template_fields(position);
  `);
  console.log('Created missing table: template_fields');

  // Add sample fields for "Hårdvarubeställning" template
  const hardwareTemplate = db.prepare("SELECT id FROM ticket_templates WHERE name = ?").get("Hårdvarubeställning") as { id: string } | undefined;
  if (hardwareTemplate) {
    const existingFields = db.prepare("SELECT COUNT(*) as count FROM template_fields WHERE template_id = ?").get(hardwareTemplate.id) as { count: number };
    if (existingFields.count === 0) {
      const fields = [
        { name: 'equipment_type', label: 'Typ av utrustning', type: 'text', placeholder: 'T.ex. Dell Monitor', required: 1, position: 0 },
        { name: 'quantity', label: 'Antal', type: 'number', placeholder: '1', required: 1, position: 1 },
        { name: 'justification', label: 'Motivering', type: 'textarea', placeholder: 'Beskriv varför denna utrustning behövs...', required: 1, position: 2 },
        { name: 'budget', label: 'Budget', type: 'text', placeholder: 'T.ex. 5000 SEK', required: 0, position: 3 },
        { name: 'delivery_address', label: 'Leveransadress', type: 'text', placeholder: 'Kontor och avdelning', required: 0, position: 4 },
        { name: 'specifications', label: 'Specifikationer', type: 'textarea', placeholder: 'Detaljerade tekniska krav...', required: 0, position: 5 }
      ];

      const insertStmt = db.prepare(`
        INSERT INTO template_fields (id, template_id, field_name, field_label, field_type, placeholder, required, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const field of fields) {
        insertStmt.run(randomUUID(), hardwareTemplate.id, field.name, field.label, field.type, field.placeholder, field.required, field.position);
      }
      console.log('Inserted default template fields for Hårdvarubeställning');
    }
  }

};

const ensureTicketFieldValuesTable = () => {
  if (tableExists('ticket_field_values')) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_field_values (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      field_name TEXT NOT NULL,
      field_label TEXT NOT NULL,
      field_value TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_field_values_ticket ON ticket_field_values(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_field_values_field ON ticket_field_values(field_name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_field_values_unique ON ticket_field_values(ticket_id, field_name);
  `);
  console.log('Created missing table: ticket_field_values');
};

const ensureTicketAttachmentsTable = () => {
  if (tableExists('ticket_attachments')) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_attachments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      file_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON ticket_attachments(ticket_id);
  `);
  console.log('Created missing table: ticket_attachments');
};

const ensureTicketCommentsTable = () => {
  if (tableExists('ticket_comments')) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_internal INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_comments_created ON ticket_comments(created_at);
    CREATE TRIGGER IF NOT EXISTS update_comment_updated_at
    AFTER UPDATE ON ticket_comments
    FOR EACH ROW
    BEGIN
      UPDATE ticket_comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);
  console.log('Created missing table: ticket_comments');
};

const ensureTicketHistoryTable = () => {
  if (tableExists('ticket_history')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_history (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      user_id TEXT,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_history_changed ON ticket_history(changed_at);
  `);
  console.log('Created missing table: ticket_history');
};

const ensureTicketRemindersTable = () => {
  if (tableExists('ticket_reminders')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_reminders (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reminder_time TEXT NOT NULL,
      message TEXT,
      sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      sent_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_ticket ON ticket_reminders(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_user ON ticket_reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_time ON ticket_reminders(reminder_time);
    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_sent ON ticket_reminders(sent);
  `);
  console.log('Created missing table: ticket_reminders');
};

const ensureChecklistExtensions = () => {
  if (!tableExists('ticket_checklists')) return;
  if (!columnExists('ticket_checklists', 'parent_id')) {
    db.exec('ALTER TABLE ticket_checklists ADD COLUMN parent_id TEXT REFERENCES ticket_checklists(id) ON DELETE CASCADE;');
    console.log('Added parent_id column to ticket_checklists');
  }
  if (!columnExists('ticket_checklists', 'due_date')) {
    db.exec('ALTER TABLE ticket_checklists ADD COLUMN due_date TEXT;');
    console.log('Added due_date column to ticket_checklists');
  }
};

const ensureChecklistTemplatesTable = () => {
  if (tableExists('checklist_templates')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS checklist_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS checklist_template_items (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      parent_label TEXT,
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_checklist_templates_name ON checklist_templates(name);
    CREATE INDEX IF NOT EXISTS idx_checklist_template_items_template ON checklist_template_items(template_id);
  `);
  console.log('Created checklist_templates and checklist_template_items tables');
};

function stripHtmlForFts(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const ensureRecurringTemplatesTable = () => {
  if (tableExists('recurring_templates')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      tags TEXT DEFAULT '[]',
      interval_type TEXT NOT NULL CHECK(interval_type IN ('daily','weekly','monthly')),
      interval_day INTEGER,
      is_active INTEGER DEFAULT 1,
      last_run TEXT,
      next_run TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_templates_next_run ON recurring_templates(is_active, next_run);
    CREATE TABLE IF NOT EXISTS recurring_ticket_history (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_history_template ON recurring_ticket_history(template_id, created_at DESC);
  `);
  console.log('Created missing tables: recurring_templates, recurring_ticket_history');
};

const ensureKbV2Columns = () => {
  if (!tableExists('kb_articles')) return;

  if (!columnExists('kb_articles', 'status')) {
    db.exec(`ALTER TABLE kb_articles ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published'));`);
    console.log('Added status column to kb_articles');
  }
  if (!columnExists('kb_articles', 'view_count')) {
    db.exec(`ALTER TABLE kb_articles ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;`);
    console.log('Added view_count column to kb_articles');
  }
};

const ensureKbArticleTagsTable = () => {
  if (tableExists('kb_article_tags')) return;
  // Fresh install: create with tag_id FK from the start
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_article_tags (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(article_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kb_article_tags_article ON kb_article_tags(article_id);
    CREATE INDEX IF NOT EXISTS idx_kb_article_tags_tag ON kb_article_tags(tag_id);
  `);
  console.log('Created table: kb_article_tags');
};

const ensureKbArticleTagsUseSharedTags = () => {
  if (!tableExists('kb_article_tags')) return;
  if (columnExists('kb_article_tags', 'tag_id')) return;

  const existingTextTags = db.prepare('SELECT DISTINCT tag FROM kb_article_tags').all() as { tag: string }[];
  const findTag = db.prepare('SELECT id FROM tags WHERE LOWER(name) = LOWER(?)');
  const createTag = db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)');
  const tagNameToId = new Map<string, string>();
  const now = new Date().toISOString();
  for (const { tag } of existingTextTags) {
    const existing = findTag.get(tag) as { id: string } | undefined;
    if (existing) {
      tagNameToId.set(tag, existing.id);
    } else {
      const newId = randomUUID();
      createTag.run(newId, tag, '#3b82f6', now);
      tagNameToId.set(tag, newId);
    }
  }

  db.exec('ALTER TABLE kb_article_tags ADD COLUMN tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE;');

  const updateStmt = db.prepare('UPDATE kb_article_tags SET tag_id = ? WHERE tag = ?');
  for (const [tagText, tagId] of tagNameToId.entries()) {
    updateStmt.run(tagId, tagText);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_kb_article_tags_tag_id ON kb_article_tags(tag_id);');
  console.log(`Migrated kb_article_tags to shared tags (${existingTextTags.length} unique tags)`);
};

const ensureTimeEntriesTable = () => {
  if (tableExists('time_entries')) return;
  db.prepare(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
      note TEXT CHECK(note IS NULL OR length(note) <= 500),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_time_entries_ticket ON time_entries(ticket_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_time_entries_created ON time_entries(created_at DESC)').run();
  console.log('Created missing table: time_entries');
};

const ensureKbArticleLinksTable = () => {
  if (tableExists('kb_article_links')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_article_links (
      id TEXT PRIMARY KEY,
      source_article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      target_article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_article_id, target_article_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kb_article_links_source ON kb_article_links(source_article_id);
    CREATE INDEX IF NOT EXISTS idx_kb_article_links_target ON kb_article_links(target_article_id);
  `);
  console.log('Created table: kb_article_links');
};

const ensureKbReviewColumn = () => {
  if (!tableExists('kb_articles')) return;
  if (columnExists('kb_articles', 'last_reviewed_at')) return;
  db.exec(`ALTER TABLE kb_articles ADD COLUMN last_reviewed_at TEXT;`);
  console.log('Added last_reviewed_at column to kb_articles');
};

const ensureKbFts5AndType = () => {
  if (!tableExists('kb_articles')) return;

  // Create FTS5 virtual table if missing
  if (!tableExists('kb_articles_fts')) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts
        USING fts5(title, content_plain, content='', tokenize='unicode61');
    `);
    console.log('Created kb_articles_fts virtual table');
  }

  // Drop the broken delete trigger (it used DELETE on a contentless FTS5 table which throws)
  db.exec(`DROP TRIGGER IF EXISTS kb_articles_fts_delete;`);

  // Add article_type column if missing
  if (!columnExists('kb_articles', 'article_type')) {
    db.exec(`ALTER TABLE kb_articles ADD COLUMN article_type TEXT CHECK(article_type IN ('how-to', 'solution'));`);
    console.log('Added article_type column to kb_articles');
  }

  // Backfill FTS if empty
  const ftsCount = (db.prepare('SELECT COUNT(*) as count FROM kb_articles_fts').get() as { count: number }).count;
  if (ftsCount === 0) {
    const articles = db.prepare('SELECT rowid, title, content FROM kb_articles').all() as { rowid: number; title: string; content: string }[];
    if (articles.length > 0) {
      const stmt = db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)');
      const backfill = db.transaction(() => { for (const a of articles) stmt.run(a.rowid, a.title, stripHtmlForFts(a.content)); });
      backfill();
      console.log(`Backfilled ${articles.length} articles into kb_articles_fts`);
    }
  }
};

const ensureDefaultTemplatesRemoved = () => {
  // Null out FK references first — safe to run multiple times
  db.prepare(
    "UPDATE tickets SET template_id = NULL WHERE template_id IN (SELECT id FROM ticket_templates WHERE name IN ('Lösenordsåterställning', 'Ny användare'))"
  ).run();
  // Delete by name — ON DELETE CASCADE removes associated template_fields and template_checklists
  db.prepare(
    "DELETE FROM ticket_templates WHERE name IN ('Lösenordsåterställning', 'Ny användare')"
  ).run();
};

const ensurePushSubscriptionsTable = () => {
  if (tableExists('push_subscriptions')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
  `);
  console.log('Created missing table: push_subscriptions');
};

export function initializeDatabase() {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  db.exec(schema);
  ensureTicketAttachmentsTable();
  ensureTicketCommentsTable();
  ensureCategoryPositionColumn();
  ensureTicketTemplateIdColumn();
  ensureTicketTemplatesTable();
  ensureTemplateChecklistsTable();
  ensureTemplateFieldsTable();
  ensureDefaultTemplatesRemoved();
  ensureTicketFieldValuesTable();
  ensureTicketHistoryTable();
  ensureTicketRemindersTable();
  ensureChecklistExtensions();
  ensureChecklistTemplatesTable();
  ensureKbFts5AndType();
  ensureKbV2Columns();
  ensureKbArticleTagsTable();
  ensureKbArticleTagsUseSharedTags();
  ensureKbReviewColumn();
  ensureRecurringTemplatesTable();
  ensureKbArticleLinksTable();
  ensureTimeEntriesTable();
  ensurePushSubscriptionsTable();
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_closed_at ON tickets(status, closed_at DESC)');
  console.log('Database initialized successfully');
}

export function closeDatabase() {
  db.close();
}
