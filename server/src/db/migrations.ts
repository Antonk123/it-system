import type { Database as DatabaseType } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { stripHtml } from '../lib/htmlUtils.js';

interface MigrationHelpers {
  tableExists: (name: string) => boolean;
  columnExists: (table: string, column: string) => boolean;
}

export interface Migration {
  id: string;
  name: string;
  up: (db: DatabaseType, helpers: MigrationHelpers) => void;
}

export const migrations: Migration[] = [
  {
    id: '001',
    name: 'ensure_ticket_attachments_table',
    up: (db, { tableExists }) => {
      if (tableExists('ticket_attachments')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS ticket_attachments (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL, file_path TEXT NOT NULL,
        file_size INTEGER, file_type TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON ticket_attachments(ticket_id)').run();
    },
  },
  {
    id: '002',
    name: 'ensure_ticket_comments_table',
    up: (db, { tableExists }) => {
      if (tableExists('ticket_comments')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS ticket_comments (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL, is_internal INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT DEFAULT NULL
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_comments_created ON ticket_comments(created_at)').run();
      // Trigger uses BEGIN...END with internal semicolons — needs exec for multi-statement DDL
      db.exec(`CREATE TRIGGER IF NOT EXISTS update_comment_updated_at
        AFTER UPDATE ON ticket_comments FOR EACH ROW BEGIN
          UPDATE ticket_comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`);
    },
  },
  {
    id: '003',
    name: 'ensure_category_position_column',
    up: (db, { tableExists, columnExists }) => {
      if (!tableExists('categories')) return;
      if (!columnExists('categories', 'position')) {
        db.prepare('ALTER TABLE categories ADD COLUMN position INTEGER DEFAULT 0').run();
        try {
          db.prepare(`WITH ordered AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) - 1 AS pos FROM categories
          ) UPDATE categories SET position = (SELECT pos FROM ordered WHERE ordered.id = categories.id)`).run();
        } catch (e) {
          console.warn('Could not backfill category positions:', e);
        }
      }
      db.prepare('CREATE INDEX IF NOT EXISTS idx_categories_position ON categories(position)').run();
    },
  },
  {
    id: '004',
    name: 'ensure_ticket_template_id_column',
    up: (db, { tableExists, columnExists }) => {
      if (!tableExists('tickets')) return;
      if (!columnExists('tickets', 'template_id')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN template_id TEXT').run();
      }
    },
  },
  {
    id: '005',
    name: 'ensure_ticket_templates_table',
    up: (db, { tableExists }) => {
      if (tableExists('ticket_templates')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS ticket_templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
        title_template TEXT NOT NULL, description_template TEXT NOT NULL,
        priority TEXT DEFAULT 'medium',
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        notes_template TEXT, solution_template TEXT,
        position INTEGER DEFAULT 0,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_templates_position ON ticket_templates(position)').run();
      db.prepare(`INSERT INTO ticket_templates
        (id, name, description, title_template, description_template, priority, notes_template, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'template-3', 'Hårdvarubeställning', 'Mall för hårdvarubeställning',
        'Hårdvarubeställning: [typ av utrustning]',
        'Beställning av ny hårdvara.\n\nTyp av utrustning: \nAntal: \nMotivering: \nBudget: \nLeveransadress: \n\nSpecifikationer:\n',
        'low', 'Säkerställ att budget finns innan beställning.', 0
      );
    },
  },
  {
    id: '006',
    name: 'ensure_template_checklists_table',
    up: (db, { tableExists }) => {
      if (tableExists('template_checklists')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS template_checklists (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES ticket_templates(id) ON DELETE CASCADE,
        label TEXT NOT NULL, position INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_template_checklists_template ON template_checklists(template_id)').run();
    },
  },
  {
    id: '007',
    name: 'ensure_template_fields_table',
    up: (db, { tableExists }) => {
      if (tableExists('template_fields')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS template_fields (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES ticket_templates(id) ON DELETE CASCADE,
        field_name TEXT NOT NULL, field_label TEXT NOT NULL,
        field_type TEXT NOT NULL CHECK(field_type IN ('text','textarea','number','select','date','checkbox')),
        placeholder TEXT, default_value TEXT, required INTEGER DEFAULT 0,
        options TEXT, position INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_template_fields_template ON template_fields(template_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_template_fields_position ON template_fields(position)').run();
      const tmpl = db.prepare("SELECT id FROM ticket_templates WHERE name = ?").get('Hårdvarubeställning') as { id: string } | undefined;
      if (!tmpl) return;
      const count = (db.prepare("SELECT COUNT(*) as n FROM template_fields WHERE template_id = ?").get(tmpl.id) as { n: number }).n;
      if (count > 0) return;
      const ins = db.prepare(`INSERT INTO template_fields (id, template_id, field_name, field_label, field_type, placeholder, required, position) VALUES (?,?,?,?,?,?,?,?)`);
      [
        ['equipment_type','Typ av utrustning','text','T.ex. Dell Monitor',1,0],
        ['quantity','Antal','number','1',1,1],
        ['justification','Motivering','textarea','Beskriv varför...',1,2],
        ['budget','Budget','text','T.ex. 5000 SEK',0,3],
        ['delivery_address','Leveransadress','text','Kontor och avdelning',0,4],
        ['specifications','Specifikationer','textarea','Detaljerade tekniska krav...',0,5],
      ].forEach(([n,l,t,p,r,pos]) => ins.run(randomUUID(), tmpl.id, n, l, t, p, r, pos));
    },
  },
  {
    id: '008',
    name: 'ensure_default_templates_removed',
    up: (db, { tableExists }) => {
      if (!tableExists('ticket_templates')) return;
      db.prepare("UPDATE tickets SET template_id = NULL WHERE template_id IN (SELECT id FROM ticket_templates WHERE name IN ('Lösenordsåterställning', 'Ny användare'))").run();
      db.prepare("DELETE FROM ticket_templates WHERE name IN ('Lösenordsåterställning', 'Ny användare')").run();
    },
  },
  {
    id: '009',
    name: 'ensure_ticket_field_values_table',
    up: (db, { tableExists }) => {
      if (tableExists('ticket_field_values')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS ticket_field_values (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        field_name TEXT NOT NULL, field_label TEXT NOT NULL, field_value TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_field_values_ticket ON ticket_field_values(ticket_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_field_values_field ON ticket_field_values(field_name)').run();
      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_field_values_unique ON ticket_field_values(ticket_id, field_name)').run();
    },
  },
  {
    id: '010',
    name: 'ensure_ticket_history_table',
    up: (db, { tableExists }) => {
      if (tableExists('ticket_history')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS ticket_history (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id TEXT, field_name TEXT NOT NULL, old_value TEXT, new_value TEXT,
        changed_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_history_changed ON ticket_history(changed_at)').run();
    },
  },
  {
    id: '011',
    name: 'ensure_ticket_reminders_table',
    up: (db, { tableExists }) => {
      if (tableExists('ticket_reminders')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS ticket_reminders (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reminder_time TEXT NOT NULL, message TEXT, sent INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT DEFAULT NULL
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_reminders_ticket ON ticket_reminders(ticket_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_reminders_user ON ticket_reminders(user_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_reminders_time ON ticket_reminders(reminder_time)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ticket_reminders_sent ON ticket_reminders(sent)').run();
    },
  },
  {
    id: '012',
    name: 'ensure_checklist_extensions',
    up: (db, { tableExists, columnExists }) => {
      if (!tableExists('ticket_checklists')) return;
      if (!columnExists('ticket_checklists', 'parent_id'))
        db.prepare('ALTER TABLE ticket_checklists ADD COLUMN parent_id TEXT REFERENCES ticket_checklists(id) ON DELETE CASCADE').run();
      if (!columnExists('ticket_checklists', 'due_date'))
        db.prepare('ALTER TABLE ticket_checklists ADD COLUMN due_date TEXT').run();
    },
  },
  {
    id: '013',
    name: 'ensure_checklist_templates_table',
    up: (db, { tableExists }) => {
      if (tableExists('checklist_templates')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS checklist_templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare(`CREATE TABLE IF NOT EXISTS checklist_template_items (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
        label TEXT NOT NULL, parent_label TEXT, position INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_checklist_templates_name ON checklist_templates(name)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_checklist_template_items_template ON checklist_template_items(template_id)').run();
    },
  },
  {
    id: '014',
    name: 'ensure_kb_fts5_and_type',
    up: (db, { tableExists, columnExists }) => {
      if (!tableExists('kb_articles')) return;
      if (!tableExists('kb_articles_fts'))
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts USING fts5(title, content_plain, content='', tokenize='unicode61')`);
      db.prepare('DROP TRIGGER IF EXISTS kb_articles_fts_delete').run();
      if (!columnExists('kb_articles', 'article_type'))
        db.prepare(`ALTER TABLE kb_articles ADD COLUMN article_type TEXT CHECK(article_type IN ('how-to', 'solution'))`).run();
      const ftsCount = (db.prepare('SELECT COUNT(*) as count FROM kb_articles_fts').get() as { count: number }).count;
      if (ftsCount === 0) {
        const articles = db.prepare('SELECT rowid, title, content FROM kb_articles').all() as { rowid: number; title: string; content: string }[];
        if (articles.length > 0) {
          const stmt = db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)');
          db.transaction(() => { for (const a of articles) stmt.run(a.rowid, a.title, stripHtml(a.content)); })();
        }
      }
    },
  },
  {
    id: '015',
    name: 'ensure_kb_v2_columns',
    up: (db, { tableExists, columnExists }) => {
      if (!tableExists('kb_articles')) return;
      if (!columnExists('kb_articles', 'status'))
        db.prepare(`ALTER TABLE kb_articles ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published'))`).run();
      if (!columnExists('kb_articles', 'view_count'))
        db.prepare('ALTER TABLE kb_articles ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0').run();
    },
  },
  {
    id: '016',
    name: 'ensure_kb_article_tags_table',
    up: (db, { tableExists }) => {
      if (tableExists('kb_article_tags')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS kb_article_tags (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(article_id, tag_id)
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_kb_article_tags_article ON kb_article_tags(article_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_kb_article_tags_tag ON kb_article_tags(tag_id)').run();
    },
  },
  {
    id: '017',
    name: 'ensure_kb_article_tags_use_shared_tags',
    up: (db, { tableExists, columnExists }) => {
      if (!tableExists('kb_article_tags')) return;
      if (columnExists('kb_article_tags', 'tag_id')) return;
      // Only migrate legacy text-tag data if the old 'tag' column exists
      if (columnExists('kb_article_tags', 'tag')) {
        const existingTags = db.prepare('SELECT DISTINCT tag FROM kb_article_tags').all() as { tag: string }[];
        const findTag = db.prepare('SELECT id FROM tags WHERE LOWER(name) = LOWER(?)');
        const createTag = db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)');
        const tagNameToId = new Map<string, string>();
        const now = new Date().toISOString();
        for (const { tag } of existingTags) {
          const ex = findTag.get(tag) as { id: string } | undefined;
          if (ex) { tagNameToId.set(tag, ex.id); }
          else { const id = randomUUID(); createTag.run(id, tag, '#3b82f6', now); tagNameToId.set(tag, id); }
        }
        db.prepare('ALTER TABLE kb_article_tags ADD COLUMN tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE').run();
        const upd = db.prepare('UPDATE kb_article_tags SET tag_id = ? WHERE tag = ?');
        for (const [t, id] of tagNameToId.entries()) upd.run(id, t);
      } else {
        // No legacy data to migrate — just add the column
        db.prepare('ALTER TABLE kb_article_tags ADD COLUMN tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE').run();
      }
      db.prepare('CREATE INDEX IF NOT EXISTS idx_kb_article_tags_tag_id ON kb_article_tags(tag_id)').run();
    },
  },
  {
    id: '018',
    name: 'ensure_kb_review_column',
    up: (db, { tableExists, columnExists }) => {
      if (!tableExists('kb_articles')) return;
      // NOTE: Guard is inverted vs plan — return if column ALREADY exists (correct idempotency)
      if (columnExists('kb_articles', 'last_reviewed_at')) return;
      db.prepare('ALTER TABLE kb_articles ADD COLUMN last_reviewed_at TEXT').run();
    },
  },
  {
    id: '019',
    name: 'ensure_recurring_templates_table',
    up: (db, { tableExists }) => {
      if (tableExists('recurring_templates')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS recurring_templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        tags TEXT DEFAULT '[]',
        interval_type TEXT NOT NULL CHECK(interval_type IN ('daily','weekly','monthly')),
        interval_day INTEGER, is_active INTEGER DEFAULT 1,
        last_run TEXT, next_run TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_recurring_templates_next_run ON recurring_templates(is_active, next_run)').run();
      db.prepare(`CREATE TABLE IF NOT EXISTS recurring_ticket_history (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_recurring_history_template ON recurring_ticket_history(template_id, created_at DESC)').run();
    },
  },
  {
    id: '020',
    name: 'ensure_kb_article_links_table',
    up: (db, { tableExists }) => {
      if (tableExists('kb_article_links')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS kb_article_links (
        id TEXT PRIMARY KEY,
        source_article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
        target_article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_article_id, target_article_id)
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_kb_article_links_source ON kb_article_links(source_article_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_kb_article_links_target ON kb_article_links(target_article_id)').run();
    },
  },
  {
    id: '021',
    name: 'ensure_time_entries_table',
    up: (db, { tableExists }) => {
      if (tableExists('time_entries')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
        note TEXT CHECK(note IS NULL OR length(note) <= 500),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_time_entries_ticket ON time_entries(ticket_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_time_entries_created ON time_entries(created_at DESC)').run();
    },
  },
  {
    id: '022',
    name: 'ensure_push_subscriptions_table',
    up: (db, { tableExists }) => {
      if (tableExists('push_subscriptions')) return;
      db.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL, auth TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint)').run();
    },
  },
  {
    id: '023',
    name: 'ensure_tickets_closed_at_index',
    up: (db) => {
      db.prepare('CREATE INDEX IF NOT EXISTS idx_tickets_closed_at ON tickets(status, closed_at DESC)').run();
    },
  },
  {
    id: '024',
    name: 'ensure_tickets_fts5',
    up: (db, { tableExists }) => {
      if (tableExists('tickets_fts')) return;
      // Contentless FTS5 table -- vi hanterar synk manuellt
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(title, description, notes, solution, content='', tokenize='unicode61')`);
      // Populera med befintlig data
      const tickets = db.prepare('SELECT rowid, title, description, notes, solution FROM tickets').all() as {
        rowid: number; title: string; description: string; notes: string | null; solution: string | null;
      }[];
      if (tickets.length > 0) {
        const stmt = db.prepare('INSERT INTO tickets_fts(rowid, title, description, notes, solution) VALUES (?,?,?,?,?)');
        db.transaction(() => {
          for (const t of tickets) {
            stmt.run(t.rowid, t.title, t.description || '', t.notes || '', t.solution || '');
          }
        })();
      }
    },
  },
  {
    id: '025',
    name: 'ensure_kb_articles_have_category',
    up: (db) => {
      const orphans = db.prepare('SELECT COUNT(*) as count FROM kb_articles WHERE category_id IS NULL').get() as { count: number };
      if (orphans.count === 0) return;

      let cat = db.prepare("SELECT id FROM kb_categories WHERE name = 'Övrigt'").get() as { id: string } | undefined;
      if (!cat) {
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare('INSERT INTO kb_categories (id, name, color, position, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, 'Övrigt', '#888888', 999, now);
        cat = { id };
      }

      db.prepare('UPDATE kb_articles SET category_id = ? WHERE category_id IS NULL').run(cat.id);
    },
  },
  {
    id: '026',
    name: 'create_refresh_tokens_table',
    up: (db, { tableExists }) => {
      if (tableExists('refresh_tokens')) return;
      db.prepare(`CREATE TABLE refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT
      )`).run();
      db.prepare('CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id)').run();
      db.prepare('CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token)').run();
      db.prepare('CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at)').run();
    },
  },
  {
    id: '027',
    name: 'ensure_tickets_fts5_exists',
    up: (db, { tableExists }) => {
      if (tableExists('tickets_fts')) return;
      // db.exec is better-sqlite3's multi-statement method, not child_process
      db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(title, description, notes, solution, content='', tokenize='unicode61')`).run();
      const tickets = db.prepare('SELECT rowid, title, description, notes, solution FROM tickets').all() as {
        rowid: number; title: string; description: string; notes: string | null; solution: string | null;
      }[];
      if (tickets.length > 0) {
        const stmt = db.prepare('INSERT INTO tickets_fts(rowid, title, description, notes, solution) VALUES (?,?,?,?,?)');
        db.transaction(() => {
          for (const t of tickets) {
            stmt.run(t.rowid, t.title, t.description || '', t.notes || '', t.solution || '');
          }
        })();
      }
    },
  },
  {
    id: '028',
    name: 'create_companies_table_and_migrate_contacts',
    up: (db, { tableExists, columnExists }) => {
      if (!tableExists('companies')) {
        db.prepare(`CREATE TABLE companies (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          org_number TEXT,
          email TEXT,
          phone TEXT,
          address TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`).run();
        db.prepare('CREATE INDEX idx_companies_name ON companies(name)').run();
      }

      if (columnExists('contacts', 'company') && !columnExists('contacts', 'company_id')) {
        const companyNames = db.prepare(
          "SELECT DISTINCT company FROM contacts WHERE company IS NOT NULL AND TRIM(company) != ''"
        ).all() as { company: string }[];

        const insertCompany = db.prepare('INSERT INTO companies (id, name) VALUES (?, ?)');
        const companyMap = new Map<string, string>();
        for (const row of companyNames) {
          const id = randomUUID();
          const normalizedName = row.company.trim();
          insertCompany.run(id, normalizedName);
          companyMap.set(normalizedName.toLowerCase(), id);
        }

        db.prepare('ALTER TABLE contacts ADD COLUMN company_id TEXT REFERENCES companies(id) ON DELETE SET NULL').run();
        db.prepare('CREATE INDEX idx_contacts_company ON contacts(company_id)').run();

        const updateContact = db.prepare('UPDATE contacts SET company_id = ? WHERE id = ?');
        const contacts = db.prepare(
          "SELECT id, company FROM contacts WHERE company IS NOT NULL AND TRIM(company) != ''"
        ).all() as { id: string; company: string }[];

        for (const contact of contacts) {
          const companyId = companyMap.get(contact.company.trim().toLowerCase());
          if (companyId) {
            updateContact.run(companyId, contact.id);
          }
        }
      }
    },
  },
  {
    id: '029',
    name: 'add_company_id_and_assigned_to_on_tickets',
    up: (db, { columnExists }) => {
      if (!columnExists('tickets', 'company_id')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN company_id TEXT REFERENCES companies(id) ON DELETE SET NULL').run();
        db.prepare('CREATE INDEX idx_tickets_company ON tickets(company_id)').run();

        db.prepare(`
          UPDATE tickets SET company_id = (
            SELECT c.company_id FROM contacts c WHERE c.id = tickets.requester_id
          )
          WHERE requester_id IS NOT NULL
        `).run();
      }

      if (!columnExists('tickets', 'assigned_to')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL').run();
        db.prepare('CREATE INDEX idx_tickets_assigned ON tickets(assigned_to)').run();
      }
    },
  },
  {
    id: '030',
    name: 'create_sla_policies_table',
    up: (db, { tableExists }) => {
      if (tableExists('sla_policies')) return;
      db.prepare(`CREATE TABLE sla_policies (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high', 'critical')),
        response_time_minutes INTEGER NOT NULL,
        resolution_time_minutes INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, priority)
      )`).run();
      db.prepare('CREATE INDEX idx_sla_policies_company ON sla_policies(company_id)').run();
    },
  },
  {
    id: '031',
    name: 'add_sla_columns_to_tickets',
    up: (db, { columnExists }) => {
      if (!columnExists('tickets', 'sla_response_deadline')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN sla_response_deadline TEXT').run();
        db.prepare('ALTER TABLE tickets ADD COLUMN sla_resolution_deadline TEXT').run();
        db.prepare('ALTER TABLE tickets ADD COLUMN sla_paused_at TEXT').run();
        db.prepare('ALTER TABLE tickets ADD COLUMN sla_paused_duration INTEGER DEFAULT 0').run();
        db.prepare('ALTER TABLE tickets ADD COLUMN sla_response_met INTEGER').run();
        db.prepare('ALTER TABLE tickets ADD COLUMN sla_resolution_met INTEGER').run();
        db.prepare('CREATE INDEX idx_tickets_sla_response ON tickets(sla_response_deadline)').run();
        db.prepare('CREATE INDEX idx_tickets_sla_resolution ON tickets(sla_resolution_deadline)').run();
      }
    },
  },
  {
    id: '032',
    name: 'create_billing_rates_table',
    up: (db, { tableExists }) => {
      if (tableExists('billing_rates')) return;
      db.prepare(`CREATE TABLE billing_rates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        rate_per_hour REAL NOT NULL,
        currency TEXT DEFAULT 'SEK',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id)
      )`).run();
      db.prepare('CREATE INDEX idx_billing_rates_company ON billing_rates(company_id)').run();
    },
  },
  {
    id: '033',
    name: 'create_invoices_tables',
    up: (db, { tableExists }) => {
      if (tableExists('invoices')) return;
      db.prepare(`CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'paid')),
        total_hours REAL DEFAULT 0,
        total_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'SEK',
        pdf_path TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        sent_at TEXT,
        paid_at TEXT
      )`).run();
      db.prepare('CREATE INDEX idx_invoices_company ON invoices(company_id)').run();
      db.prepare('CREATE INDEX idx_invoices_status ON invoices(status)').run();

      db.prepare(`CREATE TABLE invoice_lines (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
        time_entry_id TEXT REFERENCES time_entries(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        hours REAL NOT NULL,
        rate REAL NOT NULL,
        amount REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id)').run();
      db.prepare('CREATE INDEX idx_invoice_lines_ticket ON invoice_lines(ticket_id)').run();
      db.prepare('CREATE INDEX idx_invoice_lines_time_entry ON invoice_lines(time_entry_id)').run();
    },
  },
  {
    id: '034',
    name: 'create_api_keys_table',
    up: (db, { tableExists }) => {
      if (tableExists('api_keys')) return;
      db.prepare(`CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permissions TEXT DEFAULT '["read"]',
        last_used_at TEXT,
        expires_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix)').run();
      db.prepare('CREATE INDEX idx_api_keys_user ON api_keys(user_id)').run();
    },
  },
  {
    id: '035',
    name: 'create_webhooks_tables',
    up: (db, { tableExists }) => {
      if (tableExists('webhooks')) return;
      db.prepare(`CREATE TABLE webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '[]',
        secret TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_triggered_at TEXT
      )`).run();

      db.prepare(`CREATE TABLE webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        response_code INTEGER,
        attempts INTEGER DEFAULT 0,
        delivered_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare('CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id)').run();
    },
  },
  {
    id: '036',
    name: 'add_department_to_contacts',
    up: (db, { columnExists }) => {
      if (!columnExists('contacts', 'department')) {
        db.prepare('ALTER TABLE contacts ADD COLUMN department TEXT').run();
      }
    },
  },
  {
    id: '037',
    name: 'add_ai_columns_and_usage_log',
    up: (db, { tableExists, columnExists }) => {
      // AI-relaterade kolumner på tickets
      if (!columnExists('tickets', 'ai_suggested_category_id')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN ai_suggested_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL').run();
      }
      if (!columnExists('tickets', 'ai_suggested_confidence')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN ai_suggested_confidence REAL').run();
      }
      if (!columnExists('tickets', 'ai_draft_response')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN ai_draft_response TEXT').run();
      }
      if (!columnExists('tickets', 'ai_draft_updated_at')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN ai_draft_updated_at TEXT').run();
      }
      if (!columnExists('tickets', 'ai_summary_json')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN ai_summary_json TEXT').run();
      }
      if (!columnExists('tickets', 'ai_summary_updated_at')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN ai_summary_updated_at TEXT').run();
      }

      // Token-logg för kostnadsuppföljning
      if (!tableExists('ai_usage_log')) {
        db.prepare(`CREATE TABLE ai_usage_log (
          id TEXT PRIMARY KEY,
          feature TEXT NOT NULL CHECK(feature IN ('categorize','draft','summary','suggest')),
          model TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          ok INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`).run();
        db.prepare('CREATE INDEX idx_ai_usage_log_created ON ai_usage_log(created_at DESC)').run();
        db.prepare('CREATE INDEX idx_ai_usage_log_feature ON ai_usage_log(feature)').run();
        db.prepare('CREATE INDEX idx_ai_usage_log_ticket ON ai_usage_log(ticket_id)').run();
      }
    },
  },
  {
    id: '038',
    name: 'add_ai_deflections_table',
    up: (db, { tableExists }) => {
      // ai_deflections — spårar varje gång publika portalen visade ett AI-förslag
      // och vad användaren valde efter det. Det här blir guld i pilotrapportering:
      // "67 % av enkla L1-ärenden löstes utan att de nådde IT".
      if (tableExists('ai_deflections')) return;
      db.prepare(`CREATE TABLE ai_deflections (
        id TEXT PRIMARY KEY,
        problem_text TEXT NOT NULL,
        suggestion_text TEXT,
        kb_article_ids TEXT,
        confidence REAL,
        outcome TEXT NOT NULL DEFAULT 'shown' CHECK(outcome IN ('shown','solved','rejected','no_solution')),
        user_email TEXT,
        ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT
      )`).run();
      db.prepare('CREATE INDEX idx_ai_deflections_outcome ON ai_deflections(outcome)').run();
      db.prepare('CREATE INDEX idx_ai_deflections_created ON ai_deflections(created_at DESC)').run();
    },
  },
  {
    id: '039',
    name: 'fix_ai_usage_log_feature_check',
    up: (db, { tableExists }) => {
      if (!tableExists('ai_usage_log')) return;
      db.prepare(`CREATE TABLE ai_usage_log_new (
        id TEXT PRIMARY KEY,
        feature TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        ok INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      db.prepare(`INSERT INTO ai_usage_log_new SELECT * FROM ai_usage_log`).run();
      db.prepare(`DROP TABLE ai_usage_log`).run();
      db.prepare(`ALTER TABLE ai_usage_log_new RENAME TO ai_usage_log`).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created ON ai_usage_log(created_at DESC)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ai_usage_log_feature ON ai_usage_log(feature)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ai_usage_log_ticket ON ai_usage_log(ticket_id)').run();
    },
  },
  {
    id: '040',
    name: 'add_email_message_id_to_tickets',
    up: (db, { columnExists }) => {
      if (!columnExists('tickets', 'email_message_id')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN email_message_id TEXT').run();
        db.prepare('CREATE INDEX idx_tickets_email_message_id ON tickets(email_message_id)').run();
      }
    },
  },
];
