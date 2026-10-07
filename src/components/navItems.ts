import { LayoutDashboard, Ticket, Users, Settings, BarChart3, BookOpen } from 'lucide-react';
import { isTicketSection } from '@/lib/ticketNavigation';

export const navItems = [{
  path: '/',
  icon: LayoutDashboard,
  label: 'Översikt'
}, {
  path: '/tickets',
  icon: Ticket,
  label: 'Ärenden'
}, {
  path: '/reports',
  icon: BarChart3,
  label: 'Rapporter'
}, {
  path: '/users',
  icon: Users,
  label: 'Kontakter'
}, {
  path: '/kb',
  icon: BookOpen,
  label: 'Kunskapsbas'
}, {
  path: '/settings',
  icon: Settings,
  label: 'Inställningar'
}];

/** Delad aktiv-logik för sidomenyn och den inbäddade flikraden. */
export function isNavItemActive(path: string, pathname: string): boolean {
  if (path === '/tickets') return isTicketSection(pathname);
  if (path === '/settings') return pathname.startsWith('/settings');
  if (path === '/users') return pathname.startsWith('/users') || pathname.startsWith('/companies');
  if (path === '/') return pathname === '/';
  return pathname.startsWith(path);
}
