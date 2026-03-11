import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, '../../data/database.sqlite'));

console.log('Making description_template nullable in ticket_templates...');

try {
  // SQLite doesn't support ALTER COLUMN directly, so we need to:
  // 1. Create a new table with the correct schema
  // 2. Copy data from old table
  // 3. Drop old table
  // 4. Rename new table

  // First, get all data from the existing table
  const existingData = db.prepare('SELECT * FROM ticket_templates').all();

  console.log(`Found ${existingData.length} existing templates`);

  // Create new table with description_template as nullable
  db.exec(`
    CREATE TABLE ticket_templates_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      template_type TEXT DEFAULT 'standard' CHECK(template_type IN ('standard', 'dynamic')),
      title_template TEXT NOT NULL,
      description_template TEXT,
      priority TEXT DEFAULT 'medium',
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      notes_template TEXT,
      solution_template TEXT,
      position INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('✓ Created new table with nullable description_template');

  // Copy all data to new table
  const insertStmt = db.prepare(`
    INSERT INTO ticket_templates_new (
      id, name, description, template_type, title_template, description_template,
      priority, category_id, notes_template, solution_template, position,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of existingData as any[]) {
    insertStmt.run(
      row.id,
      row.name,
      row.description,
      row.template_type || 'standard',
      row.title_template,
      row.description_template,
      row.priority,
      row.category_id,
      row.notes_template,
      row.solution_template,
      row.position,
      row.created_by,
      row.created_at,
      row.updated_at
    );
  }

  console.log(`✓ Copied ${existingData.length} templates to new table`);

  // Drop old table
  db.exec('DROP TABLE ticket_templates');
  console.log('✓ Dropped old table');

  // Rename new table
  db.exec('ALTER TABLE ticket_templates_new RENAME TO ticket_templates');
  console.log('✓ Renamed new table');

  // Recreate index
  db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_templates_position ON ticket_templates(position)');
  console.log('✓ Recreated indexes');

  console.log('✓ Migration completed successfully!');
} catch (error) {
  console.error('✗ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}
