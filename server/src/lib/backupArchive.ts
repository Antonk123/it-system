import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { ZipArchive } from 'archiver';
import unzipper from 'unzipper';
import { chmodSync, createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { resolveUploadPath } from './uploadPath.js';

const RICH_TEXT_COLUMNS = [
  ['kb_articles', 'content'],
  ['tickets', 'description'], ['tickets', 'notes'], ['tickets', 'solution'],
  ['ticket_comments', 'content'], ['ticket_field_values', 'field_value'],
  ['ticket_templates', 'description_template'], ['ticket_templates', 'notes_template'],
  ['ticket_templates', 'solution_template'],
  ['template_fields', 'default_value'],
] as const;

function hasColumn(db: DatabaseType, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .some(info => info.name === column);
}

function requiredUploadEntries(db: DatabaseType, uploadDir: string): Set<string> {
  const entries = new Set<string>();
  const add = (filename: string) => {
    const path = resolveUploadPath(uploadDir, filename);
    if (!path) throw new Error('Backupen innehåller en ogiltig filreferens');
    entries.add(`data/uploads/${relative(uploadDir, path).replaceAll('\\', '/')}`);
  };
  if (hasColumn(db, 'ticket_attachments', 'file_path')) {
    for (const file of db.prepare('SELECT file_path FROM ticket_attachments').all() as { file_path: string }[]) {
      add(file.file_path);
    }
  }
  for (const [table, column] of RICH_TEXT_COLUMNS) {
    // Older snapshots can predate a table/column. Identifiers are fixed above.
    if (!hasColumn(db, table, column)) continue;
    for (const row of db.prepare(`SELECT ${column} AS content FROM ${table}`).iterate() as Iterable<{ content: string | null }>) {
      for (const match of (row.content || '').matchAll(/\/api\/kb\/images\/(kb-[^/?#"'\s<>]+)/gi)) add(match[1]);
    }
  }
  if (hasColumn(db, 'app_settings', 'value')) {
    const logo = db.prepare("SELECT value FROM app_settings WHERE key = 'branding_logo_filename'").get() as { value: string } | undefined;
    if (logo?.value) {
      const logoPath = resolveUploadPath(join(uploadDir, 'branding'), logo.value);
      if (!logoPath) throw new Error('Backupen innehåller en ogiltig logotypreferens');
      add(relative(uploadDir, logoPath));
    }
  }
  return entries;
}

export function backupDataBytes(database: DatabaseType, uploadDir: string): number {
  const directoryBytes = (directory: string): number => {
    if (!existsSync(directory)) return 0;
    return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
      const path = join(directory, entry.name);
      return total + (entry.isDirectory() ? directoryBytes(path) : entry.isFile() ? statSync(path).size : 0);
    }, 0);
  };
  return statSync(database.name).size + directoryBytes(uploadDir);
}

/** Both scheduled and HTTP backups must pass this before reporting success. */
export async function buildBackupArchive(
  database: DatabaseType, snapshotPath: string, zipPath: string, uploadDir: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await database.backup(snapshotPath);
  chmodSync(snapshotPath, 0o600);
  signal?.throwIfAborted();

  const snapshot = new Database(snapshotPath, { readonly: true });
  let required: Set<string>;
  try {
    const check = snapshot.pragma('integrity_check') as { integrity_check: string }[];
    if (check.length !== 1 || check[0].integrity_check !== 'ok') throw new Error('Backupens databaskopia klarar inte integrity_check');
    required = requiredUploadEntries(snapshot, uploadDir);
  } finally {
    snapshot.close();
  }

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath, { mode: 0o600 });
    const archive = new ZipArchive({ zlib: { level: 6 } });
    let failure: Error | undefined;
    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      archive.abort();
      output.destroy();
    };
    const abort = () => fail(new Error('Backupnedladdningen avbröts'));
    signal?.addEventListener('abort', abort, { once: true });
    // Wait for close even on failure: open() can still be pending when archive
    // creation fails. Callers must not clean up before the file can be created.
    output.once('close', () => {
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve();
    });
    output.once('error', fail);
    archive.once('error', fail);
    archive.once('warning', fail);
    try {
      archive.pipe(output);
      archive.file(snapshotPath, { name: 'data/database.sqlite' });
      if (existsSync(uploadDir)) archive.directory(uploadDir, 'data/uploads');
      void archive.finalize().catch(fail);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  signal?.throwIfAborted();

  const directory = await unzipper.Open.file(zipPath);
  const dbEntry = directory.files.find(file => file.path === 'data/database.sqlite');
  if (!dbEntry || dbEntry.uncompressedSize !== statSync(snapshotPath).size) {
    throw new Error('Backup-ZIP:en är ofullständig: databaskopian saknas eller har fel storlek');
  }
  const archivedFiles = new Set(directory.files.filter(file => file.type === 'File').map(file => file.path));
  if ([...required].some(entry => !archivedFiles.has(entry))) {
    throw new Error('Backup-ZIP:en är ofullständig: en fil som databaskopian refererar till saknas');
  }
}
