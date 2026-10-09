import type { Database } from 'better-sqlite3';
import { cleanupOrphanKbImages } from './kbImages.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 365;

function auditLogRetentionDays(): number {
  const parsed = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUDIT_LOG_RETENTION_DAYS;
}

/** Rensa data som annars växer obegränsat. Anropas från det nattliga cron-jobbet. */
export function runRetention(db: Database): {
  webhookDeliveries: number;
  passwordResetTokens: number;
  ticketShares: number;
  auditLog: number;
  orphanKbImages: number;
} {
  const ago = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

  const rows = db.transaction(() => ({
    webhookDeliveries: db
      .prepare('DELETE FROM webhook_deliveries WHERE created_at < ?')
      .run(ago(30)).changes,
    passwordResetTokens: db
      .prepare(
        `DELETE FROM password_reset_tokens
         WHERE julianday(used_at) < julianday(?)
            OR julianday(expires_at) < julianday(?)`
      )
      .run(ago(1), ago(1)).changes,
    ticketShares: db
      .prepare('DELETE FROM ticket_shares WHERE expires_at IS NOT NULL AND expires_at < ?')
      .run(ago(30)).changes,
    auditLog: db
      .prepare('DELETE FROM audit_log WHERE created_at < ?')
      .run(ago(auditLogRetentionDays())).changes,
  }))();

  // Filsystemet ligger utanför transaktionen; körs efter att raderna är borta.
  return { ...rows, orphanKbImages: cleanupOrphanKbImages(db) };
}
