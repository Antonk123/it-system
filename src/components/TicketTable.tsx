import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { memo, useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Loader2, X } from 'lucide-react';
import { Ticket, User, TicketStatus, TicketPriority } from '@/types/ticket';
import { PriorityBadge } from './PriorityBadge';
import { StatusBadge } from './StatusBadge';
import { SLABadge } from './SLABadge';
import { CategoryBadge } from './CategoryBadge';
import { TagBadges } from './TagBadges';
import { cn } from '@/lib/utils';
import { getInitials, hashColor } from '@/lib/avatar';
import { Progress } from '@/components/ui/progress';
import { useCategories } from '@/hooks/useCategories';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

interface ChecklistProgress {
  ticketId: string;
  total: number;
  completed: number;
}

interface BulkUpdates {
  status?: TicketStatus;
  priority?: TicketPriority;
  category_id?: string | null;
}

interface TicketTableProps {
  tickets: Ticket[];
  users: User[];
  onStatusChange?: (ticketId: string, status: TicketStatus) => void;
  onCategoryChange?: (ticketId: string, categoryId: string) => void;
  onTicketClick?: (ticketId: string) => void;
  sortKey?: 'createdAt' | 'status' | 'priority' | 'category' | 'tags';
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (key: 'status' | 'priority' | 'category') => void;
  enableStatusSort?: boolean;
  enablePrioritySort?: boolean;
  enableCategorySort?: boolean;
  compact?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onBulkAction?: (ids: string[], updates: BulkUpdates) => Promise<void>;
  /**
   * Whether the "Förlopp" (checklist progress) column is shown. When false we
   * skip the per-page checklist-progress fetch entirely (perf). Defaults to
   * true to preserve existing callers' behavior.
   */
  checklistVisible?: boolean;
}

