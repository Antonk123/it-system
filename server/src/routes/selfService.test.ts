import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { rmSync } from "node:fs";
import jwt from "jsonwebtoken";
const { path } = vi.hoisted(() => {
  const path = `/tmp/it-support-test-${process.pid}-${Date.now()}.sqlite`;
  process.env.DB_PATH = path;
  process.env.UPLOAD_DIR = path + "-uploads";
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "staff-test-secret-".repeat(4);
  process.env.CSRF_SECRET = "csrf-test-secret-".repeat(4);
  process.env.NAVET_SUPPORT_SECRET = "support-test-secret-".repeat(4);
  process.env.NAVET_SUPPORT_ISSUER = "https://navet-dev.example.test";
  return { path };
});
vi.mock("../lib/email.js", () => ({
  sendTicketCreatedEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/ticketNotifications.js", () => ({
  notifyAgentOfCustomerReply: vi.fn().mockResolvedValue(undefined),
  notifyStaffOfNewTicket: vi.fn().mockResolvedValue(undefined),
}));
import { notifyAgentOfCustomerReply } from "../lib/ticketNotifications.js";
import request from "supertest";
import { createApp } from "../app.js";
import { initializeDatabase, db, closeDatabase } from "../db/connection.js";
import { getSystemUserId } from "../lib/systemUser.js";
let app: ReturnType<typeof createApp>, id: string;
const token = (sub = "alice", claims = {}) =>
  jwt.sign(
    {
      sub,
      name: "Alice",
      email: "alice@example.test",
      scope: "own-tickets",
      ...claims,
    },
    process.env.NAVET_SUPPORT_SECRET!,
    {
      algorithm: "HS256",
      issuer: process.env.NAVET_SUPPORT_ISSUER,
      audience: "it-ticket:self-service",
      expiresIn: 120,
    },
  );
