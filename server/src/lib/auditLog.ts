import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { logger } from './logger.js';

/**
 * Logs a sensitive operation to the audit_log table.
 *
 * Keep calls lightweight — this is fire-and-forget within the same
 * request. If the insert fails it logs to stderr but does NOT throw,
 * so it never breaks the primary operation.
 *
 * apiKeyId (valfri, sist): sätts när åtgärden utfördes via API-nyckel i
 * stället för en inloggad session (req.apiKey?.id från middleware/auth.ts),
 * så att audit-raden går att spåra tillbaka till exakt vilken nyckel som
 * utförde den. NULL/utelämnad = vanlig sessionsinloggning.
 */
export function logAudit(
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string | string[] | null,
  details: string | null,
  ipAddress: string | string[] | undefined,
  apiKeyId?: string | null,
): void {
  const resolvedEntityId = Array.isArray(entityId) ? entityId[0] : entityId;
  const resolvedIp = Array.isArray(ipAddress) ? ipAddress[0] : ipAddress;
  try {
    db.prepare(
      `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details, ip_address, api_key_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), userId, action, entityType, resolvedEntityId, details, resolvedIp ?? null, apiKeyId ?? null);
  } catch (err) {
    logger.error('Audit log insert failed (non-fatal)', { error: String(err) });
  }
}
