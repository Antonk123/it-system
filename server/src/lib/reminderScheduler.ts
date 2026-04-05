import cron from 'node-cron';
import { db } from '../db/connection.js';
import { sendTicketReminderEmail } from './email.js';
import { sendPushToAllSubscriptions } from './push.js';

let schedulerTask: cron.ScheduledTask | null = null;

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
    console.warn('Reminder scheduler already running');
    return;
  }

  // Run every minute: '* * * * *'
  schedulerTask = cron.schedule('* * * * *', async () => {
    await checkAndSendReminders();
  });

  console.log('✅ Reminder scheduler started (checking every minute)');
}

export function stopReminderScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('Reminder scheduler stopped');
  }
}

async function checkAndSendReminders() {
  try {
    const now = new Date().toISOString();
    console.log(`⏰ Checking for reminders at ${now}`);

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

    if (dueReminders.length === 0) {
      console.log('  No due reminders found');
      return;
    }

    console.log(`📧 Found ${dueReminders.length} due reminder(s) to send`);

    for (const reminder of dueReminders) {
      console.log(`  Processing reminder ${reminder.id} scheduled for ${reminder.reminder_time}`);
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

        // Send push notification
        await sendPushToAllSubscriptions({
          type: 'reminder',
          ticketId: reminder.ticket_id,
          title: `Påminnelse: ${reminder.title}`,
          body: reminder.message || `Ärendet "${reminder.title}" har en påminnelse nu.`,
        });

        // Mark reminder as sent
        db.prepare(`
          UPDATE ticket_reminders
          SET sent = 1, sent_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), reminder.id);

        console.log(`✅ Sent reminder ${reminder.id} for ticket ${reminder.ticket_id} to ${reminder.user_email}`);
      } catch (error) {
        console.error(`Failed to send reminder ${reminder.id}:`, error);
        // Don't mark as sent if email failed - will retry on next run
      }
    }
  } catch (error) {
    console.error('Error in reminder scheduler:', error);
  }
}
