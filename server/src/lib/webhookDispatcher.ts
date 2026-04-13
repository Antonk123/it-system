import { db } from '../db/connection.js';
import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';

interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string;
  active: number;
}

export async function dispatchWebhook(event: string, payload: Record<string, any>): Promise<void> {
  const webhooks = db.prepare(
    'SELECT * FROM webhooks WHERE active = 1'
  ).all() as WebhookRow[];

  for (const webhook of webhooks) {
    const events = JSON.parse(webhook.events) as string[];
    if (!events.includes(event) && !events.includes('*')) continue;

    const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
    const signature = createHmac('sha256', webhook.secret).update(body).digest('hex');

    const deliveryId = randomUUID();
    db.prepare(
      'INSERT INTO webhook_deliveries (id, webhook_id, event, payload, attempts) VALUES (?, ?, ?, ?, 0)'
    ).run(deliveryId, webhook.id, event, body);

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': event,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      db.prepare(
        'UPDATE webhook_deliveries SET response_code = ?, delivered_at = ?, attempts = 1 WHERE id = ?'
      ).run(response.status, new Date().toISOString(), deliveryId);

      db.prepare('UPDATE webhooks SET last_triggered_at = ? WHERE id = ?')
        .run(new Date().toISOString(), webhook.id);
    } catch (error) {
      db.prepare(
        'UPDATE webhook_deliveries SET response_code = 0, attempts = 1 WHERE id = ?'
      ).run(deliveryId);
    }
  }
}
