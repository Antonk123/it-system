import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Appkoden ska alltid skriva ISO-8601 UTC ('2026-10-09T09:06:02.123Z'), aldrig
 * SQLites CURRENT_TIMESTAMP-format ('2026-10-09 09:06:02') — frontendens
 * new Date() tolkar det senare som LOKAL tid och förskjuter visade klockslag,
 * och blandade format ger fel sortering/jämförelse. Skapar ärende, kommentar,
 * historik- och audit-rad via riktiga routes/helpers och kontrollerar formatet.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-tsformat.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-tsformat-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-tsformat-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from './connection.js';
import { createApp } from '../app.js';
import { logAudit } from '../lib/auditLog.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let agent: ReturnType<typeof request.agent>;
let token: string;
let csrf: string;
let userId: string;

beforeAll(async () => {
  initializeDatabase();
  userId = randomUUID();
  const hash = await bcrypt.hash('Agent-P@ss1234!', 10);
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(userId, 'agent@tsformat.local', hash, 'admin', 'TS Agent');

  agent = request.agent(createApp());
  const login = await agent.post('/api/auth/login').send({ email: 'agent@tsformat.local', password: 'Agent-P@ss1234!' });
  token = login.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  csrf = csrfRes.body.csrfToken as string;
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('timestamp format written by application code', () => {
  it('stores ISO-8601 UTC for ticket, comment, history, audit and login rows', async () => {
    const ticketRes = await agent
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ title: 'Tidsformat', description: 'kontroll av tidsstämplar' });
    expect(ticketRes.status).toBe(201);
    const ticketId = ticketRes.body.id as string;

    const commentRes = await agent
      .post(`/api/comments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ content: 'En kommentar', is_internal: true });
    expect(commentRes.status).toBe(201);

    logAudit(userId, 'timestamp_test', 'ticket', ticketId, null, undefined);

    const ticket = db.prepare('SELECT created_at, updated_at FROM tickets WHERE id = ?').get(ticketId) as Record<string, string>;
    const comment = db.prepare('SELECT created_at, updated_at FROM ticket_comments WHERE ticket_id = ?').get(ticketId) as Record<string, string>;
    const history = db.prepare('SELECT changed_at FROM ticket_history WHERE ticket_id = ?').all(ticketId) as { changed_at: string }[];
    const audit = db.prepare("SELECT created_at FROM audit_log WHERE action = 'timestamp_test'").get() as Record<string, string>;
    const refresh = db.prepare('SELECT created_at FROM refresh_tokens WHERE user_id = ?').get(userId) as Record<string, string>;
    const user = db.prepare('SELECT last_login FROM users WHERE id = ?').get(userId) as Record<string, string>;

    expect(ticket.created_at).toMatch(ISO_UTC);
    expect(ticket.updated_at).toMatch(ISO_UTC);
    expect(comment.created_at).toMatch(ISO_UTC);
    expect(comment.updated_at).toMatch(ISO_UTC);
    expect(history.length).toBeGreaterThan(0);
    for (const h of history) expect(h.changed_at).toMatch(ISO_UTC);
    expect(audit.created_at).toMatch(ISO_UTC);
    expect(refresh.created_at).toMatch(ISO_UTC);
    expect(user.last_login).toMatch(ISO_UTC);
  });
});
