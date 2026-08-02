import { randomBytes, randomUUID } from 'crypto';
import type { Database as DatabaseType } from 'better-sqlite3';

/**
 * Delad kärna för ticket_shares — mynta + slå upp aktiva delningstokens.
 *
 * Publika share-routes (shares.ts) och e-post-inflödet (emailInbound.ts) MÅSTE
 * gå via de här funktionerna så att expiry-kontrollen inte kan divergera
 * mellan de två anropsställena. Fail-closed: en share räknas bara som aktiv
 * om expires_at > datetime('now') (SQL-jämförelse — NULL faller alltid bort).
 */

export const SHARE_DEFAULT_EXPIRY_DAYS = 30;

export interface ActiveShareRow {
  id: string;
  ticket_id: string;
  share_token: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface MintedShare {
  id: string;
  shareToken: string;
  expiresAt: string;
}

/**
 * Myntar en ny share-token för en ticket och infogar raden med beräknad
 * expiry. Anroparen ansvarar för att ev. befintlig rad för samma ticket_id
 * redan är borttagen (unik-constraint finns bara på share_token, inte
 * ticket_id) — annars kan flera rader ackumuleras för samma ärende.
 *
 * expiresInDays MÅSTE vara ett redan validerat heltal (1-365) — modifierar-
 * strängen byggs av detta värde men skickas som SQL-parameter, aldrig som
 * klient-styrd rå sträng.
 */
export function mintShareToken(
  db: DatabaseType,
  ticketId: string,
  createdBy: string | null,
  expiresInDays: number = SHARE_DEFAULT_EXPIRY_DAYS,
): MintedShare {
  const id = randomUUID();
  // 16 bytes = 128-bit entropi (32 hex-tecken).
  const shareToken = randomBytes(16).toString('hex');
  const modifier = `+${expiresInDays} days`;

  db.prepare(
    `INSERT INTO ticket_shares (id, ticket_id, share_token, created_by, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', ?))`
  ).run(id, ticketId, shareToken, createdBy, modifier);

  const row = db.prepare('SELECT expires_at FROM ticket_shares WHERE id = ?').get(id) as { expires_at: string };

  return { id, shareToken, expiresAt: row.expires_at };
}

/**
 * Slår upp en share via token — returnerar undefined om token saknas ELLER
 * om den finns men har gått ut (fail-closed; en NULL expires_at, t.ex. en
 * legacy-anomali, faller också bort eftersom NULL > datetime('now') aldrig
 * är sant i SQLite).
 */
export function getActiveShareByToken(db: DatabaseType, token: string): ActiveShareRow | undefined {
  return db.prepare(
    `SELECT id, ticket_id, share_token, created_by, created_at, expires_at
     FROM ticket_shares
     WHERE share_token = ? AND expires_at > datetime('now')`
  ).get(token) as ActiveShareRow | undefined;
}
