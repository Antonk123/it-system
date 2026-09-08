import type { TicketStatus } from '@/types/ticket';

export const ticketViews = [
  { path: '/tickets', id: 'active', label: 'Aktiva', statuses: ['open', 'in-progress', 'waiting'] },
  { path: '/tickets', id: 'open', label: 'Öppna', statuses: ['open'] },
  { path: '/tickets', id: 'in-progress', label: 'Pågående', statuses: ['in-progress'] },
  { path: '/tickets', id: 'waiting', label: 'Väntar', statuses: ['waiting'] },
  { path: '/archive', id: 'completed', label: 'Avslutade', statuses: ['resolved', 'closed'] },
] as const;

/** One visible tab owns the status scope; retired presets never affect the query. */
export function getTicketScope(pathname: string, params: URLSearchParams) {
  const status = params.get('status');
  const completed = pathname === '/archive' || (status?.split(',').every(s => s === 'resolved' || s === 'closed') ?? false);
  const view = completed ? ticketViews[4] : ticketViews.find(v => v.id === status) || ticketViews[0];
  return { statuses: [...view.statuses] as TicketStatus[], mine: pathname === '/my-tickets' || params.get('mine') === '1', tab: view.id };
}

export function ticketTabLink(tab: typeof ticketViews[number], pathname: string, search: string) {
  const params = new URLSearchParams(search);
  const scope = getTicketScope(pathname, params);
  for (const key of ['tags', 'tagMode', 'page', 'status']) params.delete(key);
  if (params.get('sortBy') === 'tags') params.delete('sortBy');
  if (scope.mine) params.set('mine', '1');
  if (tab.id !== 'active' && tab.id !== 'completed') params.set('status', tab.id);
  if (tab.id === 'completed') params.set('dateField', 'updated_at');
  const query = params.toString();
  return `${tab.path}${query ? `?${query}` : ''}`;
}

export function isTicketSection(pathname: string): boolean {
  return pathname === '/my-tickets' || pathname === '/archive' ||
    pathname === '/tickets' || pathname.startsWith('/tickets/');
}
