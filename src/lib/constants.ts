import { TicketStatus, TicketPriority } from '@/types/ticket';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  'low': 'Låg',
  'medium': 'Medium',
  'high': 'Hög',
  'critical': 'Kritisk',
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  sent: 'Skickad',
  paid: 'Betald',
  cancelled: 'Makulerad',
};
