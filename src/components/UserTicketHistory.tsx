import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { AlertCircle, Ticket } from 'lucide-react';
import { useTickets } from '@/hooks/useTickets';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { Button } from '@/components/ui/button';
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

const PAGE_SIZE = 100;

export const UserTicketHistory = ({ userId }: UserTicketHistoryProps) => {
  const [limit, setLimit] = useState(PAGE_SIZE);
  // Server-side filter på requester_id → laddar bara denna användares ärenden
  // (status: 'all' inkluderar stängda). Fler hämtas på begäran via "Visa fler".
  const { tickets, pagination, isLoading, isError, refetch } = useTickets({
    requester_id: userId,
    status: 'all',
    page: 1,
    limit,
  });

  const userTickets = tickets;
  const total = pagination?.total ?? userTickets.length;
  const hasMore = userTickets.length < total;

  const stats = useMemo(() => {
    const open = userTickets.filter((t) => t.status === 'open').length;
    const inProgress = userTickets.filter((t) => t.status === 'in-progress').length;
    const waiting = userTickets.filter((t) => t.status === 'waiting').length;
    const resolved = userTickets.filter((t) => t.status === 'resolved').length;
    const closed = userTickets.filter((t) => t.status === 'closed').length;
    return { open, inProgress, waiting, resolved, closed };
  }, [userTickets]);

  if (isLoading) {
    return (
      <div className="py-4 text-sm text-muted-foreground text-center">
        Laddar ärenden...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-4 flex flex-col items-center gap-2 text-muted-foreground" role="alert">
        <AlertCircle className="w-8 h-8" />
        <p className="text-sm">Kunde inte hämta ärenden</p>
        <Button variant="outline" size="sm" onClick={refetch}>Försök igen</Button>
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
      {/* Stats Summary — statusfördelningen visas bara när alla ärenden är laddade */}
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="font-medium">{total} Totalt</span>
        {!hasMore && (
          <>
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
          </>
        )}
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

      {hasMore && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>Visar {userTickets.length} av {total} ärenden</span>
          <Button variant="outline" size="sm" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
            Visa fler
          </Button>
        </div>
      )}
    </div>
  );
};
