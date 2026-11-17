import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import unzipper from 'unzipper';
import { buildBackupArchive } from './backupArchive.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'itticket-archive-integrity-'));
  roots.push(root);
  const uploads = join(root, 'uploads');
  mkdirSync(uploads);
  const db = new Database(join(root, 'source.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE tickets (id TEXT PRIMARY KEY, description TEXT, notes TEXT, solution TEXT);
    CREATE TABLE ticket_attachments (id TEXT, ticket_id TEXT, file_path TEXT);
    CREATE TABLE kb_articles (content TEXT);
    CREATE TABLE ticket_field_values (field_value TEXT);
    CREATE TABLE ticket_comments (content TEXT);
    CREATE TABLE ticket_templates (description_template TEXT, notes_template TEXT, solution_template TEXT);
    CREATE TABLE template_fields (default_value TEXT);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  const snapshot = join(root, 'snapshot.sqlite');
  const zip = join(root, 'backup.zip');
  return { root, uploads, db, snapshot, zip };
}

describe('verified DB and upload backup archives', () => {
  it('keeps WAL data, referenced attachments, rich-text images and nested branding files in the same verified archive', async () => {
    const f = fixture();
    try {
      f.db.prepare('INSERT INTO tickets VALUES (?,?,?,?)').run('ticket', 'Only in WAL', '', '');
      f.db.prepare('INSERT INTO ticket_attachments VALUES (?,?,?)').run('file', 'ticket', 'document.txt');
      f.db.prepare('INSERT INTO ticket_field_values VALUES (?)').run('<img src="/api/kb/images/kb-field.png">');
      f.db.prepare('INSERT INTO app_settings VALUES (?,?)').run('branding_logo_filename', 'logo.png');
      mkdirSync(join(f.uploads, 'branding'));
      writeFileSync(join(f.uploads, 'document.txt'), 'original attachment');
      writeFileSync(join(f.uploads, 'kb-field.png'), 'original image');
      writeFileSync(join(f.uploads, 'branding/logo.png'), 'original logo');

      await buildBackupArchive(f.db, f.snapshot, f.zip, f.uploads);

      const archive = await unzipper.Open.file(f.zip);
      expect(archive.files.map(file => file.path)).toEqual(expect.arrayContaining([
        'data/database.sqlite', 'data/uploads/document.txt', 'data/uploads/kb-field.png', 'data/uploads/branding/logo.png',
      ]));
      const restoredPath = join(f.root, 'restored.sqlite');
      writeFileSync(restoredPath, await archive.files.find(file => file.path === 'data/database.sqlite')!.buffer());
      const restored = new Database(restoredPath, { readonly: true });
      try { expect(restored.prepare('SELECT description FROM tickets').pluck().get()).toBe('Only in WAL'); }
      finally { restored.close(); }
      expect((await archive.files.find(file => file.path === 'data/uploads/document.txt')!.buffer()).toString()).toBe('original attachment');
    } finally { f.db.close(); }
  });

  it('rejects a concurrent attachment deletion after the real DB snapshot, rather than accepting a broken backup', async () => {
    const f = fixture();
    try {
      f.db.prepare('INSERT INTO tickets VALUES (?,?,?,?)').run('ticket', 'Description', '', '');
      f.db.prepare('INSERT INTO ticket_attachments VALUES (?,?,?)').run('file', 'ticket', 'document.txt');
      writeFileSync(join(f.uploads, 'document.txt'), 'must not silently disappear');
      const backup = f.db.backup.bind(f.db);
      vi.spyOn(f.db, 'backup').mockImplementationOnce(async destination => {
        const result = await backup(destination);
        f.db.prepare('DELETE FROM ticket_attachments WHERE id=?').run('file');
        unlinkSync(join(f.uploads, 'document.txt'));
        return result;
      });
      await expect(buildBackupArchive(f.db, f.snapshot, f.zip, f.uploads)).rejects.toThrow(/ofullständig/);
      const snap = new Database(f.snapshot, { readonly: true });
      try { expect(snap.prepare('SELECT COUNT(*) FROM ticket_attachments').pluck().get()).toBe(1); }
      finally { snap.close(); }
    } finally { f.db.close(); }
  });

  it.each([
    ['kb_articles', 'content'], ['tickets', 'description'], ['tickets', 'notes'], ['tickets', 'solution'],
    ['ticket_comments', 'content'], ['ticket_field_values', 'field_value'],
    ['ticket_templates', 'description_template'], ['ticket_templates', 'notes_template'], ['ticket_templates', 'solution_template'],
    ['template_fields', 'default_value'],
  ])('rejects a missing persistent KB image referenced by %s.%s', async (table, column) => {
    const f = fixture();
    try {
      const html = '<img src="/api/kb/images/kb-missing.png">';
      if (table === 'tickets') f.db.prepare(`INSERT INTO tickets(id,${column}) VALUES (?,?)`).run('ticket', html);
      else f.db.prepare(`INSERT INTO ${table}(${column}) VALUES (?)`).run(html);
      await expect(buildBackupArchive(f.db, f.snapshot, f.zip, f.uploads)).rejects.toThrow(/ofullständig/);
    } finally { f.db.close(); }
  });

  it('does not mistake deleted, unreferenced upload bytes for missing required content', async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.uploads, 'unused.txt'), 'orphan');
      const backup = f.db.backup.bind(f.db);
      vi.spyOn(f.db, 'backup').mockImplementationOnce(async destination => {
        const result = await backup(destination);
        unlinkSync(join(f.uploads, 'unused.txt'));
        return result;
      });
      await buildBackupArchive(f.db, f.snapshot, f.zip, f.uploads);
      expect(readdirSync(f.root)).toContain('backup.zip');
      expect(readFileSync(f.zip).subarray(0, 2).toString()).toBe('PK');
    } finally { f.db.close(); }
  });
});
