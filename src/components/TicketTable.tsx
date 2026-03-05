import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { useEffect, useState } from 'react';
import { ArrowUpDown, Loader2 } from 'lucide-react';
import { Ticket, User, TicketStatus } from '@/types/ticket';
import { PriorityBadge } from './PriorityBadge';
import { CategoryBadge } from './CategoryBadge';
import { TagBadges } from './TagBadges';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { useCategories } from '@/hooks/useCategories';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface ChecklistProgress {
  ticketId: string;
  total: number;
  completed: number;
}

interface TicketTableProps {
  tickets: Ticket[];
  users: User[];
  onStatusChange?: (ticketId: string, status: TicketStatus) => void;
  onCategoryChange?: (ticketId: string, categoryId: string) => void;
  sortKey?: 'createdAt' | 'status' | 'priority' | 'category' | 'tags';
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (key: 'status' | 'priority' | 'category') => void;
  enableStatusSort?: boolean;
  enablePrioritySort?: boolean;
  enableCategorySort?: boolean;
  compact?: boolean;
}

const statusLabels: Record<TicketStatus, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

export const TicketTable = ({
  tickets,
  users,
  onStatusChange,
  onCategoryChange,
  sortKey = 'createdAt',
  sortDirection = 'desc',
  onSortChange,
  enableStatusSort = true,
  enablePrioritySort = true,
  enableCategorySort = true,
  compact = false,
}: TicketTableProps) => {
  const { categories } = useCategories();
  const [checklistProgress, setChecklistProgress] = useState<ChecklistProgress[]>([]);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const isMobile = useIsMobile();

  const getUserName = (userId: string) => {
    const user = users.find(u => u.id === userId);
    return user?.name || 'Okänd';
  };

  const getProgress = (ticketId: string) => {
    return checklistProgress.find(p => p.ticketId === ticketId);
  };

  useEffect(() => {
    const fetchChecklistProgress = async () => {
      const ticketIds = tickets.map(t => t.id);
      if (ticketIds.length === 0) return;

      try {
        const progressMap = new Map<string, { total: number; completed: number }>();

        // Fetch checklists for each ticket from local API
        await Promise.all(
          ticketIds.map(async (ticketId) => {
            try {
              const response = await fetch(`${API_BASE_URL}/checklists/ticket/${ticketId}`, {
                headers: {
                  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
                },
              });

              if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                  const completed = data.filter((item: any) => item.completed).length;
                  progressMap.set(ticketId, { total: data.length, completed });
                }
              }
            } catch (error) {
              console.error(`Error fetching checklists for ticket ${ticketId}:`, error);
            }
          })
        );

        setChecklistProgress(
          Array.from(progressMap.entries()).map(([ticketId, stats]) => ({
            ticketId,
            ...stats,
          }))
        );
      } catch (error) {
        console.error('Error fetching checklist progress:', error);
      }
    };

    fetchChecklistProgress();
  }, [tickets]);

  const renderSortButton = (label: string, key: 'status' | 'priority' | 'category', enabled: boolean) => {
    if (!enabled) {
      return <span>{label}</span>;
    }

    const isActive = sortKey === key;
    return (
      <button
        type="button"
        onClick={() => onSortChange?.(key)}
        className="flex items-center gap-2 text-left hover:text-foreground/80 transition-colors"
      >
        <span>{label}</span>
        <ArrowUpDown className={`h-3 w-3 ${isActive ? 'text-foreground' : 'text-muted-foreground'}`} />
        {isActive && (
          <span className="sr-only">
            Sortering {sortDirection === 'asc' ? 'stigande' : 'fallande'}
          </span>
        )}
      </button>
    );
  };

  if (tickets.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Inga ärenden hittades
      </div>
    );
  }

  // Mobile: Card layout
  if (isMobile) {
    return (
      <div className="space-y-4">
        {tickets.map((ticket, index) => {
          const progress = getProgress(ticket.id);
          const saving = !!savingIds[ticket.id];
          return (
            <Link
              key={ticket.id}
              to={`/tickets/${ticket.id}`}
              className="block"
            >
              <div
                className="ticket-card geo-border p-5 animate-fade-in cursor-pointer"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Title with neon glow on hover */}
                <h3 className="font-semibold text-lg text-foreground transition-all duration-300 line-clamp-2 mb-4 group-hover:neon-glow">
                  {ticket.title}
                </h3>

                {/* Status & Priority row */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <div className="flex items-center gap-2" onClick={(e) => e.preventDefault()}>
                    <Select
                      value={ticket.status}
                      onValueChange={async (value) => {
                        if (!onStatusChange) return;
                        setSavingIds(s => ({ ...s, [ticket.id]: true }));
                        try {
                          await onStatusChange(ticket.id, value as TicketStatus);
                        } catch (error) {
                          console.error('Status update failed:', error);
                        } finally {
                          setSavingIds(s => ({ ...s, [ticket.id]: false }));
                        }
                      }}
                    >
                      <SelectTrigger className="w-auto h-8 text-xs rounded-lg border-primary/20" disabled={saving}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">{statusLabels['open']}</SelectItem>
                        <SelectItem value="in-progress">{statusLabels['in-progress']}</SelectItem>
                        <SelectItem value="waiting">{statusLabels['waiting']}</SelectItem>
                        <SelectItem value="resolved">{statusLabels['resolved']}</SelectItem>
                        <SelectItem value="closed">{statusLabels['closed']}</SelectItem>
                      </SelectContent>
                    </Select>
                    {saving && <Loader2 className="animate-spin h-4 w-4 text-muted-foreground" />}
                  </div>

                  <div className="floating-tag">
                    <PriorityBadge priority={ticket.priority} />
                  </div>
                </div>

                {/* Requester with accent */}
                <p className="text-sm text-muted-foreground mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60"></span>
                  {getUserName(ticket.requesterId)}
                </p>

                {/* Progress bar with enhanced styling */}
                {progress && progress.total > 0 && (
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-background/20">
                    <Progress
                      value={Math.round((progress.completed / progress.total) * 100)}
                      className="h-2 flex-1"
                    />
                    <span className="text-xs font-medium text-primary whitespace-nowrap">
                      {progress.completed}/{progress.total}
                    </span>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    );
  }

  // Desktop: Table layout
  return (
    <div className="rounded-2xl overflow-hidden border border-border/50 backdrop-blur-sm bg-card/30">
      <Table className={cn(compact && "text-xs")}>
        <TableHeader>
          <TableRow className="border-b border-border/50 bg-background/40 backdrop-blur-sm">
            <TableHead className="font-semibold text-foreground/90">Titel</TableHead>
            <TableHead className="font-semibold text-foreground/90">{renderSortButton('Status', 'status', enableStatusSort)}</TableHead>
            <TableHead className="font-semibold text-foreground/90">{renderSortButton('Prioritet', 'priority', enablePrioritySort)}</TableHead>
            <TableHead className="font-semibold text-foreground/90">{renderSortButton('Kategori', 'category', enableCategorySort)}</TableHead>
            <TableHead className="font-semibold text-foreground/90">Taggar</TableHead>
            <TableHead className="font-semibold text-foreground/90">Förlopp</TableHead>
            <TableHead className="font-semibold text-foreground/90">Beställare</TableHead>
            <TableHead className="font-semibold text-foreground/90">Skapad</TableHead>
            <TableHead className="font-semibold text-foreground/90">Uppdaterad</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((ticket, index) => (
            <TableRow
              key={ticket.id}
              className={cn(
                compact && "h-9",
                "ticket-row animate-fade-in cursor-pointer transition-all duration-200",
                "hover:bg-gradient-to-r hover:from-primary/5 hover:to-accent/5",
                "border-b border-border/30 last:border-0",
                "relative group"
              )}
              style={{ animationDelay: `${index * 50}ms` }}
              onClick={() => window.location.href = `/tickets/${ticket.id}`}
            >
              <TableCell className={cn(compact && "py-3")}>
                <span className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200">
                  {ticket.title}
                </span>
              </TableCell>
              <TableCell className={cn(compact && "py-2")} onClick={(e) => e.stopPropagation()}>
                {(() => {
                  const saving = !!savingIds[ticket.id];
                  return (
                    <div className="flex items-center gap-2">
                      <Select
                        value={ticket.status}
                        onValueChange={async (value) => {
                          if (!onStatusChange) return;
                          setSavingIds(s => ({ ...s, [ticket.id]: true }));
                          try {
                            await onStatusChange(ticket.id, value as TicketStatus);
                          } catch (error) {
                            console.error('Status update failed:', error);
                          } finally {
                            setSavingIds(s => ({ ...s, [ticket.id]: false }));
                          }
                        }}
                      >
                        <SelectTrigger className={cn("w-[140px] h-7 text-xs", compact && "h-6 text-[11px]")} disabled={saving}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">{statusLabels['open']}</SelectItem>
                          <SelectItem value="in-progress">{statusLabels['in-progress']}</SelectItem>
                          <SelectItem value="waiting">{statusLabels['waiting']}</SelectItem>
                          <SelectItem value="resolved">{statusLabels['resolved']}</SelectItem>
                          <SelectItem value="closed">{statusLabels['closed']}</SelectItem>
                        </SelectContent>
                      </Select>
                      {saving && <Loader2 className="animate-spin h-4 w-4 text-muted-foreground" />}
                    </div>
                  );
                })()}
              </TableCell>
              <TableCell className={cn(compact && "py-2")}>
                <PriorityBadge priority={ticket.priority} />
              </TableCell>
              <TableCell className={cn(compact && "py-2")} onClick={(e) => e.stopPropagation()}>
                {onCategoryChange ? (
                  (() => {
                    const saving = !!savingIds[ticket.id];
                    return (
                      <div className="flex items-center gap-2">
                        <Select
                          value={ticket.category ?? ''}
                          onValueChange={async (value) => {
                            if (!onCategoryChange) return;
                            setSavingIds(s => ({ ...s, [ticket.id]: true }));
                            try {
                              await onCategoryChange(ticket.id, value);
                            } catch (error) {
                              console.error('Category update failed:', error);
                            } finally {
                              setSavingIds(s => ({ ...s, [ticket.id]: false }));
                            }
                          }}
                        >
                          <SelectTrigger className={cn("w-[180px] h-7 text-xs", compact && "h-6 text-[11px]")} disabled={saving}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>
                                {cat.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {saving && <Loader2 className="animate-spin h-4 w-4 text-muted-foreground" />}
                      </div>
                    );
                  })()
                ) : (
                  <CategoryBadge category={ticket.category} />
                )}
              </TableCell>
              <TableCell className={cn(compact && "py-2")} onClick={(e) => e.stopPropagation()}>
                {ticket.tags && ticket.tags.length > 0 ? (
                  <TagBadges tags={ticket.tags} maxDisplay={2} />
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
              </TableCell>
              <TableCell className={cn(compact && "py-3")}>
                {(() => {
                  const progress = getProgress(ticket.id);
                  if (!progress || progress.total === 0) {
                    return <span className="text-muted-foreground/50 text-sm">—</span>;
                  }
                  const percentage = Math.round((progress.completed / progress.total) * 100);
                  const isComplete = percentage === 100;
                  return (
                    <div className="flex items-center gap-3 min-w-[120px] p-1.5 rounded-lg bg-background/20 group-hover:bg-background/40 transition-colors">
                      <div className="flex-1 relative">
                        <Progress value={percentage} className="h-2.5" />
                        {isComplete && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-1 h-1 rounded-full bg-primary animate-pulse"></div>
                          </div>
                        )}
                      </div>
                      <span className={cn(
                        "text-xs font-medium whitespace-nowrap transition-colors",
                        isComplete ? "text-primary" : "text-muted-foreground",
                        compact && "text-[11px]"
                      )}>
                        {progress.completed}/{progress.total}
                      </span>
                    </div>
                  );
                })()}
              </TableCell>
              <TableCell className={cn("text-muted-foreground", compact && "py-2")}>
                {getUserName(ticket.requesterId)}
              </TableCell>
              <TableCell className={cn("text-muted-foreground", compact && "py-2")}>
                {format(ticket.createdAt, 'd MMM yyyy', { locale: sv })}
              </TableCell>
              <TableCell className={cn("text-muted-foreground", compact && "py-2")}>
                {format(ticket.updatedAt, 'd MMM yyyy', { locale: sv })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
