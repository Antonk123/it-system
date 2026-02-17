import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/database.sqlite');

export const db = new Database(DB_PATH);

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

const columnExists = (tableName: string, columnName: string) => {
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
      id: 'template-1',
      name: 'Lösenordsåterställning',
      description: 'Mall för lösenordsåterställning',
      title_template: 'Lösenordsåterställning för [användarnamn]',
      description_template: 'Användaren behöver få sitt lösenord återställt.\n\nAnvändarnamn: \nAvdelning: \n\nÅtgärd:\n1. Verifiera användarens identitet\n2. Återställ lösenord i AD\n3. Meddela användaren via e-post',
      priority: 'medium',
      notes_template: 'Kom ihåg att verifiera identitet innan återställning.',
      position: 0
    },
    {
      id: 'template-2',
      name: 'Ny användare',
      description: 'Mall för att skapa ny användare',
      title_template: 'Skapa ny användare: [namn]',
      description_template: 'Ny användare ska skapas i systemet.\n\nNamn: \nE-post: \nAvdelning: \nChef: \nStartdatum: \n\nÅtkomst som behövs:\n- [ ] E-postkonto\n- [ ] Filserver\n- [ ] CRM\n- [ ] Annat: ',
      priority: 'high',
      notes_template: 'Kontrollera med chef vilka åtkomster som behövs.',
      position: 1
    },
    {
      id: 'template-3',
      name: 'Hårdvarubeställning',
      description: 'Mall för hårdvarubeställning',
      title_template: 'Hårdvarubeställning: [typ av utrustning]',
      description_template: 'Beställning av ny hårdvara.\n\nTyp av utrustning: \nAntal: \nMotivering: \nBudget: \nLeveransadress: \n\nSpecifikationer:\n',
      priority: 'low',
      notes_template: 'Säkerställ att budget finns innan beställning.',
      position: 2
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

  // Add sample fields for "Ny användare" template
  const newUserTemplate = db.prepare("SELECT id FROM ticket_templates WHERE name = ?").get("Ny användare") as { id: string } | undefined;
  if (newUserTemplate) {
    const existingFields = db.prepare("SELECT COUNT(*) as count FROM template_fields WHERE template_id = ?").get(newUserTemplate.id) as { count: number };
    if (existingFields.count === 0) {
      const fields = [
        { name: 'user_name', label: 'Namn', type: 'text', placeholder: 'För- och efternamn', required: 1, position: 0 },
        { name: 'user_email', label: 'E-post', type: 'text', placeholder: 'namn@företag.se', required: 1, position: 1 },
        { name: 'department', label: 'Avdelning', type: 'text', placeholder: 'T.ex. Ekonomi', required: 1, position: 2 },
        { name: 'manager', label: 'Chef', type: 'text', placeholder: 'Namn på chef', required: 1, position: 3 },
        { name: 'start_date', label: 'Startdatum', type: 'date', placeholder: '', required: 1, position: 4 },
        { name: 'access_email', label: 'E-postkonto', type: 'checkbox', placeholder: '', required: 0, position: 5 },
        { name: 'access_fileserver', label: 'Filserver', type: 'checkbox', placeholder: '', required: 0, position: 6 },
        { name: 'access_crm', label: 'CRM', type: 'checkbox', placeholder: '', required: 0, position: 7 },
        { name: 'access_other', label: 'Annan åtkomst', type: 'text', placeholder: 'Beskriv övrig åtkomst som behövs', required: 0, position: 8 }
      ];

      const insertStmt = db.prepare(`
        INSERT INTO template_fields (id, template_id, field_name, field_label, field_type, placeholder, required, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const field of fields) {
        insertStmt.run(randomUUID(), newUserTemplate.id, field.name, field.label, field.type, field.placeholder, field.required, field.position);
      }
      console.log('Inserted default template fields for Ny användare');
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
  ensureTicketFieldValuesTable();
  ensureTicketHistoryTable();
  console.log('Database initialized successfully');
}

export function closeDatabase() {
  db.close();
}
