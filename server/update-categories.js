// Quick script to update category names from English to Swedish
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to find the database file
const possiblePaths = [
  join(__dirname, 'data/database.sqlite'),
  join(__dirname, 'tickets.db'),
  process.env.DB_PATH
].filter(Boolean);

let db;
for (const path of possiblePaths) {
  try {
    console.log(`Trying database path: ${path}`);
    db = new Database(path);
    console.log(`✓ Connected to database at: ${path}\n`);
    break;
  } catch (err) {
    console.log(`✗ Failed to connect to ${path}`);
  }
}

if (!db) {
  console.error('Could not find database file!');
  process.exit(1);
}

try {
  // Show current categories
  console.log('Current categories:');
  const currentCategories = db.prepare('SELECT id, label, position FROM categories ORDER BY position').all();
  console.table(currentCategories);

  // Update categories from English to Swedish
  console.log('\nUpdating categories to Swedish...');

  const updates = [
    { old: 'Hardware', new: 'Hårdvara' },
    { old: 'Software', new: 'Mjukvara' },
    { old: 'Network', new: 'Nätverk' }
  ];

  const updateStmt = db.prepare('UPDATE categories SET label = ? WHERE label = ?');

  for (const { old, new: newLabel } of updates) {
    const result = updateStmt.run(newLabel, old);
    console.log(`  ${old} → ${newLabel}: ${result.changes} row(s) updated`);
  }

  // Show updated categories
  console.log('\nUpdated categories:');
  const updatedCategories = db.prepare('SELECT id, label, position FROM categories ORDER BY position').all();
  console.table(updatedCategories);

  console.log('\n✓ Categories updated successfully!');
} catch (error) {
  console.error('Error updating categories:', error);
  process.exit(1);
} finally {
  db.close();
}
