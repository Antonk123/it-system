import type { Database } from 'better-sqlite3';
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

// Nyuppladdade bilder kan tillhöra ett ännu osparat utkast.
const PENDING_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

// Rich-text-editorn laddar upp via /api/kb/upload-image även för ärenden,
// kommentarer och mallar, så en bild kan refereras från fler ställen än artiklar.
const IMAGE_REFERENCE_COLUMNS: [table: string, column: string][] = [
  ['kb_articles', 'content'],
  ['tickets', 'description'],
  ['tickets', 'notes'],
  ['tickets', 'solution'],
  ['ticket_comments', 'content'],
  ['ticket_templates', 'description_template'],
  ['ticket_templates', 'notes_template'],
  ['ticket_templates', 'solution_template'],
];

// Extraherar kb-* bildfilnamn refererade via <img src="/api/kb/images/kb-…"> i
// innehåll. Delas mellan PUT (diff mot gammalt innehåll), DELETE (radera alla)
// och föräldralösa-bilder-städningen.
export function extractKbImageFilenames(content: string): Set<string> {
  const filenames = new Set<string>();
  const imgSrcPattern = /<img[^>]+src="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = imgSrcPattern.exec(content)) !== null) {
    const src = match[1];
    // Matcha bara lokalt uppladdade KB-bilder: /api/kb/images/<filename>
    const localMatch = src.match(/\/api\/kb\/images\/(kb-[^/?#"]+)$/);
    if (!localMatch) continue;
    const filename = localMatch[1];
    // Förhindra path-traversal: filnamnet får inte innehålla sökvägskomponenter.
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) continue;
    filenames.add(filename);
  }
  return filenames;
}

// Raderar en enskild lokalt uppladdad KB-bildfil (best-effort, icke-fatalt).
export function deleteKbImageFile(filename: string, uploadDir: string = UPLOAD_DIR): void {
  const filePath = join(uploadDir, filename);
  // Radera bara filer som faktiskt ligger i uploadDir.
  if (!filePath.startsWith(uploadDir + '/') && filePath !== uploadDir) return;
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (unlinkErr) {
    logger.warn('KB: kunde inte radera inbäddad bild', { filePath, error: String(unlinkErr) });
  }
}

function isReferenced(db: Database, filename: string): boolean {
  return IMAGE_REFERENCE_COLUMNS.some(([table, column]) =>
    db.prepare(`SELECT 1 FROM ${table} WHERE instr(${column}, ?) > 0 LIMIT 1`).get(`/api/kb/images/${filename}`) !== undefined
  );
}

/**
 * Raderar kb-*-filer i uploadDir som varken refereras från något innehåll eller
 * är yngre än 24 h. Returnerar antal raderade filer. Avsedd att köras av
 * retention-cron.
 */
export function cleanupOrphanKbImages(db: Database, uploadDir: string = UPLOAD_DIR, now: number = Date.now()): number {
  if (!existsSync(uploadDir)) return 0;
  let deleted = 0;
  for (const filename of readdirSync(uploadDir)) {
    if (!filename.startsWith('kb-')) continue;
    try {
      if (now - statSync(join(uploadDir, filename)).mtimeMs < PENDING_UPLOAD_GRACE_MS) continue;
      if (isReferenced(db, filename)) continue;
      deleteKbImageFile(filename, uploadDir);
      deleted++;
    } catch (err) {
      logger.warn('KB: kunde inte städa bildfil', { filename, error: String(err) });
    }
  }
  return deleted;
}