export const TicketTable = memo(function TicketTable({
  tickets,
  users,
  onStatusChange,
  onCategoryChange,
  onTicketClick,
  sortKey = 'createdAt',
  sortDirection = 'desc',
  onSortChange,
  enableStatusSort = true,
  enablePrioritySort = true,
  enableCategorySort = true,
  compact = false,
  selectedIds = [],
  onSelectionChange,
  onBulkAction,
  checklistVisible = true,
}: TicketTableProps) {
  const { categories } = useCategories();
  const [checklistProgress, setChecklistProgress] = useState<ChecklistProgress[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const isMobile = useIsMobile();

  const getUserName = (userId: string) => {
    const user = users.find(u => u.id === userId);
    return user?.name || 'Okänd';
  };

  const getProgress = (ticketId: string) => {
    return checklistProgress.find(p => p.ticketId === ticketId);
  };

  // Stabilize ticket IDs so the effect only re-runs when actual IDs change
  const ticketIdsKey = useMemo(() => tickets.map(t => t.id).join(','), [tickets]);

  useEffect(() => {
    // Skip the fetch entirely when the checklist/progress column is hidden —
    // no point loading per-ticket progress the user can't see.
    if (!checklistVisible) return;

    const controller = new AbortController();
    const { signal } = controller;

    const fetchChecklistProgress = async () => {
      const ticketIds = ticketIdsKey.split(',').filter(Boolean);
      if (ticketIds.length === 0) return;

      try {
        const data = await api.getChecklistProgress(ticketIds, signal);
        if (!signal.aborted) {
          setChecklistProgress(
            Object.entries(data).map(([ticketId, stats]) => ({
              ticketId,
              ...stats,
            }))
          );
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Error fetching checklist progress:', error);
        }
      }
    };

    fetchChecklistProgress();
    return () => controller.abort();
  }, [ticketIdsKey, checklistVisible]);

  const renderSortButton = (label: string, key: 'status' | 'priority' | 'category', enabled: boolean) => {
    if (!enabled) {
      return <span>{label}</span>;
    }

    const isActive = sortKey === key;
    return (
      <button
        type="button"
        onClick={() => onSortChange?.(key)}
        className="flex items-center gap-2 text-left hover:text-foreground/80 active:opacity-70 transition-colors min-h-[36px] py-1"
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

  const allSelected = tickets.length > 0 && tickets.every(t => selectedIds.includes(t.id));
  const someSelected = selectedIds.length > 0 && !allSelected;

  const toggleAll = () => {
    if (selectionMode && allSelected) {
      // Deselect all and exit selection mode
      onSelectionChange?.([]);
      setSelectionMode(false);
    } else if (selectionMode) {
      // Already in selection mode, select all
      onSelectionChange?.(tickets.map(t => t.id));
    } else {
      // Enter selection mode and select all
      setSelectionMode(true);
      onSelectionChange?.(tickets.map(t => t.id));
    }
  };

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      const newIds = selectedIds.filter(s => s !== id);
      onSelectionChange?.(newIds);
      if (newIds.length === 0) {
        setSelectionMode(false);
      }
    } else {
      onSelectionChange?.([...selectedIds, id]);
    }
  };

  const handleBulkAction = async (updates: BulkUpdates) => {
    if (!onBulkAction || selectedIds.length === 0) return;
    setBulkSaving(true);
    try {
      await onBulkAction(selectedIds, updates);
      onSelectionChange?.([]);
      setSelectionMode(false);
    } finally {
      setBulkSaving(false);
    }
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
      <div className="space-y-2">
        {tickets.map((ticket) => {
          const daysAgo = Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / 86400000);
          const ageLabel = daysAgo === 0 ? 'Idag' : daysAgo === 1 ? '1 dag sedan' : `${daysAgo} dagar sedan`;
          return (
            <Link
              key={ticket.id}
              to={`/tickets/${ticket.id}`}
              className="block"
            >
              <div className="bg-card rounded-lg border border-border p-3 cursor-pointer hover:bg-accent/5 active:bg-accent/10 transition-colors">
                {/* Row 1: Title + Status badge */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-bold text-foreground truncate flex-1">
                    {ticket.title}
                  </h3>
                  <StatusBadge status={ticket.status} className="shrink-0" />
                </div>
                {/* Row 2: Priority + Age */}
                <div className="flex items-center justify-between gap-2">
                  <PriorityBadge priority={ticket.priority} />
                  <span className="text-xs text-muted-foreground">{ageLabel}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    );
  }

  // Desktop: Table layout
  return (
    <div className="space-y-2">
      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && onBulkAction && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 rounded-xl border border-primary/30 bg-primary/5 backdrop-blur-xs">
          <span className="text-sm font-medium text-foreground/80">{selectedIds.length} valda</span>
          <div className="flex items-center gap-2 ml-2">
            <Select
              disabled={bulkSaving}
              onValueChange={(v) => handleBulkAction({ status: v as TicketStatus })}
            >
              <SelectTrigger className="h-7 w-[130px] text-xs">
                <SelectValue placeholder="Ändra status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Öppen</SelectItem>
                <SelectItem value="in-progress">Pågående</SelectItem>
                <SelectItem value="waiting">Väntar</SelectItem>
                <SelectItem value="resolved">Löst</SelectItem>
                <SelectItem value="closed">Stängd</SelectItem>
              </SelectContent>
            </Select>
            <Select
              disabled={bulkSaving}
              onValueChange={(v) => handleBulkAction({ priority: v as TicketPriority })}
            >
              <SelectTrigger className="h-7 w-[130px] text-xs">
                <SelectValue placeholder="Ändra prioritet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Låg</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">Hög</SelectItem>
                <SelectItem value="critical">Kritisk</SelectItem>
              </SelectContent>
            </Select>
            <Select
              disabled={bulkSaving}
              onValueChange={(v) => handleBulkAction({ category_id: v === '__none__' ? null : v })}
            >
              <SelectTrigger className="h-7 w-[150px] text-xs">
                <SelectValue placeholder="Ändra kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Ingen kategori</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bulkSaving && <Loader2 className="animate-spin h-4 w-4 text-muted-foreground" />}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs gap-1"
            onClick={() => { onSelectionChange?.([]); setSelectionMode(false); }}
          >
            <X className="h-3 w-3" />
            Avmarkera
          </Button>
        </div>
      )}

    <div className="rounded-2xl overflow-hidden border border-border/50 backdrop-blur-xs bg-card/30">
      <Table className={cn(compact && "text-xs")}>
        <TableHeader>
          <TableRow className="border-b border-border/50 bg-background/40 backdrop-blur-xs">
            {onSelectionChange && selectionMode && (
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={allSelected}
                  ref={(el) => { if (el) (el as any).indeterminate = someSelected; }}
                  onCheckedChange={toggleAll}
                  aria-label="Markera alla"
                />
              </TableHead>
            )}
            <TableHead className="font-semibold text-foreground/90">
              <div className="flex items-center gap-2">
                {onSelectionChange && !selectionMode && (
                  <Checkbox
                    checked={false}
                    onCheckedChange={toggleAll}
                    aria-label="Välj flera"
                    className="opacity-40 hover:opacity-100 transition-opacity"
                  />
                )}
                Ärende
              </div>
            </TableHead>
            <TableHead className="font-semibold text-foreground/90">{renderSortButton('Status', 'status', enableStatusSort)}</TableHead>
            <TableHead className="font-semibold text-foreground/90">{renderSortButton('Prioritet', 'priority', enablePrioritySort)}</TableHead>
            <TableHead className="font-semibold text-foreground/90">Förlopp</TableHead>
            <TableHead className="font-semibold text-foreground/90 hidden lg:table-cell">Tilldelad</TableHead>
            <TableHead className="font-semibold text-foreground/90">Beställare</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((ticket) => {
            const requesterName = getUserName(ticket.requesterId);
            const initials = requesterName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            return (
            <TableRow
              key={ticket.id}
              className={cn(
                compact && "h-9",
                "ticket-row cursor-pointer transition-all duration-200",
                "hover:bg-linear-to-r hover:from-primary/5 hover:to-accent/5",
                "border-b border-border/30 last:border-0",
                "relative group",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                selectedIds.includes(ticket.id) && "bg-primary/5"
              )}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (onTicketClick) {
                  onTicketClick(ticket.id);
                } else {
                  window.location.href = `/tickets/${ticket.id}`;
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (onTicketClick) {
                    onTicketClick(ticket.id);
                  } else {
                    window.location.href = `/tickets/${ticket.id}`;
                  }
                }
              }}
            >
              {onSelectionChange && selectionMode && (
                <TableCell className="w-10 py-2.5 pl-4" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.includes(ticket.id)}
                    onCheckedChange={() => toggleOne(ticket.id)}
                    aria-label={`Markera ${ticket.title}`}
                  />
                </TableCell>
              )}
              {/* Ärende: Title + Category/Tags/SLA row */}
              <TableCell className={cn("py-2.5 px-4", compact && "py-1.5")}>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200">
                    {ticket.title}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <CategoryBadge category={ticket.category} />
                    {ticket.tags && ticket.tags.length > 0 && (
                      <TagBadges tags={ticket.tags} maxDisplay={2} />
                    )}
                    <SLABadge
                      deadline={ticket.sla_resolution_deadline}
                      met={ticket.sla_resolution_met}
                      pausedAt={ticket.sla_paused_at}
                      ticketStatus={ticket.status}
                    />
                  </div>
                </div>
              </TableCell>
              {/* Status: Badge only */}
              <TableCell className={cn("py-2.5 px-4", compact && "py-1.5")}>
                <StatusBadge status={ticket.status} />
              </TableCell>
              {/* Prioritet */}
              <TableCell className={cn("py-2.5 px-4", compact && "py-1.5")}>
                <PriorityBadge priority={ticket.priority} />
              </TableCell>
              {/* Förlopp */}
              <TableCell className={cn("py-2.5 px-4", compact && "py-1.5")}>
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
                        "text-xs font-medium whitespace-nowrap transition-colors tabular-nums",
                        isComplete ? "text-primary" : "text-muted-foreground",
                        compact && "text-[11px]"
                      )}>
                        {progress.completed}/{progress.total}
                      </span>
                    </div>
                  );
                })()}
              </TableCell>
              {/* Tilldelad: Avatar + name */}
              <TableCell className={cn("py-2.5 px-4 hidden lg:table-cell", compact && "py-1.5")}>
                {(() => {
                  const assigneeName = ticket.assignedToName || (ticket.assignedTo ? getUserName(ticket.assignedTo) : null);
                  if (!assigneeName) {
                    return <span className="text-sm italic text-muted-foreground">ej tilldelad</span>;
                  }
                  return (
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0',
                        hashColor(assigneeName)
                      )}>
                        {getInitials(assigneeName)}
                      </div>
                      <span className="text-sm font-medium">{assigneeName}</span>
                    </div>
                  );
                })()}
              </TableCell>
              {/* Beställare: Avatar + name + date */}
              <TableCell className={cn("py-2.5 px-4", compact && "py-1.5")}>
                <div className="flex items-center gap-2">
                  <div className="shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                    <span className="text-xs font-bold text-muted-foreground">{initials}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm text-foreground">{requesterName}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(ticket.createdAt, 'd MMM yyyy', { locale: sv })}
                    </span>
                  </div>
                </div>
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
    </div>
  );
});
