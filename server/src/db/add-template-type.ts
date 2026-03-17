import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, '../../data/database.sqlite'));

console.log('Adding template_type column to ticket_templates...');

try {
  // Add template_type column with default 'standard'
  db.exec(`
    ALTER TABLE ticket_templates
    ADD COLUMN template_type TEXT DEFAULT 'standard' CHECK(template_type IN ('standard', 'dynamic'))
  `);

  console.log('✓ Added template_type column');

  // Update existing templates: if they have dynamic fields, set type to 'dynamic'
  const updateStmt = db.prepare(`
    UPDATE ticket_templates
    SET template_type = 'dynamic'
    WHERE id IN (
      SELECT DISTINCT template_id
      FROM template_fields
    )
  `);

  const result = updateStmt.run();
  console.log(`✓ Updated ${result.changes} existing templates to 'dynamic' type`);

  // Set remaining templates to 'standard' explicitly
  const updateStandardStmt = db.prepare(`
    UPDATE ticket_templates
    SET template_type = 'standard'
    WHERE template_type IS NULL
  `);

  const standardResult = updateStandardStmt.run();
  console.log(`✓ Set ${standardResult.changes} templates to 'standard' type`);

  console.log('✓ Migration completed successfully!');
} catch (error) {
  console.error('✗ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}
