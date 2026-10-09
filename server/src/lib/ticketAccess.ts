import { db } from '../db/connection.js';
import type { AuthUser, ApiKeyIdentity } from '../middleware/auth.js';
import { isEffectiveAdmin } from '../middleware/auth.js';

export interface TicketAccessRow {
  assigned_to: string | null;
  created_by: string | null;
}

// Request shape canAccessTicket needs: the session/API-key user plus (when the
// request is API-key-authenticated) the key's own scope — see isEffectiveAdmin.
export interface TicketAccessRequest {
  user?: Pick<AuthUser, 'id' | 'role'>;
  apiKey?: Pick<ApiKeyIdentity, 'permissions'>;
}

/**
 * Skrivbehörighet utifrån en redan hämtad ärenderad (undviker en extra query
 * per rad i bulk-flöden). Admin, tilldelad, skapare eller ett otilldelat
 * ärende (self-service-plock) får skriva. "Admin" avgörs av isEffectiveAdmin,
 * inte user.role, så en API-nyckel med snävare scope ärver inte admin-rättigheter.
 */
export function canWriteTicketRow(req: TicketAccessRequest, row: TicketAccessRow): boolean {
  if (!req.user) return false;
  if (isEffectiveAdmin(req)) return true;
  return row.assigned_to === null || row.assigned_to === req.user.id || row.created_by === req.user.id;
}

/**
 * Enda sanningskällan för "får den här användaren agera på ärendet (och dess
 * underresurser: kommentarer, bilagor, checklistor, länkar, delningar)?".
 *
 * Policy för det interna, single-tenant-verktyget:
 *  - LÄSA: varje inloggad användare får läsa alla ärenden och underresurser.
 *  - SKRIVA ({ write: true }): admin, tilldelad, skapare, eller när ärendet
 *    är otilldelat (self-service-plock).
 *
 * Returnerar false för ett ärende som inte finns (anroparen mappar till 404/403).
 */
export function canAccessTicket(
  req: TicketAccessRequest,
  ticketId: string,
  options: { write?: boolean } = {},
): boolean {
  if (!req.user) return false;
  const t = db.prepare(
    'SELECT assigned_to, created_by FROM tickets WHERE id = ?'
  ).get(ticketId) as TicketAccessRow | undefined;
  if (!t) return false;
  return options.write ? canWriteTicketRow(req, t) : true;
}
