import type { TicketRow } from '@/lib/api';
import type { Ticket, TicketStatus, TicketPriority } from '@/types/ticket';
import { parseServerDate } from '@/lib/date';

/**
 * Map a raw TicketRow (snake_case fields, string dates) from the API to the
 * frontend `Ticket` type. Single source of truth — used by the ticket list
 * hook (useTickets) and the ticket detail page so the shapes never diverge.
 */
export function mapTicketRow(t: TicketRow): Ticket {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status as TicketStatus,
    priority: t.priority as TicketPriority,
    category: t.category_id || undefined,
    requesterId: t.requester_id || '',
    createdAt: parseServerDate(t.created_at),
    updatedAt: parseServerDate(t.updated_at),
    resolvedAt: t.resolved_at ? parseServerDate(t.resolved_at) : undefined,
    closedAt: t.closed_at ? parseServerDate(t.closed_at) : undefined,
    notes: t.notes || undefined,
    solution: t.solution || undefined,
    templateId: t.template_id || undefined,
    tags: (t.tags || []) as Ticket['tags'],
    assignedTo: (t as any).assigned_to ?? null,
    assignedToName: (t as any).assigned_to_name ?? null,
    companyId: (t as any).company_id ?? null,
    companyName: (t as any).company_name ?? null,
    assigned_to: (t as any).assigned_to ?? null,
    assigned_to_name: (t as any).assigned_to_name ?? null,
    company_id: (t as any).company_id ?? null,
    company_name: (t as any).company_name ?? null,
    sla_response_deadline: t.sla_response_deadline ?? null,
    sla_resolution_deadline: t.sla_resolution_deadline ?? null,
    sla_paused_at: t.sla_paused_at ?? null,
    sla_paused_duration: t.sla_paused_duration ?? 0,
    sla_response_met: t.sla_response_met ?? null,
    sla_resolution_met: t.sla_resolution_met ?? null,
    ai_suggested_category_id: t.ai_suggested_category_id ?? null,
    ai_suggested_confidence: t.ai_suggested_confidence ?? null,
  } as Ticket;
}
