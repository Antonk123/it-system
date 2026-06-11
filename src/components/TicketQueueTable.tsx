import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Ticket } from '@/types/ticket';

interface TicketQueueTableProps {
  tickets: Ticket[];
  isLoading: boolean;
  getUserName?: (id: string) => string | undefined;
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-[hsl(var(--status-open))]/12 text-[hsl(var(--status-open))] border-[hsl(var(--status-open))]/30',
  'in-progress': 'bg-[hsl(var(--status-in-progress))]/12 text-[hsl(var(--status-in-progress))] border-[hsl(var(--status-in-progress))]/30',
  waiting: 'bg-[hsl(var(--status-waiting))]/12 text-[hsl(var(--status-waiting))] border-[hsl(var(--status-waiting))]/30',
  resolved: 'bg-[hsl(var(--status-resolved))]/12 text-[hsl(var(--status-resolved))] border-[hsl(var(--status-resolved))]/30',
  closed: 'bg-[hsl(var(--status-closed))]/12 text-[hsl(var(--status-closed))] border-[hsl(var(--status-closed))]/30',
};

const STATUS_DOT: Record<string, string> = {
  open: 'bg-[hsl(var(--status-open))] shadow-[0_0_8px_hsl(var(--status-open))]',
  'in-progress': 'bg-[hsl(var(--status-in-progress))] shadow-[0_0_8px_hsl(var(--status-in-progress))] animate-pulse',
  waiting: 'bg-[hsl(var(--status-waiting))]',
  resolved: 'bg-[hsl(var(--status-resolved))]',
  closed: 'bg-[hsl(var(--status-closed))]',
};

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-[hsl(var(--priority-critical))]/14 text-[hsl(var(--priority-critical))] border-[hsl(var(--priority-critical))]/35',
  high: 'bg-[hsl(var(--priority-high))]/14 text-[hsl(var(--priority-high))] border-[hsl(var(--priority-high))]/35',
  medium: 'bg-[hsl(var(--priority-medium))]/14 text-[hsl(var(--priority-medium))] border-[hsl(var(--priority-medium))]/35',
  low: 'bg-[hsl(var(--priority-low))]/14 text-[hsl(var(--priority-low))] border-[hsl(var(--priority-low))]/35',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Öppen',
  'in-progress': 'Pågående',
  waiting: 'Väntar',
  resolved: 'Löst',
  closed: 'Stängt',
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Kritisk',
  high: 'Hög',
  medium: 'Medium',
  low: 'Låg',
};

const AVATAR_COLORS = [
  'bg-gradient-to-br from-purple-500 to-pink-500',
  'bg-gradient-to-br from-blue-500 to-cyan-500',
  'bg-gradient-to-br from-orange-500 to-red-500',
  'bg-gradient-to-br from-green-500 to-teal-500',
];

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export const TicketQueueTable = ({ tickets, isLoading, getUserName }: TicketQueueTableProps) => {
  const navigate = useNavigate();
  const activeTickets = tickets
    .filter(t => t.status !== 'closed')
    .sort((a, b) => {
      const prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (prioOrder[a.priority] ?? 4) - (prioOrder[b.priority] ?? 4);
    })
    .slice(0, 10);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Aktiv kö</p>
          <span className="font-mono text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
            {activeTickets.length} visas
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-5 pb-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : activeTickets.length === 0 ? (
          <div className="text-center py-8 px-5">
            <p className="text-sm font-medium text-muted-foreground">Inga aktiva ärenden</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border/50 bg-muted/10">
                  <th scope="col" className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 whitespace-nowrap">ID</th>
                  <th scope="col" className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Ärende</th>
                  <th scope="col" className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 whitespace-nowrap">Status</th>
                  <th scope="col" className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 whitespace-nowrap">Prioritet</th>
                  <th scope="col" className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 whitespace-nowrap hidden lg:table-cell">Tilldelad</th>
                </tr>
              </thead>
              <tbody>
                {activeTickets.map(ticket => {
                  const assigneeName = ticket.assignedToName || (ticket.assignedTo && getUserName?.(ticket.assignedTo)) || null;

                  return (
                    <tr
                      key={ticket.id}
                      className="border-b border-border/35 last:border-b-0 cursor-pointer hover:bg-muted/35 transition-colors"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/tickets/${ticket.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/tickets/${ticket.id}`);
                        }
                      }}
                    >
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-[11.5px] text-muted-foreground font-medium tracking-wide">
                          #{ticket.id.slice(0, 6)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-foreground text-[13.5px] tracking-tight truncate max-w-[280px]">
                          {ticket.title}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {ticket.category && (
                            <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded-full bg-muted/60 text-foreground/75 border border-border">
                              {ticket.category}
                            </span>
                          )}
                          {ticket.companyName && (
                            <span className="text-[11px] text-muted-foreground">{ticket.companyName}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={cn(
                          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold border whitespace-nowrap',
                          STATUS_STYLES[ticket.status]
                        )}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[ticket.status])} />
                          {STATUS_LABELS[ticket.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={cn(
                          'inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-semibold border whitespace-nowrap',
                          PRIORITY_STYLES[ticket.priority]
                        )}>
                          {PRIORITY_LABELS[ticket.priority]}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 hidden lg:table-cell">
                        {assigneeName ? (
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white',
                              hashColor(assigneeName)
                            )}>
                              {getInitials(assigneeName)}
                            </div>
                            <span className="text-[12.5px] font-medium">{assigneeName}</span>
                          </div>
                        ) : (
                          <span className="text-[12.5px] text-muted-foreground italic">ej tilldelad</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
