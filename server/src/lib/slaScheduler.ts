import cron, { ScheduledTask } from 'node-cron';
import { db } from '../db/connection.js';
import { dispatchWebhook } from './webhookDispatcher.js';
import { sendPushToAllSubscriptions } from './push.js';
import { sendSlaBreachEmail } from './email.js';
import { logger } from './logger.js';

interface SlaTicketRow {
  id: string;
  title: string;
  priority: string;
  assigned_to: string | null;
  sla_response_deadline: string | null;
  sla_resolution_deadline: string | null;
  sla_response_met: number | null;
  sla_resolution_met: number | null;
}

type BreachType = 'response' | 'resolution';

async function notifyBreach(t: SlaTicketRow, breachType: BreachType, deadline: string): Promise<void> {
  await dispatchWebhook(`sla.${breachType}.breached`, {
    ticket_id: t.id,
    ticket_title: t.title,
    priority: t.priority,
    breach_type: breachType,
    deadline,
  }).catch((err) => logger.error('sla breach webhook failed', { error: String(err) }));

  // Escalation: notify the assigned technician, or all admins if the ticket is
  // unassigned (so a breach on an unowned ticket never vanishes).
  const recipients = t.assigned_to
    ? (db.prepare('SELECT email, display_name FROM users WHERE id = ?').all(t.assigned_to) as { email: string; display_name: string | null }[])
    : (db.prepare("SELECT email, display_name FROM users WHERE role = 'admin'").all() as { email: string; display_name: string | null }[]);

  for (const r of recipients) {
    if (!r.email) continue;
    await sendSlaBreachEmail({
      toEmail: r.email,
      toName: r.display_name || r.email,
      ticketId: t.id,
      title: t.title,
      breachType,
      deadline,
      priority: t.priority,
    }).catch((err) => logger.error('sla breach email failed', { error: String(err) }));
  }

  if (t.assigned_to) {
    await sendPushToAllSubscriptions(
      {
        type: `sla.${breachType}.breached`,
        ticketId: t.id,
        title: `SLA-brott: ${t.title}`,
        body: `${breachType === 'response' ? 'Första svar' : 'Lösning'} har passerat SLA-deadline`,
      },
      t.assigned_to,
    ).catch((err) => logger.error('sla breach push failed', { error: String(err) }));
  }
}

/**
 * Scans open, non-paused tickets for SLA deadlines that have passed without the
 * met/breached flag set, marks them breached (sla_*_met = 0) and notifies. The
 * met=0 write also dedups: a flagged breach is no longer NULL, so the next scan
 * skips it. ISO-8601 (UTC) strings compare chronologically as plain strings.
 */
export async function checkSlaBreaches(now: Date = new Date()): Promise<void> {
  const nowIso = now.toISOString();

  const rows = db.prepare(`
    SELECT id, title, priority, assigned_to,
           sla_response_deadline, sla_resolution_deadline, sla_response_met, sla_resolution_met
    FROM tickets
    WHERE status NOT IN ('closed', 'resolved')
      AND sla_paused_at IS NULL
      AND (
        (sla_response_deadline IS NOT NULL AND sla_response_met IS NULL AND sla_response_deadline < ?)
        OR
        (sla_resolution_deadline IS NOT NULL AND sla_resolution_met IS NULL AND sla_resolution_deadline < ?)
      )
  `).all(nowIso, nowIso) as SlaTicketRow[];

  for (const t of rows) {
    if (t.sla_response_deadline && t.sla_response_met === null && t.sla_response_deadline < nowIso) {
      db.prepare('UPDATE tickets SET sla_response_met = 0 WHERE id = ? AND sla_response_met IS NULL').run(t.id);
      await notifyBreach(t, 'response', t.sla_response_deadline);
    }
    if (t.sla_resolution_deadline && t.sla_resolution_met === null && t.sla_resolution_deadline < nowIso) {
      db.prepare('UPDATE tickets SET sla_resolution_met = 0 WHERE id = ? AND sla_resolution_met IS NULL').run(t.id);
      await notifyBreach(t, 'resolution', t.sla_resolution_deadline);
    }
  }
}

let schedulerTask: ScheduledTask | null = null;

export function startSlaScheduler(): void {
  // Every 5 minutes — SLA deadlines (e.g. a 30-min critical response target) need
  // finer resolution than the daily jobs.
  schedulerTask = cron.schedule('*/5 * * * *', () => {
    checkSlaBreaches().catch((error) => logger.error('SLA scheduler error', { error: String(error) }));
  });
  logger.info('SLA breach scheduler enabled (every 5 minutes)');
}

export function stopSlaScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
