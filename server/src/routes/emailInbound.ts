import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { getEmailInboundStatus } from '../lib/emailInbound.js';
import { logger } from '../lib/logger.js';

const router = Router();

// GET / — check IMAP configuration status
router.get('/status', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    res.json(getEmailInboundStatus());
  } catch (error) {
    logger.error('Error fetching email inbound status:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch email inbound status' });
  }
});

export default router;
