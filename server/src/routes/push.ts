import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { db } from '../db/connection.js';
import { randomUUID } from 'crypto';
import { logger } from '../lib/logger.js';
import { isAllowedPushEndpoint } from '../lib/push.js';

const MAX_ENDPOINT_LENGTH = 512;
const MAX_KEY_LENGTH = 128;
const MAX_SUBSCRIPTIONS_PER_USER = 20;

const router = Router();

router.get('/vapid-public-key', authenticate, (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ vapidPublicKey: key });
});

router.post('/subscribe', authenticate, (req: AuthRequest, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (typeof endpoint !== 'string' || !endpoint || endpoint.length > MAX_ENDPOINT_LENGTH
      || typeof keys?.p256dh !== 'string' || !keys.p256dh || keys.p256dh.length > MAX_KEY_LENGTH
      || typeof keys?.auth !== 'string' || !keys.auth || keys.auth.length > MAX_KEY_LENGTH)
      return res.status(400).json({ error: 'Invalid subscription' });
    if (!isAllowedPushEndpoint(endpoint))
      return res.status(400).json({ error: 'Ogiltig push-endpoint' });
    // Inkludera user_id så att push-notiser kan skickas per användare. En endpoint
    // som tillhör en annan användare får aldrig skrivas över.
    const result = db.prepare(`
      INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id
      WHERE push_subscriptions.user_id IS NULL OR push_subscriptions.user_id = excluded.user_id
    `).run(randomUUID(), endpoint, keys.p256dh, keys.auth, req.user!.id, new Date().toISOString());
    if (result.changes === 0)
      return res.status(409).json({ error: 'Endpointen tillhör en annan användare' });
    // Äldsta prenumerationerna går först när en användare passerar taket.
    db.prepare(`
      DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (
        SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
      )
    `).run(req.user!.id, req.user!.id, MAX_SUBSCRIPTIONS_PER_USER);
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
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error unsubscribing from push notifications:', { error: String(err) });
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

export default router;
