import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();
// Both src/routes and dist/routes resolve to server/admin_assets (Docker: /app/admin_assets).
const assetUrl = new URL('../../admin_assets/architecture-map/index.html', import.meta.url);

router.get('/', authenticate, requireAdmin, async (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  try {
    const html = await readFile(assetUrl, 'utf8');
    res.type('html').send(html);
  } catch (error) {
    logger.error('Architecture map asset unavailable', { error: String(error) });
    res.status(503).json({ error: 'Architecture map is temporarily unavailable' });
  }
});

export default router;
