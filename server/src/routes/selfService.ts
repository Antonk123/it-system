import type { AuthRequest } from "../middleware/auth.js";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { resolve, basename } from "node:path";
import { convert } from "html-to-text";
import { db } from "../db/connection.js";
import {
  supportIdentity,
  type SupportIdentity,
} from "../lib/supportIdentity.js";
import {
  ticketImageSubmission,
  commitTicketImages,
} from "../lib/ticketImages.js";
import { submitPublicTicket } from "./public.js";
import { getSystemUserId } from "../lib/systemUser.js";
import { sanitizeRichText } from "../lib/htmlSanitizer.js";
import {
  createRateLimiter,
  publicWriteRateLimiter,
} from "../middleware/rateLimit.js";
import { notifyAgentOfCustomerReply } from "../lib/ticketNotifications.js";
import { logger } from "../lib/logger.js";
import { supportUpdates } from "../lib/supportUpdates.js";
const router = Router();
router.use(supportIdentity, createRateLimiter(60000, 120));
const text = (html: string) =>
  convert(html || "", {
    wordwrap: false,
    selectors: [{ selector: "img", format: "skip" }],
  });
function owns(identity: SupportIdentity, ticket: string) {
  return db
    .prepare(
      "SELECT 1 FROM support_ticket_owners WHERE issuer = ? AND subject = ? AND ticket_id = ?",
    )
    .get(identity.issuer, identity.subject, ticket);
}
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
router.get("/updates", (_req, res) => {
  const updates = supportUpdates(res.locals.supportIdentity);
  res.json({ count: updates.filter(t => t.unread).length });
});
router.post("/tickets/:id/read", (req, res) => {
  const identity: SupportIdentity = res.locals.supportIdentity;
  const result = db.transaction(() => {
    const current = supportUpdates(identity, req.params.id)[0];
    if (!current) return 404;
    if (typeof req.body?.revision !== "string" || req.body.revision !== current.revision) return 409;
    db.prepare("UPDATE support_ticket_owners SET read_revision=? WHERE ticket_id=? AND issuer=? AND subject=?")
      .run(current.revision, current.id, identity.issuer, identity.subject);
    return 204;
  })();
  if (result === 204) return res.status(204).end();
  res.status(result).json({ error: result === 404 ? "Ärendet finns inte." : "Ärendet har uppdaterats. Öppna det igen för att läsa det senaste." });
});
router.get("/tickets", (req, res) => {
  const identity: SupportIdentity = res.locals.supportIdentity;
  const page = Math.max(
    1,
    Math.min(100000, Math.floor(Number(req.query.page)) || 1),
  );
  const closed = req.query.state === "closed";
  const predicate = closed ? "t.status = 'closed'" : "t.status != 'closed'";
  const data = db
    .prepare(
      `SELECT t.id, t.title, t.status, t.created_at, t.updated_at FROM tickets t JOIN support_ticket_owners o ON o.ticket_id=t.id WHERE o.issuer=? AND o.subject=? AND ${predicate} ORDER BY t.updated_at DESC, t.id LIMIT 30 OFFSET ?`,
    )
    .all(identity.issuer, identity.subject, (page - 1) * 30);
  const count = db
    .prepare(
      `SELECT COUNT(*) AS total FROM tickets t JOIN support_ticket_owners o ON o.ticket_id=t.id WHERE o.issuer=? AND o.subject=? AND ${predicate}`,
    )
    .get(identity.issuer, identity.subject) as {
    total: number;
  };
  const updates = new Map(supportUpdates(identity).map(t => [t.id, t.unread]));
  res.json({ data: (data as {id: string}[]).map(t => ({...t, unread: updates.get(t.id) || false})), page, total: count.total });
});
router.get("/tickets/:id", (req, res) => {
  const identity: SupportIdentity = res.locals.supportIdentity;
  if (!owns(identity, req.params.id))
    return res.status(404).json({ error: "Ärendet finns inte." });
  const ticket = db
    .prepare(
      "SELECT id, title, description, status, created_at, updated_at FROM tickets WHERE id=?",
    )
    .get(req.params.id) as {
    description: string;
  };
  const comments = db
    .prepare(
      `SELECT c.id, c.content, c.created_at, CASE WHEN s.comment_id IS NOT NULL THEN 'Du' WHEN c.email_from_address IS NOT NULL THEN COALESCE(c.email_from_name, 'E-postsvar') ELSE 'IT-support' END AS author FROM ticket_comments c LEFT JOIN support_ticket_replies s ON s.comment_id=c.id WHERE c.ticket_id=? AND c.is_internal=0 AND c.deleted_at IS NULL ORDER BY c.created_at, c.id`,
    )
    .all(req.params.id) as {
    content: string;
  }[];
  const attachments = db
    .prepare(
      "SELECT a.id, a.file_name, a.file_size FROM ticket_attachments a JOIN support_ticket_files f ON f.attachment_id=a.id WHERE a.ticket_id=? ORDER BY a.created_at, a.id",
    )
    .all(req.params.id);
  res.json({
    ...ticket,
    revision: supportUpdates(identity, req.params.id)[0].revision,
    description: text(ticket.description),
    comments: comments.map((c) => ({ ...c, content: text(c.content) })),
    attachments,
  });
});
router.get("/tickets/:id/files/:fileId", (req, res) => {
  if (!owns(res.locals.supportIdentity, req.params.id))
    return res.status(404).json({ error: "Filen finns inte." });
  const file = db
    .prepare(
      "SELECT a.file_path, a.file_name FROM ticket_attachments a JOIN support_ticket_files f ON f.attachment_id=a.id WHERE a.ticket_id=? AND a.id=?",
    )
    .get(req.params.id, req.params.fileId) as
    | {
        file_path: string;
        file_name: string;
      }
    | undefined;
  if (!file || basename(file.file_path) !== file.file_path)
    return res.status(404).json({ error: "Filen finns inte." });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.download(
    resolve(
      process.env.UPLOAD_DIR ||
        resolve(import.meta.dirname, "../../data/uploads"),
      file.file_path,
    ),
    file.file_name,
  );
});
router.post(
  "/tickets/:id/replies",
  (req: AuthRequest, res, next) => {
    if (!owns(res.locals.supportIdentity, req.params.id))
      return res.status(404).json({ error: "Ärendet finns inte." });
    next();
  },
  ticketImageSubmission,
  (req: AuthRequest, res) => {
    const identity: SupportIdentity = res.locals.supportIdentity;
    if (!owns(identity, req.params.id))
      return res.status(404).json({ error: "Ärendet finns inte." });
    const key = req.get("Idempotency-Key");
    if (
      !key ||
      !/^[\w-]{16,128}$/.test(key) ||
      typeof req.body.content !== "string" ||
      !req.body.content.trim() ||
      req.body.content.length > 20000
    )
      return res
        .status(400)
        .json({ error: "Skriv ett svar (högst 20 000 tecken)." });
    const content = sanitizeRichText(req.body.content);
    if (!text(content).trim())
      return res.status(400).json({ error: "Skriv ett svar." });
    const existing = db
      .prepare(
        "SELECT comment_id, content FROM support_ticket_replies WHERE ticket_id=? AND request_key=?",
      )
      .get(req.params.id, key) as
      | {
          comment_id: string;
          content: string;
        }
      | undefined;
    if (existing)
      return existing.content === content
        ? res.json({ id: existing.comment_id })
        : res
            .status(409)
            .json({ error: "Svaret har redan skickats med annat innehåll." });
    const ticket = db
      .prepare("SELECT status FROM tickets WHERE id=?")
      .get(req.params.id) as {
      status: string;
    };
    if (ticket.status === "closed")
      return res
        .status(409)
        .json({
          error:
            "Ärendet är avslutat. Skicka en ny felanmälan om du behöver mer hjälp.",
        });
    const id = randomUUID(),
      now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        "INSERT INTO ticket_comments (id,ticket_id,user_id,content,is_internal,created_at,updated_at) VALUES (?,?,?,?,0,?,?)",
      ).run(id, req.params.id, getSystemUserId(), content, now, now);
      db.prepare(
        "INSERT INTO support_ticket_replies (comment_id,ticket_id,request_key,content,author_name) VALUES (?,?,?,?,?)",
      ).run(id, req.params.id, key, content, identity.name);
      commitTicketImages(res, req.params.id);
      for (const file of res.locals.ticketSubmission.files)
        db.prepare(
          "INSERT INTO support_ticket_files (attachment_id) VALUES (?)",
        ).run(file.id);
      db.prepare("UPDATE tickets SET updated_at=? WHERE id=?").run(
        now,
        req.params.id,
      );
    })();
    // Only newly committed replies notify staff. Both retry paths return above.
    void notifyAgentOfCustomerReply(req.params.id, content, "navet").catch(
      (error) => logger.error("Navet reply notification failed", { error: String(error) }),
    );
    res.status(201).json({ id });
  },
);
// Same creation validation, file handling, templates and transaction as the existing form.
router.post(
  "/tickets",
  publicWriteRateLimiter,
  ticketImageSubmission,
  submitPublicTicket,
);
export default router;
