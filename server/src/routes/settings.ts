import { Router, Response } from 'express';
import { unlinkSync } from 'fs';
import multer from 'multer';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { getBoolSetting, setSetting } from '../lib/settings.js';
import {
  uploadLogo,
  hasValidLogoMagicBytes,
  saveLogoSettings,
  deleteLogo,
  getBrandingInfo,
  LogoValidationError,
} from '../lib/branding.js';
import { logger } from '../lib/logger.js';

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

// Upload/replace the instance logo — admin only. CSRF enforced globally (app.ts).
router.post('/branding/logo', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  uploadLogo.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError || err instanceof LogoValidationError) {
        // Expected client-side validation failure (size cap, disallowed
        // MIME) — safe to echo err.message to the client, it never contains
        // server internals.
        logger.error('Logo upload validation error', { error: err.message });
        return res.status(400).json({ error: err.message });
      }
      // Anything else (e.g. ENOENT if BRANDING_DIR isn't writable) is a
      // server fault, not a client mistake, and can contain an absolute
      // server path — 500 with a generic body; the raw error goes to the
      // log only.
      logger.error('Unexpected error during logo upload', { error: String(err) });
      return res.status(500).json({ error: 'Failed to upload logo' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Magic-byte check: verify the file's actual binary content matches the
    // declared MIME — req.file.mimetype is client-supplied and untrusted.
    const uploadedPath = req.file.path;
    if (!hasValidLogoMagicBytes(uploadedPath, req.file.mimetype)) {
      try { unlinkSync(uploadedPath); } catch { /* ignore cleanup error */ }
      logger.warn('Magic-byte mismatch for branding logo upload', {
        filename: req.file.originalname,
        declaredMime: req.file.mimetype,
      });
      return res.status(400).json({ error: 'File content does not match the declared file type.' });
    }

    try {
      saveLogoSettings(req.file.filename, req.file.mimetype);
      return res.json(getBrandingInfo());
    } catch (error) {
      logger.error('Error saving branding logo:', { error: String(error) });
      return res.status(500).json({ error: 'Failed to save logo' });
    }
  });
});

// Remove the instance logo — admin only, idempotent (204 even if none was set).
router.delete('/branding/logo', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    deleteLogo();
    return res.status(204).send();
  } catch (error) {
    logger.error('Error deleting branding logo:', { error: String(error) });
    return res.status(500).json({ error: 'Failed to delete logo' });
  }
});

export default router;
