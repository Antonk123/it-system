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
  // Server-side filter på requester_id → laddar bara denna användares ärenden
  // (status: 'all' inkluderar stängda; högt limit för korrekt statusräkning).
  const { tickets, isLoading } = useTickets({ requester_id: userId, status: 'all', limit: 1000 });

  const userTickets = tickets;

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
        <span className="text-[hsl(var(--status-open))]">{stats.open} Öppna</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-[hsl(var(--status-in-progress))]">{stats.inProgress} Pågående</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-[hsl(var(--status-waiting))]">{stats.waiting} Väntar</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-[hsl(var(--status-resolved))]">{stats.resolved} Lösta</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-[hsl(var(--status-closed))]">{stats.closed} Stängda</span>
      </div>

      {/* Ticket Table */}
      <div className="rounded-2xl overflow-hidden border border-border/50 backdrop-blur-xs bg-card/30">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/50 bg-background/40 backdrop-blur-xs">
              <TableHead className="font-semibold text-foreground/90">Titel</TableHead>
              <TableHead className="font-semibold text-foreground/90">Status</TableHead>
              <TableHead className="font-semibold text-foreground/90">Prioritet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {userTickets.map((ticket) => (
              <TableRow
                key={ticket.id}
                className="cursor-pointer transition-all duration-200 hover:bg-linear-to-r hover:from-primary/5 hover:to-accent/5 border-b border-border/30 last:border-0 group"
              >
                <TableCell>
                  <Link
                    to={`/tickets/${ticket.id}`}
                    className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200"
                  >
                    {ticket.title}
                  </Link>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {format(ticket.createdAt, 'd MMM yyyy', { locale: sv })}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={ticket.status} />
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={ticket.priority} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
