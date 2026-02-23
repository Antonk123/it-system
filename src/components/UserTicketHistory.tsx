import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { Ticket } from 'lucide-react';
import { useTickets } from '@/hooks/useTickets';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface UserTicketHistoryProps {
  userId: string;
}

export const UserTicketHistory = ({ userId }: UserTicketHistoryProps) => {
  const { tickets, isLoading } = useTickets();

  const userTickets = useMemo(() => {
    return tickets.filter((t) => t.requesterId === userId);
  }, [tickets, userId]);

  const stats = useMemo(() => {
    const open = userTickets.filter((t) => t.status === 'open').length;
    const inProgress = userTickets.filter((t) => t.status === 'in-progress').length;
    const waiting = userTickets.filter((t) => t.status === 'waiting').length;
    const resolved = userTickets.filter((t) => t.status === 'resolved').length;
    const closed = userTickets.filter((t) => t.status === 'closed').length;
    return { total: userTickets.length, open, inProgress, waiting, resolved, closed };
  }, [userTickets]);

  if (isLoading) {
    return (
      <div className="py-4 text-sm text-muted-foreground text-center">
        Laddar ärenden...
      </div>
    );
  }

  if (userTickets.length === 0) {
    return (
      <div className="py-4 flex flex-col items-center text-muted-foreground">
        <Ticket className="w-8 h-8 mb-2" />
        <p className="text-sm">Inga ärenden kopplade till denna användare</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Summary */}
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="font-medium">{stats.total} Totalt</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-blue-600">{stats.open} Öppna</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-yellow-600">{stats.inProgress} Pågående</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-teal-600">{stats.waiting} Väntar</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-green-600">{stats.resolved} Lösta</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-gray-600">{stats.closed} Stängda</span>
      </div>

      {/* Ticket Table */}
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Titel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Prioritet</TableHead>
              <TableHead>Skapad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {userTickets.map((ticket) => (
              <TableRow key={ticket.id}>
                <TableCell>
                  <Link
                    to={`/tickets/${ticket.id}`}
                    className="text-primary hover:underline font-medium"
                  >
                    {ticket.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={ticket.status} />
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={ticket.priority} />
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {format(ticket.createdAt, 'd MMM yyyy', { locale: sv })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
