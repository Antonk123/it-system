/**
 * Add Ticket Reminders Table Migration
 * Creates table for storing ticket reminders with email notifications
 *
 * Run with: tsx src/db/add-ticket-reminders.ts
 */

import { db } from './connection.js';

console.log('⏰ Creating Ticket Reminders Table\n');
console.log('='.repeat(60));

try {
  // Check if table already exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='ticket_reminders'
  `).get();

  if (tableExists) {
    console.log('⏭️  Table ticket_reminders already exists');
    console.log('✅ Migration already applied');
    process.exit(0);
  }

  console.log('Creating ticket_reminders table...\n');

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

    -- Index for fast ticket lookup
    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_ticket ON ticket_reminders(ticket_id);

    -- Index for user's reminders
    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_user ON ticket_reminders(user_id);

    -- Index for scheduler (find due reminders)
    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_time ON ticket_reminders(reminder_time);

    -- Index for filtering sent/unsent
    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_sent ON ticket_reminders(sent);
  `);

  console.log('✅ Created table: ticket_reminders');
  console.log('✅ Created index: idx_ticket_reminders_ticket');
  console.log('✅ Created index: idx_ticket_reminders_user');
  console.log('✅ Created index: idx_ticket_reminders_time');
  console.log('✅ Created index: idx_ticket_reminders_sent');

  console.log('\n' + '='.repeat(60));
  console.log('📊 Table Schema');
  console.log('='.repeat(60));
  console.log('  - id: Unique identifier for reminder');
  console.log('  - ticket_id: Ticket this reminder is for');
  console.log('  - user_id: User who created the reminder');
  console.log('  - reminder_time: When to send the reminder (ISO timestamp)');
  console.log('  - message: Optional custom message for the reminder');
  console.log('  - sent: Whether reminder has been sent (0 or 1)');
  console.log('  - created_at: When reminder was created');
  console.log('  - sent_at: When reminder was sent');

  console.log('\n🎉 Migration completed successfully!');
  process.exit(0);

} catch (error) {
  console.error('\n❌ Migration failed:');
  if (error instanceof Error) {
    console.error(`   ${error.message}`);
  }
  process.exit(1);
}
