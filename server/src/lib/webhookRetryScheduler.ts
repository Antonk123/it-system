import cron, { ScheduledTask } from 'node-cron';
import { processWebhookRetries } from './webhookDispatcher.js';

let schedulerTask: ScheduledTask | null = null;
let running = false;

export function startWebhookRetryScheduler() {
  if (schedulerTask) {
    console.warn('Webhook retry scheduler already running');
    return;
  }

  // Every minute: scan webhook_deliveries for rows whose next_retry_at has
  // come due and re-attempt delivery.
  schedulerTask = cron.schedule('* * * * *', async () => {
    // Reentrancy guard — a previous tick may still be running if a webhook
    // endpoint is slow. We'd rather skip than fire concurrent deliveries for
    // the same delivery row.
    if (running) return;
    running = true;
    try {
      await processWebhookRetries();
    } catch (err) {
      console.error('Error in webhook retry scheduler:', err);
    } finally {
      running = false;
    }
  });

  console.log('✅ Webhook retry scheduler started (checking every minute)');
}

export function stopWebhookRetryScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('Webhook retry scheduler stopped');
  }
}
