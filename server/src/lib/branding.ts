import { existsSync, mkdirSync, unlinkSync, openSync, readSync, closeSync } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { db } from '../db/connection.js';
import { getSetting, setSetting } from './settings.js';
import { logger } from './logger.js';

/**
 * Configurable instance logo: an admin uploads a PNG/JPEG/WebP that replaces
 * the built-in default brand mark. Settings are stored as three keys in the
 * generic app_settings table (migration 064 — no dedicated table/migration
 * needed here):
 *   - branding_logo_filename  — server-generated filename on disk
 *   - branding_logo_mime      — one of ALLOWED_LOGO_MIME_TYPES
 *   - branding_logo_updated_at — ISO timestamp, used for cache-busting the URL
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Same UPLOAD_DIR resolution as attachments.ts/kb.ts (each route module
// computes it independently — no shared constant exists in this codebase).
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');
const BRANDING_DIR = join(UPLOAD_DIR, 'branding');

if (!existsSync(BRANDING_DIR)) {
  mkdirSync(BRANDING_DIR, { recursive: true });
}

/** Max accepted logo size (bytes). Lower than the 10 MB attachment cap — a
 * logo doesn't need it, and a tighter limit is a smaller attack surface. */
export const MAX_LOGO_SIZE = 1 * 1024 * 1024; // 1 MB

// Allowlist: PNG/JPEG/WebP only — explicitly NOT image/svg+xml. This file is
// served with `Content-Disposition: inline` from our own origin (see
// routes/public.ts GET /branding/logo), and SVG can carry <script>/onload —
// allowing it here would be a stored-XSS vector against every visitor. Do
// not add svg (or any other script-capable format) to this list.
export const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Extension the stored file gets, keyed by the ALLOWED_LOGO_MIME_TYPES entry
// that fileFilter accepted — NEVER by file.originalname. Deriving it from the
// client's filename let MIME and on-disk extension diverge (real PNG bytes +
// image/png + filename "x.webp" saved as .webp), which is harmless today
// (Content-Type is always looked up from the verified mime, not the
// extension) but is exactly the kind of divergence that becomes dangerous
// the day something is added that trusts the extension.
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Thrown by uploadLogo's fileFilter for expected client-side validation
 * failures (disallowed MIME). Distinguished from multer.MulterError (size
 * cap etc.) and from genuine system errors so the route handler can return
 * 400 with `.message` for both of these but 500-with-generic-text for
 * anything unexpected (e.g. a filesystem fault). */
export class LogoValidationError extends Error {}

// Server-defined mime -> Content-Type map. The response header is ALWAYS
// looked up here, never echoed from a client- or storage-supplied string
// directly, so a corrupted/tampered app_settings row can't inject an
// arbitrary Content-Type value into the response.
const MIME_CONTENT_TYPE: Record<string, string> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
};

