import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { db } from '../db/connection.js';
import { randomUUID } from 'crypto';

const router = Router();

router.get('/vapid-public-key', authenticate, (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ vapidPublicKey: key });
});

router.post('/subscribe', authenticate, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth)
    return res.status(400).json({ error: 'Invalid subscription' });
  db.prepare(`
    INSERT INTO push_subscriptions (id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
  `).run(randomUUID(), endpoint, keys.p256dh, keys.auth);
  res.status(201).json({ ok: true });
});

router.delete('/unsubscribe', authenticate, (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  res.json({ ok: true });
});

export default router;
