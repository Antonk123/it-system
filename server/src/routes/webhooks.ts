import { Router, Response } from 'express';
import { randomUUID, randomBytes } from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { isSafeWebhookUrl } from '../lib/webhookValidator.js';

const router = Router();

interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string;
  active: number;
  created_at: string;
  last_triggered_at: string | null;
}

interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  response_code: number | null;
  attempts: number;
  delivered_at: string | null;
  created_at: string;
}

// GET / — list all webhooks
router.get('/', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const webhooks = db.prepare(
      'SELECT id, url, events, active, created_at, last_triggered_at FROM webhooks ORDER BY created_at DESC'
    ).all() as Omit<WebhookRow, 'secret'>[];

    res.json(webhooks);
  } catch (error) {
    console.error('Error listing webhooks:', error);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

// POST / — create a webhook
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { url, events } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  const safe = await isSafeWebhookUrl(url);
  if (!safe.ok) {
    return res.status(400).json({ error: `Invalid webhook URL: ${safe.reason}` });
  }

  if (!events || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'At least one event is required' });
  }

  try {
    const id = randomUUID();
    const secret = randomBytes(32).toString('hex');

    db.prepare(
      'INSERT INTO webhooks (id, url, events, secret) VALUES (?, ?, ?, ?)'
    ).run(id, url, JSON.stringify(events), secret);

    res.status(201).json({
      id,
      url,
      events: JSON.stringify(events),
      secret,
      active: 1,
      created_at: new Date().toISOString(),
      last_triggered_at: null,
    });
  } catch (error) {
    console.error('Error creating webhook:', error);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// PUT /:id — update a webhook
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { url, events, active } = req.body;

  try {
    const existing = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (url !== undefined) {
      const safe = await isSafeWebhookUrl(url);
      if (!safe.ok) {
        return res.status(400).json({ error: `Invalid webhook URL: ${safe.reason}` });
      }
      updates.push('url = ?');
      values.push(url);
    }
    if (events !== undefined) {
      updates.push('events = ?');
      values.push(JSON.stringify(events));
    }
    if (active !== undefined) {
      updates.push('active = ?');
      values.push(active ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const webhook = db.prepare(
      'SELECT id, url, events, active, created_at, last_triggered_at FROM webhooks WHERE id = ?'
    ).get(req.params.id) as Omit<WebhookRow, 'secret'>;

    res.json(webhook);
  } catch (error) {
    console.error('Error updating webhook:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// DELETE /:id — delete a webhook
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json({ message: 'Webhook deleted' });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// GET /:id/deliveries — list recent deliveries
router.get('/:id/deliveries', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const deliveries = db.prepare(
      'SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.params.id) as WebhookDeliveryRow[];

    res.json(deliveries);
  } catch (error) {
    console.error('Error listing deliveries:', error);
    res.status(500).json({ error: 'Failed to list deliveries' });
  }
});

export default router;
