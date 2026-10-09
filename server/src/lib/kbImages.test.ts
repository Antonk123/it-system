import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const { DB_PATH, DIR } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-kbimages.sqlite`);
  const dir = join(tmpdir(), `itticket-kbimages-${process.pid}-${Date.now()}`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.UPLOAD_DIR = dir;
  process.env.CSRF_SECRET = 'test-csrf-secret-kbimg-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-kbimg-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath, DIR: dir };
});

import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { cleanupOrphanKbImages, extractKbImageFilenames } from './kbImages.js';

const DAY = 24 * 60 * 60 * 1000;
const img = (name: string) => `<p><img src="/api/kb/images/${name}"></p>`;

function put(name: string, ageMs: number): void {
  const path = join(DIR, name);
  writeFileSync(path, 'x');
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
}

beforeAll(() => {
  mkdirSync(DIR, { recursive: true });
  initializeDatabase();
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    if (existsSync(DB_PATH + s)) rmSync(DB_PATH + s, { force: true });
  }
  rmSync(DIR, { recursive: true, force: true });
});

describe('extractKbImageFilenames', () => {
  it('finds only local kb-* images and ignores traversal and external URLs', () => {
    const html = `${img('kb-1.png')}${img('kb-2.jpg')}<img src="https://x.se/kb-3.png"><img src="/api/kb/images/kb-..%2Fx"><img src="/api/kb/images/other.png">`;
    expect([...extractKbImageFilenames(html)].sort()).toEqual(['kb-1.png', 'kb-2.jpg']);
  });
});

describe('cleanupOrphanKbImages', () => {
  it('deletes old unreferenced kb-* files only', () => {
    const articleId = randomUUID();
    const ticketId = randomUUID();
    const commentUser = randomUUID();
    db.prepare("INSERT INTO kb_categories (id, name, position) VALUES ('c1', 'K', 0)").run();
    db.prepare("INSERT INTO kb_articles (id, title, content, category_id, status) VALUES (?, 'a', ?, 'c1', 'published')").run(articleId, img('kb-in-article.png'));
    db.prepare("INSERT INTO tickets (id, title, description, status, priority, notes) VALUES (?, 't', ?, 'open', 'medium', ?)").run(ticketId, img('kb-in-ticket.png'), img('kb-in-notes.png'));
    db.prepare("INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, 'u@k.test', 'x', 'user', 'U')").run(commentUser);
    db.prepare("INSERT INTO ticket_comments (id, ticket_id, user_id, content) VALUES (?, ?, ?, ?)").run(randomUUID(), ticketId, commentUser, img('kb-in-comment.png'));

    put('kb-orphan-old.png', 2 * DAY);
    put('kb-orphan-old2.png', 30 * DAY);
    put('kb-orphan-fresh.png', 60 * 60 * 1000); // pending upload < 24 h
    put('kb-in-article.png', 5 * DAY);
    put('kb-in-ticket.png', 5 * DAY);
    put('kb-in-notes.png', 5 * DAY);
    put('kb-in-comment.png', 5 * DAY);
    put('attachment-old.png', 5 * DAY); // not a kb-* file

    expect(cleanupOrphanKbImages(db, DIR)).toBe(2);

    expect(existsSync(join(DIR, 'kb-orphan-old.png'))).toBe(false);
    expect(existsSync(join(DIR, 'kb-orphan-old2.png'))).toBe(false);
    for (const kept of ['kb-orphan-fresh.png', 'kb-in-article.png', 'kb-in-ticket.png', 'kb-in-notes.png', 'kb-in-comment.png', 'attachment-old.png']) {
      expect(existsSync(join(DIR, kept))).toBe(true);
    }
  });

  it('is idempotent and tolerates a missing directory', () => {
    expect(cleanupOrphanKbImages(db, DIR)).toBe(0);
    expect(cleanupOrphanKbImages(db, join(DIR, 'nope'))).toBe(0);
  });

  it('deletes a file once it is no longer referenced and old enough (injected clock)', () => {
    put('kb-late.png', 0);
    expect(cleanupOrphanKbImages(db, DIR)).toBe(0);
    // kb-late.png och den tidigare kvarlämnade kb-orphan-fresh.png har nu passerat 24 h.
    expect(cleanupOrphanKbImages(db, DIR, Date.now() + 2 * DAY)).toBe(2);
    expect(existsSync(join(DIR, 'kb-late.png'))).toBe(false);
    expect(existsSync(join(DIR, 'kb-in-article.png'))).toBe(true);
  });
});
