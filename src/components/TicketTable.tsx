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
  sortKey?: 'createdAt' | 'status' | 'priority' | 'category';
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
      <div className="space-y-3">
        {tickets.map((ticket) => {
          const progress = getProgress(ticket.id);
          const saving = !!savingIds[ticket.id];
          return (
            <Card key={ticket.id} className="p-4">
              {/* Title - clickable */}
              <Link
                to={`/tickets/${ticket.id}`}
                className="block mb-3"
              >
                <h3 className="font-medium text-foreground hover:text-primary transition-colors line-clamp-2">
                  {ticket.title}
                </h3>
              </Link>

              {/* Status & Priority row */}
              <div className="flex flex-wrap items-center gap-2 mb-2">
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
                    onClick={(e) => e.stopPropagation()}
                  >
                    <SelectTrigger className="w-auto h-7 text-xs" disabled={saving}>
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

                <PriorityBadge priority={ticket.priority} />
              </div>

              {/* Requester */}
              <p className="text-xs text-muted-foreground mb-2">
                {getUserName(ticket.requesterId)}
              </p>

              {/* Progress bar */}
              {progress && progress.total > 0 && (
                <div className="flex items-center gap-2">
                  <Progress
                    value={Math.round((progress.completed / progress.total) * 100)}
                    className="h-1.5 flex-1"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {progress.completed}/{progress.total}
                  </span>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    );
  }

  // Desktop: Table layout (unchanged)
  return (
    <div className="border rounded-lg overflow-hidden">
      <Table className={cn(compact && "text-xs")}>
        <TableHeader>
          <TableRow>
            <TableHead>Titel</TableHead>
            <TableHead>{renderSortButton('Status', 'status', enableStatusSort)}</TableHead>
            <TableHead>{renderSortButton('Prioritet', 'priority', enablePrioritySort)}</TableHead>
            <TableHead>{renderSortButton('Kategori', 'category', enableCategorySort)}</TableHead>
            <TableHead>Taggar</TableHead>
            <TableHead>Förlopp</TableHead>
            <TableHead>Beställare</TableHead>
            <TableHead>Skapad</TableHead>
            <TableHead>Uppdaterad</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((ticket) => (
            <TableRow key={ticket.id} className={cn(compact && "h-9")}>
              <TableCell className={cn(compact && "py-2")}>
                <Link
                  to={`/tickets/${ticket.id}`}
                  className="font-medium text-foreground hover:text-primary transition-colors"
                >
                  {ticket.title}
                </Link>
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
              <TableCell className={cn(compact && "py-2")}>
                {ticket.tags && ticket.tags.length > 0 ? (
                  <TagBadges tags={ticket.tags} maxDisplay={2} />
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
              </TableCell>
              <TableCell className={cn(compact && "py-2")}>
                {(() => {
                  const progress = getProgress(ticket.id);
                  if (!progress || progress.total === 0) {
                    return <span className="text-muted-foreground text-sm">—</span>;
                  }
                  const percentage = Math.round((progress.completed / progress.total) * 100);
                  return (
                    <div className="flex items-center gap-2 min-w-[100px]">
                      <Progress value={percentage} className="h-2 flex-1" />
                      <span className={cn("text-xs text-muted-foreground whitespace-nowrap", compact && "text-[11px]")}>
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
