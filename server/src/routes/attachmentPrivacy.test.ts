import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const { directory } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'itticket-attachment-privacy-'));
  process.env.DB_PATH = join(directory, 'test.sqlite');
  process.env.UPLOAD_DIR = join(directory, 'uploads');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'privacy-test-jwt-secret-01234567890123456789';
  process.env.CSRF_SECRET = 'privacy-test-csrf-secret-01234567890123456789';
  for (const key of ['SMTP_HOST', 'IMAP_HOST', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'OIDC_ISSUER_URL']) delete process.env[key];
  return { directory };
});

// Keep real MIME parsing and persistence; no SMTP/push or webhook network leaves this fixture.
vi.mock('../lib/push.js', () => ({
  sendPushToAllSubscriptions: vi.fn(async () => undefined),
  sendPushNotification: vi.fn(async () => undefined),
  initWebPush: vi.fn(() => false),
}));

import { closeDatabase, db, initializeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';
import { __test__ as mail } from '../lib/emailInbound.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WNPsAAAAASUVORK5CYII=', 'base64');
let app: ReturnType<typeof createApp>;
let agent: ReturnType<typeof request.agent>;
let token: string;
let csrf: string;
let userId: string;
let ip = 1;
const source = (id: string) => `/api/attachments/file/${id}`;
const image = (id: string) => `<p><img src="${source(id)}"></p>`;
const anonymous = (path: string) => request(app).get(path).set('X-Forwarded-For', `203.0.113.${ip++}`);
const post = (path: string) => agent.post(path).set('Authorization', `Bearer ${token}`).set('x-csrf-token', csrf);
const put = (path: string) => agent.put(path).set('Authorization', `Bearer ${token}`).set('x-csrf-token', csrf);

beforeAll(async () => {
  initializeDatabase();
  mkdirSync(process.env.UPLOAD_DIR!, { recursive: true });
  userId = randomUUID();
  db.prepare('INSERT INTO users (id,email,password_hash,role,display_name) VALUES (?,?,?,?,?)')
    .run(userId, 'privacy-staff@example.test', 'unused', 'admin', 'Privacy Staff');
  token = jwt.sign({ sub: userId, tv: 0 }, process.env.JWT_SECRET!, { expiresIn: '15m' });
  app = createApp();
  agent = request.agent(app);
  const response = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  csrf = response.body.csrfToken;
});

