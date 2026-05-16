import cron from 'node-cron';
import { db } from '../db/connection.js';
import { sendPushToAllSubscriptions, isPushEnabled } from './push.js';

const AGING_DAYS = parseInt(process.env.PUSH_AGING_DAYS || '7', 10);

async function checkAgingTickets(): Promise<void> {
  if (!isPushEnabled()) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - AGING_DAYS);
  const cutoffIso = cutoff.toISOString();

  // Dedup: skicka bara aging-notiser för ärenden som aldrig notifierats eller
  // som senast notifierades för mer än 24h sedan. Utan denna filtrering
  // spammas mottagaren om samma inaktiva ärenden varje dag.
  const tickets = db.prepare(`
    SELECT id, title, updated_at
    FROM tickets
    WHERE status NOT IN ('closed', 'resolved')
      AND updated_at <= ?
      AND (last_aging_notified_at IS NULL OR last_aging_notified_at < datetime('now', '-1 day'))
    ORDER BY updated_at ASC
  `).all(cutoffIso) as { id: string; title: string; updated_at: string }[];

  if (tickets.length === 0) {
    console.log(`Push aging check: no tickets inactive >${AGING_DAYS} days (or all already notified within 24h)`);
    return;
  }

  console.log(`Push aging check: ${tickets.length} ticket(s) inactive >${AGING_DAYS} days`);

  const markNotified = db.prepare('UPDATE tickets SET last_aging_notified_at = ? WHERE id = ?');

  for (const ticket of tickets) {
    const daysSince = Math.floor(
      (Date.now() - new Date(ticket.updated_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    await sendPushToAllSubscriptions({
      type: 'aging',
      ticketId: ticket.id,
      title: `Inaktivt ärende: ${ticket.title}`,
      body: `Ärendet "${ticket.title}" har inte uppdaterats på ${daysSince} dagar.`,
    });
    // Sätt last_aging_notified_at EFTER lyckad sändning så att en push-server
    // som är nere inte stänger ute framtida försök.
    markNotified.run(new Date().toISOString(), ticket.id);
  }
}

export function startPushScheduler(): void {
  // Run daily at 09:00 - when the user is likely at their desk
  cron.schedule('0 9 * * *', async () => {
    try {
      await checkAgingTickets();
    } catch (error) {
      console.error('Push scheduler error:', error);
    }
  });

  console.log(`Push aging-ticket scheduler enabled (daily at 09:00, threshold: ${AGING_DAYS} days)`);
}
