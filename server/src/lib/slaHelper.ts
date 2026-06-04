import { db } from '../db/connection.js';

interface SLAPolicy {
  response_time_minutes: number;
  resolution_time_minutes: number;
}

/**
 * Find the SLA policy for a given company + priority.
 * Falls back to default policy (company_id IS NULL) if no company-specific one exists.
 */
export function findSLAPolicy(companyId: string | null, priority: string): SLAPolicy | null {
  // Try company-specific first
  if (companyId) {
    const policy = db.prepare(
      'SELECT response_time_minutes, resolution_time_minutes FROM sla_policies WHERE company_id = ? AND priority = ?'
    ).get(companyId, priority) as SLAPolicy | undefined;
    if (policy) return policy;
  }

  // Fall back to default
  const defaultPolicy = db.prepare(
    'SELECT response_time_minutes, resolution_time_minutes FROM sla_policies WHERE company_id IS NULL AND priority = ?'
  ).get(priority) as SLAPolicy | undefined;

  return defaultPolicy || null;
}

/**
 * Calculate SLA deadlines for a ticket and set them.
 * Called when a ticket is created. Skippar om företaget har sla_disabled=1
 * (interna ärenden / företag utan avtal).
 */
export function applySLAToTicket(ticketId: string, companyId: string | null, priority: string): void {
  if (companyId) {
    const co = db.prepare('SELECT sla_disabled FROM companies WHERE id = ?').get(companyId) as { sla_disabled: number } | undefined;
    if (co?.sla_disabled) return;
  }

  const policy = findSLAPolicy(companyId, priority);
  if (!policy) return;

  const now = new Date();
  const responseDeadline = new Date(now.getTime() + policy.response_time_minutes * 60 * 1000);
  const resolutionDeadline = new Date(now.getTime() + policy.resolution_time_minutes * 60 * 1000);

  db.prepare(`
    UPDATE tickets SET
      sla_response_deadline = ?,
      sla_resolution_deadline = ?,
      sla_response_met = NULL,
      sla_resolution_met = NULL
    WHERE id = ?
  `).run(responseDeadline.toISOString(), resolutionDeadline.toISOString(), ticketId);
}

/**
 * Handle SLA pause/resume when ticket status changes.
 * Pause when status becomes 'waiting', resume otherwise.
 */
export function handleSLAStatusChange(ticketId: string, oldStatus: string, newStatus: string): void {
  const ticket = db.prepare(
    'SELECT sla_response_deadline, sla_resolution_deadline, sla_paused_at, sla_paused_duration FROM tickets WHERE id = ?'
  ).get(ticketId) as {
    sla_response_deadline: string | null;
    sla_resolution_deadline: string | null;
    sla_paused_at: string | null;
    sla_paused_duration: number;
  } | undefined;

  if (!ticket || !ticket.sla_response_deadline) return; // No SLA set

  const now = new Date();

  if (newStatus === 'waiting' && !ticket.sla_paused_at) {
    // Pause SLA clock
    db.prepare('UPDATE tickets SET sla_paused_at = ? WHERE id = ?').run(now.toISOString(), ticketId);
  } else if (oldStatus === 'waiting' && newStatus !== 'waiting' && ticket.sla_paused_at) {
    // Resume SLA clock — extend deadlines by paused duration
    const pausedAt = new Date(ticket.sla_paused_at);
    const pausedMinutes = Math.round((now.getTime() - pausedAt.getTime()) / 60000);
    const totalPaused = (ticket.sla_paused_duration || 0) + pausedMinutes;

    // Extend deadlines
    const responseDeadline = ticket.sla_response_deadline
      ? new Date(new Date(ticket.sla_response_deadline).getTime() + pausedMinutes * 60000).toISOString()
      : null;
    const resolutionDeadline = ticket.sla_resolution_deadline
      ? new Date(new Date(ticket.sla_resolution_deadline).getTime() + pausedMinutes * 60000).toISOString()
      : null;

    db.prepare(`
      UPDATE tickets SET
        sla_paused_at = NULL,
        sla_paused_duration = ?,
        sla_response_deadline = COALESCE(?, sla_response_deadline),
        sla_resolution_deadline = COALESCE(?, sla_resolution_deadline)
      WHERE id = ?
    `).run(totalPaused, responseDeadline, resolutionDeadline, ticketId);
  }

  // Mark SLA as met/breached on resolution/close
  if (newStatus === 'resolved' || newStatus === 'closed') {
    const current = db.prepare(
      'SELECT sla_response_deadline, sla_resolution_deadline FROM tickets WHERE id = ?'
    ).get(ticketId) as { sla_response_deadline: string | null; sla_resolution_deadline: string | null };

    if (current?.sla_resolution_deadline) {
      const met = now <= new Date(current.sla_resolution_deadline) ? 1 : 0;
      db.prepare('UPDATE tickets SET sla_resolution_met = ? WHERE id = ?').run(met, ticketId);
    }
  }

  // Mark response SLA as met on first non-open status change
  if (oldStatus === 'open' && newStatus !== 'open') {
    const current = db.prepare(
      'SELECT sla_response_deadline FROM tickets WHERE id = ? AND sla_response_met IS NULL'
    ).get(ticketId) as { sla_response_deadline: string | null } | undefined;

    if (current?.sla_response_deadline) {
      const met = now <= new Date(current.sla_response_deadline) ? 1 : 0;
      db.prepare('UPDATE tickets SET sla_response_met = ? WHERE id = ?').run(met, ticketId);
    }
  }
}

/**
 * Recalculate SLA deadlines when a ticket's priority changes.
 * Looks up the ticket's company_id and re-applies the SLA policy for the new priority.
 */
export function recalculateSLAOnPriorityChange(ticketId: string, newPriority: string): void {
  const ticket = db.prepare('SELECT company_id FROM tickets WHERE id = ?').get(ticketId) as { company_id: string | null } | undefined;
  if (!ticket) return;
  applySLAToTicket(ticketId, ticket.company_id, newPriority);
}