afterAll(() => {
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

async function createTicket(extra: Record<string, unknown> = {}): Promise<string> {
  const response = await post('/api/tickets').send({ title: 'Attachment privacy', description: '<p>Public description</p>', ...extra });
  expect(response.status).toBe(201);
  return response.body.id;
}

async function share(ticketId: string): Promise<string> {
  const response = await post(`/api/shares/ticket/${ticketId}`).send({});
  expect(response.status).toBe(201);
  return response.body.share_token;
}

async function assertHidden(shareToken: string, attachmentId: string): Promise<void> {
  const response = await anonymous(`/api/shares/public/${shareToken}`);
  expect(response.status).toBe(200);
  expect(response.body.attachments.map((file: { id: string }) => file.id)).not.toContain(attachmentId);
  const direct = await anonymous(`/api/shares/public/file/${shareToken}/${attachmentId}`);
  expect(direct.status).toBe(404);
}

async function assertPublic(shareToken: string, attachmentId: string): Promise<void> {
  const response = await anonymous(`/api/shares/public/${shareToken}`);
  expect(response.status).toBe(200);
  const file = response.body.attachments.find((file: { id: string }) => file.id === attachmentId);
  expect(file).toBeDefined();
  const direct = await anonymous(file.url);
  expect(direct.status).toBe(200);
  expect(direct.body).toEqual(png);
}

describe('public ticket shares preserve attachment privacy', () => {
  it('excludes a notes-only multipart image from both listing and direct download while retaining staff access', async () => {
    const draftId = randomUUID();
    const response = await post('/api/tickets')
      .field('payload', JSON.stringify({ title: 'Internal note image', description: '<p>Public summary</p>', notes: image(draftId) }))
      .attach(draftId, png, 'notes-only.png');
    expect(response.status).toBe(201);
    const stored = db.prepare('SELECT id FROM ticket_attachments WHERE ticket_id=?').get(response.body.id) as { id: string };
    const shareToken = await share(response.body.id);
    await assertHidden(shareToken, stored.id);
    const staffFile = await agent.get(source(stored.id)).set('Authorization', `Bearer ${token}`);
    expect(staffFile.status).toBe(200);
    expect(staffFile.body).toEqual(png);
  });

  it.each(['description', 'solution', 'customFields'] as const)('keeps an inline image saved in public %s available', async (field) => {
    const draftId = randomUUID();
    const payload: Record<string, unknown> = { title: `Public ${field} image`, description: '<p>Visible</p>' };
    if (field === 'customFields') payload.customFields = [{ fieldName: 'details', fieldLabel: 'Details', fieldValue: image(draftId) }];
    else payload[field] = image(draftId);
    const response = await post('/api/tickets').field('payload', JSON.stringify(payload)).attach(draftId, png, 'public-inline.png');
    expect(response.status).toBe(201);
    const stored = db.prepare('SELECT id FROM ticket_attachments WHERE ticket_id=?').get(response.body.id) as { id: string };
    await assertPublic(await share(response.body.id), stored.id);
  });

  it('shares ordinary explicitly uploaded ticket attachments', async () => {
    const ticketId = await createTicket();
    const uploaded = await post(`/api/attachments/ticket/${ticketId}?share=public`).attach('file', png, 'public-attachment.png');
    expect(uploaded.status).toBe(201);
    await assertPublic(await share(ticketId), uploaded.body.id);
  });

  it('keeps uploads from older clients without sharing intent private', async () => {
    const ticketId = await createTicket();
    const uploaded = await post(`/api/attachments/ticket/${ticketId}`).attach('file', png, 'unclassified-upload.png');
    expect(uploaded.status).toBe(201);
    await assertHidden(await share(ticketId), uploaded.body.id);
  });

  it.each(['inline=1&share=public', 'inline=other', 'share=other', 'share=public&share=public'])('rejects ambiguous sharing flags %s', async query => {
    const ticketId = await createTicket();
    expect((await post(`/api/attachments/ticket/${ticketId}?${query}`).attach('file', png, 'invalid-policy.png')).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS count FROM ticket_attachments WHERE ticket_id=?').get(ticketId)).toEqual({ count: 0 });
  });

  it('keeps an inline draft private until a public save and hides it again if referenced internally', async () => {
    const ticketId = await createTicket();
    const shareToken = await share(ticketId);
    const uploaded = await post(`/api/attachments/ticket/${ticketId}?inline=1`).attach('file', png, 'pending-inline.png');
    expect(uploaded.status).toBe(201);
    await assertHidden(shareToken, uploaded.body.id);
    const saved = await put(`/api/tickets/${ticketId}`).send({ description: image(uploaded.body.id) });
    expect(saved.status).toBe(200);
    await assertPublic(shareToken, uploaded.body.id);
    const madeInternal = await put(`/api/tickets/${ticketId}`).send({ notes: image(uploaded.body.id) });
    expect(madeInternal.status).toBe(200);
    await assertHidden(shareToken, uploaded.body.id);
  });

  it('does not let an internal comment expose an otherwise public file', async () => {
    const ticketId = await createTicket();
    const uploaded = await post(`/api/attachments/ticket/${ticketId}?share=public`).attach('file', png, 'private-comment.png');
    expect(uploaded.status).toBe(201);
    const shareToken = await share(ticketId);
    await assertPublic(shareToken, uploaded.body.id);
    const comment = await post(`/api/comments/ticket/${ticketId}`).send({ content: image(uploaded.body.id), isInternal: true });
    expect(comment.status).toBe(201);
    await assertHidden(shareToken, uploaded.body.id);
  });

  it('does not treat an unclassified historical comment as a public reference', async () => {
    const ticketId = await createTicket();
    const uploaded = await post(`/api/attachments/ticket/${ticketId}?inline=1`).attach('file', png, 'unknown-comment.png');
    expect(uploaded.status).toBe(201);
    db.prepare('INSERT INTO ticket_comments(id,ticket_id,user_id,content,is_internal) VALUES (?,?,?,?,NULL)')
      .run(randomUUID(), ticketId, userId, image(uploaded.body.id));
    await assertHidden(await share(ticketId), uploaded.body.id);
  });

  it('rejects cross-ticket download and revoked share tokens for permitted files', async () => {
    const ticketId = await createTicket();
    const uploaded = await post(`/api/attachments/ticket/${ticketId}?share=public`).attach('file', png, 'scoped.png');
    expect(uploaded.status).toBe(201);
    const shareToken = await share(ticketId);
    const otherToken = await share(await createTicket());
    expect((await anonymous(`/api/shares/public/file/${otherToken}/${uploaded.body.id}`)).status).toBe(404);
    const revoked = await agent.delete(`/api/shares/ticket/${ticketId}`).set('Authorization', `Bearer ${token}`).set('x-csrf-token', csrf);
    expect(revoked.status).toBe(200);
    expect((await anonymous(`/api/shares/public/file/${shareToken}/${uploaded.body.id}`)).status).toBe(404);
  });

  it.each([false, true])('classifies real parsed incoming mail attachments using trusted=%s', async (trusted) => {
    const ticketId = await createTicket();
    const email = `mail-${randomUUID()}@example.test`;
    if (trusted) {
      const contactId = randomUUID();
      db.prepare('INSERT INTO contacts(id,name,email) VALUES (?,?,?)').run(contactId, 'Known requester', email);
      db.prepare('UPDATE tickets SET requester_id=? WHERE id=?').run(contactId, ticketId);
    }
    const messageId = `<privacy-${randomUUID()}@example.test>`;
    const raw = Buffer.from([
      `From: Sender <${email}>`, 'To: helpdesk@example.test', `Subject: Re: Attachment privacy [#${ticketId.slice(0, 8)}]`,
      `Message-ID: ${messageId}`, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary=privacy-boundary', '',
      '--privacy-boundary', 'Content-Type: text/plain', '', 'Mail attachment privacy fixture',
      '--privacy-boundary', 'Content-Type: image/png', 'Content-Disposition: attachment; filename="mail-image.png"', 'Content-Transfer-Encoding: base64', '',
      png.toString('base64'), '--privacy-boundary--', '',
    ].join('\r\n'));
    expect(await mail.processEmail(raw, { host: 'imap.example.test', port: 993, secure: true, user: 'helpdesk@example.test', pollingInterval: 60, autoCreateContact: true, auth: { user: 'helpdesk@example.test', pass: 'fixture-only' } })).toBe('processed');
    const comment = db.prepare('SELECT is_internal FROM ticket_comments WHERE email_message_id=?').get(messageId) as { is_internal: number };
    expect(comment.is_internal).toBe(trusted ? 0 : 1);
    const stored = db.prepare('SELECT id FROM ticket_attachments WHERE ticket_id=?').get(ticketId) as { id: string };
    const shareToken = await share(ticketId);
    if (trusted) await assertPublic(shareToken, stored.id);
    else await assertHidden(shareToken, stored.id);
  });
});
