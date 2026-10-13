import type { Request, Response, NextFunction } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import multer from 'multer';
import { db } from '../db/connection.js';
import { hasMagicByteMatch, ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS } from '../routes/attachments.js';
import type { AuthRequest } from '../middleware/auth.js';

const directory = process.env.UPLOAD_DIR || join(import.meta.dirname, '../../data/uploads');
mkdirSync(directory, { recursive: true });
const mimeExtensions: Record<string, string[]> = {
  'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/gif': ['gif'], 'image/webp': ['webp'],
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const upload = multer({
  defParamCharset: 'utf8',
  storage: multer.diskStorage({ destination: directory, filename: (_req, _file, cb) => cb(null, `inline-${randomUUID()}`) }),
  limits: { fileSize: 10 * 1024 * 1024, files: 10, fields: 1, fieldSize: 512 * 1024, parts: 11 },
}).any();

interface ImageFile { id: string; file: Express.Multer.File }
interface Submission { files: ImageFile[]; scope: string; key?: string; requestHash?: string }
function submission(res: Response): Submission { return res.locals.ticketSubmission; }

// Hash the original payload and bytes before replacing temporary image IDs.
// Metadata ordering and the anti-bot timestamp do not change a user's submission.
function fingerprint(body: unknown, files: Express.Multer.File[] = []): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
    return value;
  };
  const payload = { ...(body as Record<string, unknown>) };
  delete payload.website; delete payload.formStartedAt;
  const hash = createHash('sha256').update(JSON.stringify(canonical(payload)));
  for (const file of [...files].sort((a, b) => a.fieldname.localeCompare(b.fieldname))) {
    hash.update(JSON.stringify([file.fieldname, file.originalname, file.mimetype]));
    hash.update(createHash('sha256').update(readFileSync(file.path)).digest());
  }
  return hash.digest('hex');
}

/** Disk-backed multipart parsing, bounded before validation. JSON clients remain supported. */
export function ticketImageSubmission(req: Request, res: Response, next: NextFunction): void {
  const scope = (req as AuthRequest).user?.id || 'public';
  const key = req.method === 'POST' ? req.get('Idempotency-Key') : undefined;
  if (key && (key.length > 128 || key.length < 16)) { res.status(400).json({ error: 'Ogiltig idempotensnyckel' }); return; }
  res.locals.ticketSubmission = { files: [], scope, key } satisfies Submission;
  // Read replay only after consuming multipart: cleanup also runs for retries.
  const proceed = () => {
    if (key) {
      const saved = db.prepare(`SELECT ticket_id, request_hash FROM ticket_submissions WHERE scope = ? AND key = ? AND expires_at > ?`).get(scope, key, Date.now()) as { ticket_id: string; request_hash: string | null } | undefined;
      if (saved) {
        if (saved.request_hash !== submission(res).requestHash) {
          res.status(409).json({ code: 'IDEMPOTENCY_CONFLICT', error: 'En tidigare version av ärendet är redan sparad. Dina senaste ändringar finns kvar här. Kontrollera innehållet och skicka igen om du vill skapa ett nytt ärende.' });
          return;
        }
        const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(saved.ticket_id);
        if (ticket) { res.status(201).json(scope === 'public' ? { message: 'Ticket submitted successfully', ticketId: saved.ticket_id } : ticket); return; }
      }
    }
    // Do not publish a draft whose local image file was lost. Existing images
    // use the attachment route's read policy: any authenticated user may read.
    const stagedIds = new Set(submission(res).files.map(image => image.id));
    const references = JSON.stringify(req.body ?? {}).matchAll(/\/api\/attachments\/file\/([0-9a-f-]{36})/gi);
    for (const [, id] of references) {
      if (stagedIds.has(id)) continue;
      if (scope === 'public' || !db.prepare('SELECT 1 FROM ticket_attachments WHERE id = ?').get(id)) {
        res.status(400).json({ error: 'En bild saknas. Infoga den igen innan du skickar ärendet.' });
        return;
      }
    }
    next();
  };
  if (!req.is('multipart/form-data')) { if (key) submission(res).requestHash = fingerprint(req.body); proceed(); return; }
  upload(req, res, error => {
    const files = Array.isArray(req.files) ? req.files : [];
    const clean = () => {
      for (const file of files) {
        if (!db.prepare('SELECT 1 FROM ticket_attachments WHERE file_path = ?').get(file.filename)) {
          try { unlinkSync(file.path); } catch { /* already removed by multer */ }
        }
      }
    };
    res.once('finish', clean);
    res.once('close', clean);
    if (error) { clean(); res.status(413).json({ error: 'Högst 10 filer, 10 MB per fil och 25 MB totalt.' }); return; }
    try {
      if (files.reduce((sum, f) => sum + f.size, 0) > 25 * 1024 * 1024) throw new Error('Filerna får vara högst 25 MB sammanlagt.');
      const body: unknown = JSON.parse(req.body.payload);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Ogiltiga formulärdata.');
      if (key) submission(res).requestHash = fingerprint(body, files);
      const ids = new Set<string>();
      let serialized = JSON.stringify(body);
      for (const file of files) {
        if (/^attachment-\d+$/.test(file.fieldname)) {
          const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
          if (['md', 'markdown'].includes(ext) && ['', 'application/octet-stream', 'text/plain'].includes(file.mimetype)) file.mimetype = 'text/markdown';
          if (ids.has(file.fieldname) || !file.size || !ALLOWED_EXTENSIONS.includes(ext)
            || !ALLOWED_MIME_TYPES.includes(file.mimetype) || !hasMagicByteMatch(file.path, file.mimetype)) throw new Error('Ogiltig bilaga eller filtyp.');
          ids.add(file.fieldname);
          submission(res).files.push({ id: randomUUID(), file });
          continue;
        }
        if (!uuid.test(file.fieldname) || ids.has(file.fieldname)) throw new Error('Ogiltig bildreferens.');
        ids.add(file.fieldname);
        const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
        if (!file.size || !mimeExtensions[file.mimetype]?.includes(ext) || !hasMagicByteMatch(file.path, file.mimetype)) throw new Error('Ogiltig bild. Välj PNG, JPEG, GIF eller WebP.');
        const reference = `/api/attachments/file/${file.fieldname}`;
        if (!serialized.includes(reference)) throw new Error('Bilden saknar plats i formuläret.');
        const id = randomUUID();
        serialized = serialized.split(reference).join(`/api/attachments/file/${id}`);
        submission(res).files.push({ id, file });
      }
      req.body = JSON.parse(serialized);
      proceed();
    } catch (err) { clean(); res.status(400).json({ error: err instanceof Error ? err.message : 'Bilderna kunde inte läsas.' }); }
  });
}

/** Called INSIDE the ticket transaction: files and retry identity commit together. */
export function commitTicketImages(res: Response, ticketId: string): void {
  const state = submission(res);
  if (!state) return;
  const count = db.prepare('SELECT count(*) AS total FROM ticket_attachments WHERE ticket_id = ?').get(ticketId) as { total: number };
  if (count.total + state.files.length > 50) throw new Error('Ärendet har för många bilagor.');
  const insert = db.prepare('INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path, file_size, file_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const { id, file } of state.files) insert.run(id, ticketId, file.originalname, file.filename, file.size, file.mimetype, new Date().toISOString());
  if (state.key) {
    db.prepare('DELETE FROM ticket_submissions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO ticket_submissions (scope, key, ticket_id, expires_at, request_hash) VALUES (?, ?, ?, ?, ?)').run(state.scope, state.key, ticketId, Date.now() + 24 * 60 * 60 * 1000, state.requestHash);
  }
}
