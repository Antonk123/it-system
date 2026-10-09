import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { getEmailInboundStatus } from '../lib/emailInbound.js';
import { logger } from '../lib/logger.js';

const router = Router();

// GET /status — IMAP-konfiguration (värd och användarnamn) är bara för admin
router.get('/status', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    res.json(getEmailInboundStatus());
  } catch (error) {
    logger.error('Error fetching email inbound status:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch email inbound status' });
  }
});

export default router;
