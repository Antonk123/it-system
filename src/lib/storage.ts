import { Ticket, User } from '@/types/ticket';

const TICKETS_KEY = 'it_tickets';
const USERS_KEY = 'it_users';

export const getTickets = (): Ticket[] => {
  const data = localStorage.getItem(TICKETS_KEY);
  if (!data) return [];
  return JSON.parse(data).map((t: any) => ({
    ...t,
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
    resolvedAt: t.resolvedAt ? new Date(t.resolvedAt) : undefined,
    closedAt: t.closedAt ? new Date(t.closedAt) : undefined,
  }));
};

export const saveTickets = (tickets: Ticket[]) => {
  localStorage.setItem(TICKETS_KEY, JSON.stringify(tickets));
};

export const getUsers = (): User[] => {
  const data = localStorage.getItem(USERS_KEY);
  if (!data) return [];
  return JSON.parse(data).map((u: any) => ({
    ...u,
    createdAt: new Date(u.createdAt),
  }));
};

export const saveUsers = (users: User[]) => {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
};

export const generateId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};
