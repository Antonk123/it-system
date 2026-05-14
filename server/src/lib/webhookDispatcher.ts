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

async function deliverOne(webhook: WebhookRow, event: string, body: string): Promise<void> {
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
  } catch {
    db.prepare(
      'UPDATE webhook_deliveries SET response_code = 0, attempts = 1 WHERE id = ?'
    ).run(deliveryId);
  }
}

export async function dispatchWebhook(event: string, payload: Record<string, any>): Promise<void> {
  const webhooks = db.prepare(
    'SELECT * FROM webhooks WHERE active = 1'
  ).all() as WebhookRow[];

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

  const matching = webhooks.filter((w) => {
    const events = JSON.parse(w.events) as string[];
    return events.includes(event) || events.includes('*');
  });

  await Promise.all(matching.map((w) => deliverOne(w, event, body)));
}