const BRANDING_LOGO_FILENAME_KEY = 'branding_logo_filename';
const BRANDING_LOGO_MIME_KEY = 'branding_logo_mime';
const BRANDING_LOGO_UPDATED_AT_KEY = 'branding_logo_updated_at';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BRANDING_DIR),
  filename: (_req, file, cb) => {
    // Server-generated filename — the client's original filename is never
    // used to build a path. The extension comes from MIME_TO_EXTENSION keyed
    // on file.mimetype, which is safe to trust here specifically because
    // multer always runs fileFilter (below) before this callback — by the
    // time we get here, file.mimetype has already been checked against
    // ALLOWED_LOGO_MIME_TYPES.
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(2)}`;
    const ext = MIME_TO_EXTENSION[file.mimetype] || 'bin';
    cb(null, `logo-${uniqueSuffix}.${ext}`);
  },
});

export const uploadLogo = multer({
  storage,
  limits: { fileSize: MAX_LOGO_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_LOGO_MIME_TYPES.includes(file.mimetype)) {
      return cb(new LogoValidationError('Only PNG, JPEG or WebP images are allowed.'));
    }
    cb(null, true);
  },
});

/**
 * Magic-byte check for an uploaded logo file, verified AFTER multer has
 * written it to disk — never trust req.file.mimetype (client-supplied).
 *
 * IMPORTANT — this is a PREFIX check, not an image validator: it only proves
 * the file's first few bytes (3 for JPEG, 8 for PNG, RIFF+4 free bytes+WEBP
 * for WebP) match the declared type. It does NOT parse or decode the image,
 * so a polyglot — valid JPEG magic bytes followed by arbitrary trailing bytes
 * such as `<script>...</script>` — passes this check. Whatever calls this
 * and then serves the file `inline` MUST NOT rely on this function alone for
 * that to be safe; see the three-guarantee comment in
 * routes/public.ts:GET /branding/logo (the third guarantee, `nosniff`, is
 * what actually neutralizes the polyglot case).
 *
 * Deliberately NOT reusing attachments.ts:hasMagicByteMatch: that helper's
 * signature model is "one contiguous magic run at a fixed offset", which
 * can't express WebP's container format — a "RIFF" fourcc at byte 0 followed
 * by a 4-byte little-endian file size (NOT part of the signature) and then a
 * "WEBP" fourcc at byte 8. This is a deliberate duplication, noted here.
 */
export function hasValidLogoMagicBytes(filePath: string, declaredMime: string): boolean {
  let header: Buffer;
  try {
    const fd = openSync(filePath, 'r');
    try {
      header = Buffer.alloc(16);
      readSync(fd, header, 0, 16, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }

  switch (declaredMime) {
    case 'image/png':
      return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case 'image/webp':
      return (
        header.subarray(0, 4).toString('ascii') === 'RIFF' &&
        header.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    default:
      return false;
  }
}

export interface BrandingInfo {
  logoUrl: string | null;
}

/** Public shape returned by both GET /api/public/branding and the
 * upload/delete endpoints, so the client always sees a consistent contract. */
export function getBrandingInfo(): BrandingInfo {
  const filename = getSetting(BRANDING_LOGO_FILENAME_KEY);
  if (!filename) return { logoUrl: null };
  const updatedAt = getSetting(BRANDING_LOGO_UPDATED_AT_KEY);
  const parsed = updatedAt ? Date.parse(updatedAt) : NaN;
  const v = Number.isFinite(parsed) ? parsed : Date.now();
  return { logoUrl: `/api/public/branding/logo?v=${v}` };
}

// Resolved once so every request compares against the same normalized
// absolute path (with a trailing separator, so that a sibling directory like
// `.../branding-evil` can't accidentally match the `.../branding` prefix).
const RESOLVED_BRANDING_DIR = resolve(BRANDING_DIR);
const RESOLVED_BRANDING_DIR_WITH_SEP = RESOLVED_BRANDING_DIR.endsWith(sep)
  ? RESOLVED_BRANDING_DIR
  : RESOLVED_BRANDING_DIR + sep;

/**
 * Resolves the on-disk path + response Content-Type for the configured logo.
 * Returns null (caller should 404) when no logo is configured, the stored
 * mime is unrecognized, the file is missing from disk despite the setting
 * existing (defensive — the upload volume may have been swapped/reset), or
 * the resolved path escapes BRANDING_DIR.
 *
 * The filename is server-generated at upload time (see the multer `filename`
 * callback above), so this isn't exploitable today. But `filename` is read
 * back from app_settings — a plain string column — and passed to
 * res.sendFile() by the caller. `join()` normalizes `..` segments, so if a
 * `branding_logo_filename` value were ever attacker-controlled (a future
 * bug, a generic settings-write endpoint, a bad restore, a SQL injection
 * elsewhere), this would become an unauthenticated arbitrary-file-read. Defend
 * against that class of bug here rather than trusting the write side forever.
 */
export function getStoredLogoPath(): { path: string; contentType: string } | null {
  const filename = getSetting(BRANDING_LOGO_FILENAME_KEY);
  const mime = getSetting(BRANDING_LOGO_MIME_KEY);
  if (!filename || !mime) return null;

  const contentType = MIME_CONTENT_TYPE[mime];
  if (!contentType) return null;

  const filePath = resolve(join(BRANDING_DIR, filename));
  if (filePath !== RESOLVED_BRANDING_DIR && !filePath.startsWith(RESOLVED_BRANDING_DIR_WITH_SEP)) {
    logger.warn('Branding logo filename resolved outside BRANDING_DIR — refusing to serve', {
      filename,
      resolved: filePath,
    });
    return null;
  }

  if (!existsSync(filePath)) return null;

  return { path: filePath, contentType };
}

// The three-key write is wrapped in a single SQLite transaction so a reader
// (getBrandingInfo/getStoredLogoPath) never observes a half-updated state —
// e.g. filename pointing at the new file but mime still the old value.
const writeLogoSettingsTx = db.transaction((filename: string, mime: string, updatedAt: string) => {
  setSetting(BRANDING_LOGO_FILENAME_KEY, filename);
  setSetting(BRANDING_LOGO_MIME_KEY, mime);
  setSetting(BRANDING_LOGO_UPDATED_AT_KEY, updatedAt);
});

/**
 * Persists a newly uploaded+verified logo as the active one, deleting the
 * previous file from disk so repeated replacements don't leak disk space.
 *
 * Order matters: the new settings row is committed FIRST, and the old file
 * is only unlinked afterwards. getSetting -> unlinkSync -> setSetting (the
 * previous order) had a race — two concurrent uploads could both read the
 * same oldFilename, and whichever's unlink lost the race left an orphaned
 * (unreferenced) file on disk from the other's already-committed upload.
 * Committing the row first means any concurrent reader always resolves to a
 * file that still exists — old (row not yet updated) or new (row updated) —
 * never a reference to a file that's already gone.
 */
export function saveLogoSettings(filename: string, mime: string): void {
  const oldFilename = getSetting(BRANDING_LOGO_FILENAME_KEY);

  writeLogoSettingsTx(filename, mime, new Date().toISOString());

  if (oldFilename && oldFilename !== filename) {
    const oldPath = join(BRANDING_DIR, oldFilename);
    try {
      if (existsSync(oldPath)) unlinkSync(oldPath);
    } catch (err) {
      logger.warn('Kunde inte radera gammal logotypfil', { oldPath, error: String(err) });
    }
  }
}

/**
 * Removes the configured logo (file + settings). Idempotent: safe to call
 * when no logo is configured.
 *
 * Note: server/src/lib/settings.ts (out of this ticket's write set) exposes
 * no deleteSetting() helper, so the three keys are cleared directly via a
 * parameterized DELETE here rather than adding one to that file.
 */
export function deleteLogo(): void {
  const filename = getSetting(BRANDING_LOGO_FILENAME_KEY);
  if (filename) {
    const filePath = join(BRANDING_DIR, filename);
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch (err) {
      logger.warn('Kunde inte radera logotypfil', { filePath, error: String(err) });
    }
  }
  db.prepare(`DELETE FROM app_settings WHERE key IN (?, ?, ?)`).run(
    BRANDING_LOGO_FILENAME_KEY,
    BRANDING_LOGO_MIME_KEY,
    BRANDING_LOGO_UPDATED_AT_KEY
  );
}
