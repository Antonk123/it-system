import cron, { ScheduledTask } from 'node-cron';
import { db } from '../db/connection.js';
import { sendTicketReminderEmail } from './email.js';
import { sendPushToAllSubscriptions } from './push.js';
import { logger } from './logger.js';

let schedulerTask: ScheduledTask | null = null;

interface DueReminder {
  id: string;
  ticket_id: string;
  message: string | null;
  reminder_time: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category_id: string | null;
  user_id: string;
  user_email: string;
  user_name: string;
}

export function startReminderScheduler() {
  if (schedulerTask) {
    logger.warn('Reminder scheduler already running');
    return;
  }

  // Run every minute: '* * * * *'
  schedulerTask = cron.schedule('* * * * *', async () => {
    try {
      await checkAndSendReminders();
    } catch (error) {
      logger.error('Unhandled error in reminder scheduler tick:', { error: String(error) });
    }
  });

  logger.info('Reminder scheduler started (checking every minute)');
}

export function stopReminderScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('Reminder scheduler stopped');
  }
}

async function checkAndSendReminders() {
  try {
    const now = new Date().toISOString();

    // Find all unsent reminders that are due
    const dueReminders = db.prepare(`
      SELECT
        tr.id, tr.ticket_id, tr.message, tr.reminder_time,
        t.title, t.description, t.status, t.priority, t.category_id,
        u.id as user_id, u.email as user_email, u.display_name as user_name
      FROM ticket_reminders tr
      JOIN tickets t ON tr.ticket_id = t.id
      JOIN users u ON tr.user_id = u.id
      WHERE tr.sent = 0 AND tr.reminder_time <= ?
      ORDER BY tr.reminder_time ASC
    `).all(now) as DueReminder[];

    if (dueReminders.length === 0) return;

    logger.info(`Reminders: sending ${dueReminders.length} due reminder(s)`);

    for (const reminder of dueReminders) {
      try {
        // Send email if SMTP is configured
        if (process.env.SMTP_HOST && process.env.EMAIL_FROM) {
          await sendTicketReminderEmail({
            ticket: {
              id: reminder.ticket_id,
              title: reminder.title,
              description: reminder.description,
              status: reminder.status,
              priority: reminder.priority,
              categoryId: reminder.category_id,
            },
            reminderMessage: reminder.message || undefined,
            userEmail: reminder.user_email,
            userName: reminder.user_name,
          });
        }

        // Mark as sent after email — push is best-effort and should not cause retry
        db.prepare(`
          UPDATE ticket_reminders
          SET sent = 1, sent_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), reminder.id);

        // Send push notification (best-effort — failure does not un-send the reminder)
        sendPushToAllSubscriptions({
          type: 'reminder',
          ticketId: reminder.ticket_id,
          title: `Påminnelse: ${reminder.title}`,
          body: reminder.message || `Ärendet "${reminder.title}" har en påminnelse nu.`,
        }).catch((err) => {
          logger.error(`Push notification failed for reminder ${reminder.id}:`, { error: String(err) });
        });

        logger.info(`Reminder ${reminder.id} sent for ticket ${reminder.ticket_id}`);
      } catch (error) {
        logger.error(`Failed to send reminder ${reminder.id}:`, { error: String(error) });
        // Don't mark as sent if email failed - will retry on next run
      }
    }
  } catch (error) {
    logger.error('Error in reminder scheduler:', { error: String(error) });
  }
}
