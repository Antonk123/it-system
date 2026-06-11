import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { logger } from './logger.js';

/**
 * Logs a sensitive operation to the audit_log table.
 *
 * Keep calls lightweight — this is fire-and-forget within the same
 * request. If the insert fails it logs to stderr but does NOT throw,
 * so it never breaks the primary operation.
 */
export function logAudit(
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string | string[] | null,
  details: string | null,
  ipAddress: string | string[] | undefined,
): void {
  const resolvedEntityId = Array.isArray(entityId) ? entityId[0] : entityId;
  const resolvedIp = Array.isArray(ipAddress) ? ipAddress[0] : ipAddress;
  try {
    db.prepare(
      `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), userId, action, entityType, resolvedEntityId, details, resolvedIp ?? null);
  } catch (err) {
    logger.error('Audit log insert failed (non-fatal)', { error: String(err) });
  }
}
