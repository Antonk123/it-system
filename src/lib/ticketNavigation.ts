/** Routes retained so saved links and each view's existing filters keep working. */
export const ticketViews = [
  { path: '/my-tickets', label: 'Mina' },
  { path: '/tickets', label: 'Alla' },
  { path: '/archive', label: 'Avslutade' },
];

export function isTicketSection(pathname: string): boolean {
  return pathname === '/my-tickets' || pathname === '/archive' ||
    pathname === '/tickets' || pathname.startsWith('/tickets/');
}
