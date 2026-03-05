import { db } from './connection.js';
import { randomUUID } from 'crypto';

/**
 * Migration: Add id column to ticket_tags table
 *
 * This migration:
 * 1. Backs up existing ticket_tags data
 * 2. Drops the old table
 * 3. Creates new table with id column
 * 4. Restores data with new UUIDs
 */

interface TicketTagBackup {
  ticket_id: string;
  tag_id: string;
}

export function migrateTicketTagsAddId() {

  try {
    console.log('Starting migration: Add id column to ticket_tags...');

    // Step 1: Backup existing data
    console.log('Step 1: Backing up existing ticket_tags data...');
    const existingData = db.prepare('SELECT ticket_id, tag_id FROM ticket_tags').all() as TicketTagBackup[];
    console.log(`Found ${existingData.length} existing ticket_tags entries`);

    // Step 2: Drop old table
    console.log('Step 2: Dropping old ticket_tags table...');
    db.prepare('DROP TABLE IF EXISTS ticket_tags').run();

    // Step 3: Create new table with id column
    console.log('Step 3: Creating new ticket_tags table with id column...');
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ticket_tags (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ticket_id, tag_id)
      )
    `).run();

    // Step 4: Restore data with new UUIDs
    console.log('Step 4: Restoring data with new UUIDs...');
    const insertStmt = db.prepare('INSERT INTO ticket_tags (id, ticket_id, tag_id) VALUES (?, ?, ?)');

    let inserted = 0;
    existingData.forEach((row) => {
      try {
        insertStmt.run(randomUUID(), row.ticket_id, row.tag_id);
        inserted++;
      } catch (err) {
        console.warn(`Skipping duplicate entry: ticket_id=${row.ticket_id}, tag_id=${row.tag_id}`);
      }
    });

    console.log(`Successfully restored ${inserted} ticket_tags entries`);
    console.log('Migration completed successfully! ✅');

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run migration if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  migrateTicketTagsAddId();
  process.exit(0);
}