async function client(sub = "alice") {
  const agent = request.agent(app);
  const t = token(sub);
  const csrf = await agent.get("/api/csrf-token");
  return { agent, t, csrf: csrf.body.csrfToken };
}
beforeAll(() => {
  initializeDatabase();
  app = createApp();
});
afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm", "-uploads"])
    rmSync(path + suffix, { recursive: true, force: true });
});
describe("requester portal boundary", () => {
  it("rejects missing, wrong-audience and expired identity", async () => {
    for (const t of [
      "",
      jwt.sign({ sub: "alice" }, process.env.NAVET_SUPPORT_SECRET!, {
        audience: "staff",
      }),
      token("alice", { iat: 1 }),
    ])
      expect(
        (
          await request(app)
            .get("/api/self-service/tickets")
            .set("X-Navet-Support", t)
        ).status,
      ).toBe(401);
  });
  it("creates ownership from verified identity, not submitted name/email", async () => {
    const c = await client();
    const r = await c.agent
      .post("/api/self-service/tickets")
      .set("X-Navet-Support", c.t)
      .set("X-CSRF-Token", c.csrf)
      .set("Idempotency-Key", "test-create-alice-0001")
      .send({
        name: "Mallory",
        email: "mallory@example.test",
        title: "Printer",
        description: "Does not print",
      });
    expect(r.status).toBe(201);
    id = r.body.ticketId;
    expect(id).toBeTruthy();
    expect(
      db
        .prepare("SELECT subject FROM support_ticket_owners WHERE ticket_id=?")
        .get(id),
    ).toEqual({ subject: "alice" });
    expect(
      db
        .prepare(
          "SELECT c.email FROM contacts c JOIN tickets t ON t.requester_id=c.id WHERE t.id=?",
        )
        .get(id),
    ).toEqual({ email: "alice@example.test" });
  });
  it("lists only owned tickets, never grants by matching email, and cannot use portal identity for staff API", async () => {
    expect(
      (
        await request(app)
          .get("/api/self-service/tickets")
          .set("X-Navet-Support", token())
      ).body.data.map((t: { id: string }) => t.id),
    ).toEqual([id]);
    expect(
      (
        await request(app)
          .get("/api/self-service/tickets")
          .set("X-Navet-Support", token("bob"))
      ).body.data,
    ).toEqual([]);
    expect(
      (
        await request(app)
          .get(`/api/self-service/tickets/${id}`)
          .set("X-Navet-Support", token("bob"))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get("/api/tickets")
          .set("Authorization", "Bearer " + token())
      ).status,
    ).toBe(401);
  });
  it("excludes internal/deleted comments, notes, solution and staff files", async () => {
    db.prepare(
      "UPDATE tickets SET notes='SECRET NOTES',solution='SECRET SOLUTION' WHERE id=?",
    ).run(id);
    const insert = db.prepare(
      "INSERT INTO ticket_comments(id,ticket_id,user_id,content,is_internal,deleted_at) VALUES(?,?,?,?,?,?)",
    );
    insert.run(
      "public-comment",
      id,
      getSystemUserId(),
      "Public reply",
      0,
      null,
    );
    insert.run(
      "private-comment",
      id,
      getSystemUserId(),
      "SECRET COMMENT",
      1,
      null,
    );
    insert.run(
      "deleted-comment",
      id,
      getSystemUserId(),
      "SECRET DELETED",
      0,
      "2026-01-01",
    );
    const r = await request(app)
      .get(`/api/self-service/tickets/${id}`)
      .set("X-Navet-Support", token());
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
    expect(r.body.comments).toHaveLength(1);
    expect(r.body.attachments).toEqual([]);
  });
  it("accepts own public reply once; denies other users and closed tickets", async () => {
    vi.mocked(notifyAgentOfCustomerReply).mockClear();
    const c = await client();
    const send = () =>
      c.agent
        .post(`/api/self-service/tickets/${id}/replies`)
        .set("X-Navet-Support", c.t)
        .set("X-CSRF-Token", c.csrf)
        .set("Idempotency-Key", "reply-alice-0000001")
        .send({ content: "My answer", isInternal: true });
    const r = await send();
    expect(r.status).toBe(201);
    expect((await send()).body.id).toBe(r.body.id);
    expect(notifyAgentOfCustomerReply).toHaveBeenCalledExactlyOnceWith(id, "My answer", "navet");
    expect(
      db
        .prepare("SELECT is_internal FROM ticket_comments WHERE id=?")
        .get(r.body.id),
    ).toEqual({ is_internal: 0 });
    expect(
      (
        await c.agent
          .post(`/api/self-service/tickets/${id}/replies`)
          .set("X-Navet-Support", token("bob"))
          .set("X-CSRF-Token", c.csrf)
          .send({ content: "attack" })
      ).status,
    ).toBe(404);
    db.prepare("UPDATE tickets SET status='closed' WHERE id=?").run(id);
    expect(
      (
        await c.agent
          .post(`/api/self-service/tickets/${id}/replies`)
          .set("X-Navet-Support", c.t)
          .set("X-CSRF-Token", c.csrf)
          .set("Idempotency-Key", "reply-alice-0000002")
          .send({ content: "another" })
      ).status,
    ).toBe(409);
    expect(notifyAgentOfCustomerReply).toHaveBeenCalledTimes(1);
  });
  it('scopes uploads, downloads and replay to the authenticated owner', async () => {
    const c = await client();
    const submit = (identity: string) => c.agent.post('/api/self-service/tickets')
      .set('X-Navet-Support', token(identity)).set('X-CSRF-Token', c.csrf)
      .set('Idempotency-Key', 'same-key-distinct-owners')
      .field('payload', JSON.stringify({name:'Ignored',email:'ignored@example.test',title:'File case',description:'See file'}))
      .attach('attachment-0', Buffer.from('Local synthetic attachment'), {filename:'example.txt',contentType:'text/plain'});
    const a=await submit('alice'), replay=await submit('alice'), b=await submit('bob');
    expect(a.status).toBe(201); expect(replay.body.ticketId).toBe(a.body.ticketId); expect(b.body.ticketId).not.toBe(a.body.ticketId);
    expect(a.body.notes).toBeUndefined();
    const detail=await c.agent.get('/api/self-service/tickets/'+a.body.ticketId).set('X-Navet-Support',c.t);
    const file=detail.body.attachments[0];expect(file.file_name).toBe('example.txt');
    const url='/api/self-service/tickets/'+a.body.ticketId+'/files/'+file.id;
    const own=await c.agent.get(url).set('X-Navet-Support',c.t);
    expect(own.status).toBe(200);expect(own.headers['content-disposition']).toContain('attachment');
    expect((await c.agent.get(url).set('X-Navet-Support',token('bob'))).status).toBe(404);
    vi.mocked(notifyAgentOfCustomerReply).mockRejectedValueOnce(new Error('Synthetic notification outage'));
    const reply=await c.agent.post('/api/self-service/tickets/'+a.body.ticketId+'/replies')
      .set('X-Navet-Support',c.t).set('X-CSRF-Token',c.csrf).set('Idempotency-Key','reply-file-idempotency')
      .field('payload',JSON.stringify({content:'Another file'}))
      .attach('attachment-0',Buffer.from('More synthetic text'),{filename:'reply.txt',contentType:'text/plain'});
    expect(reply.status).toBe(201);
    const after=await c.agent.get('/api/self-service/tickets/'+a.body.ticketId).set('X-Navet-Support',c.t);
    expect(after.body.attachments).toHaveLength(2);
    expect(after.body.comments[0].author).toBe('Du');
  });

});
