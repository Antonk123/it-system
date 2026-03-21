import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { AUTO_CLOSE_DAYS } from '../config/automation.js';

/**
 * Finds all tickets with status "resolved" whose updated_at is older than
 * AUTO_CLOSE_DAYS days and moves them to "closed".
 */
function autoCloseResolvedTickets(): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - AUTO_CLOSE_DAYS);
  const cutoffIso = cutoff.toISOString();

  const tickets = db.prepare(`
    SELECT id, title, updated_at
    FROM tickets
    WHERE status = 'resolved' AND updated_at <= ?
  `).all(cutoffIso) as { id: string; title: string; updated_at: string }[];

  if (tickets.length === 0) {
    console.log(`🔒 Auto-close: no tickets to close (threshold: ${AUTO_CLOSE_DAYS} days)`);
    return;
  }

  console.log(`🔒 Auto-close: closing ${tickets.length} ticket(s) resolved >${AUTO_CLOSE_DAYS} days ago`);

  const now = new Date().toISOString();

  const closeTicket = db.transaction((ticket: { id: string; title: string }) => {
    db.prepare(`
      UPDATE tickets
      SET status = 'closed', closed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, ticket.id);

    // Record in history (null user_id = system action)
    db.prepare(`
      INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value)
      VALUES (?, ?, NULL, 'status', 'resolved', 'closed')
    `).run(uuidv4(), ticket.id);

    console.log(`  ✅ Closed ticket ${ticket.id}: "${ticket.title}" (last updated ${ticket.updated_at})`);
  });

  for (const ticket of tickets) {
    try {
      closeTicket(ticket);
    } catch (error) {
      console.error(`  ❌ Failed to close ticket ${ticket.id}:`, error);
    }
  }
}

/**
 * Schedules the auto-close job to run daily at 02:30.
 * The threshold is controlled by AUTO_CLOSE_DAYS in automation.ts
 * or overridden via the AUTO_CLOSE_DAYS environment variable.
 */
export function startAutoCloseScheduler(): void {
  cron.schedule('30 2 * * *', () => {
    try {
      autoCloseResolvedTickets();
    } catch (error) {
      console.error('Auto-close scheduler error:', error);
    }
  });

  console.log(`✅ Auto-close scheduler enabled (daily at 02:30, threshold: ${AUTO_CLOSE_DAYS} days)`);
}
