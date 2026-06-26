import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { getBoolSetting, setSetting } from '../lib/settings.js';

const router = Router();

const TWO_WAY_EMAIL_KEY = 'two_way_email_enabled';

// Readable by any authenticated user — the frontend uses it to decide whether to
// show the public-reply toggle in the comment box.
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({ twoWayEmailEnabled: getBoolSetting(TWO_WAY_EMAIL_KEY, true) });
});

// System-wide email policy — admin only. CSRF is enforced globally (app.ts).
router.put('/two-way-email', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { enabled } = (req.body ?? {}) as Partial<{ enabled: boolean }>;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled måste vara en boolean' });
  }
  setSetting(TWO_WAY_EMAIL_KEY, enabled ? '1' : '0');
  return res.json({ twoWayEmailEnabled: enabled });
});

export default router;
