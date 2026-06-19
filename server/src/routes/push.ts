import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { db } from '../db/connection.js';
import { randomUUID } from 'crypto';
import { logger } from '../lib/logger.js';

const router = Router();

router.get('/vapid-public-key', authenticate, (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ vapidPublicKey: key });
});

router.post('/subscribe', authenticate, (req: AuthRequest, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth)
      return res.status(400).json({ error: 'Invalid subscription' });
    // Inkludera user_id så att push-notiser kan skickas per användare
    db.prepare(`
      INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id
    `).run(randomUUID(), endpoint, keys.p256dh, keys.auth, req.user!.id);
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error('Error subscribing to push notifications:', { error: String(err) });
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

router.delete('/unsubscribe', authenticate, (req: AuthRequest, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error unsubscribing from push notifications:', { error: String(err) });
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

export default router;
