import { Link, useLocation } from 'react-router';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { memo, useMemo, useState } from 'react';
import { ArrowUpDown, Loader2, X } from 'lucide-react';
import { Ticket, User, TicketStatus, TicketPriority } from '@/types/ticket';
import { PriorityBadge } from './PriorityBadge';
import { StatusBadge } from './StatusBadge';
import { CategoryBadge } from './CategoryBadge';
import { cn } from '@/lib/utils';
import { getInitials, hashColor } from '@/lib/avatar';
import { Progress } from '@/components/ui/progress';
import { useCategories } from '@/hooks/useCategories';
import { useIsMobile } from '@/hooks/use-mobile';
import { useChecklistProgress } from '@/hooks/useTicketChecklists';
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

interface BulkUpdates {
  status?: TicketStatus;
  priority?: TicketPriority;
  category_id?: string | null;
}

interface TicketTableProps {
  tickets: Ticket[];
  users: User[];
  sortKey?: 'createdAt' | 'status' | 'priority' | 'category';
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (key: 'status' | 'priority' | 'category') => void;
  enableStatusSort?: boolean;
  enablePrioritySort?: boolean;
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
  sortKey = 'createdAt',
  sortDirection = 'desc',
  onSortChange,
  enableStatusSort = true,
  enablePrioritySort = true,
  compact = false,
  selectedIds = [],
  onSelectionChange,
  onBulkAction,
  checklistVisible = true,
}: TicketTableProps) {
  const location = useLocation();
  const { categories } = useCategories();
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const isMobile = useIsMobile();

  const getUserName = (userId: string) => {
    const user = users.find(u => u.id === userId);
    return user?.name || 'Okänd';
  };

  // Stabilize ticket IDs so the progress query only re-runs when actual IDs change.
  // Skipped entirely when the "Förlopp" column is hidden — no point loading it.
  const ticketIds = useMemo(() => tickets.map(t => t.id), [tickets]);
  const checklistProgress = useChecklistProgress(ticketIds, checklistVisible);
  const getProgress = (ticketId: string) => checklistProgress?.[ticketId];

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
    onSelectionChange?.(allSelected ? [] : tickets.map(ticket => ticket.id));
    setSelectionMode(!allSelected);
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

  const bulkActions = (selectedIds.length > 0 && onBulkAction && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 rounded-lg border border-primary/30 bg-primary/5">
          <span className="text-sm font-medium text-foreground/80">{selectedIds.length} valda</span>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              disabled={bulkSaving}
              onValueChange={(v) => handleBulkAction({ status: v as TicketStatus })}
            >
              <SelectTrigger aria-label="Ändra status för valda ärenden" className="min-h-11 w-[140px]">
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
              <SelectTrigger aria-label="Ändra prioritet för valda ärenden" className="min-h-11 w-[140px]">
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
              <SelectTrigger aria-label="Ändra kategori för valda ärenden" className="min-h-11 w-[150px]">
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
            className="ml-auto min-h-11 gap-1"
            onClick={() => { onSelectionChange?.([]); setSelectionMode(false); }}
          >
            <X className="h-3 w-3" />
            Avmarkera
          </Button>
        </div>
      ));
  if (isMobile) {
    return <div className="space-y-2">
      {onSelectionChange && <Button variant="outline" aria-pressed={selectionMode} onClick={() => { setSelectionMode(!selectionMode); onSelectionChange([]); }}>{selectionMode ? 'Avsluta val' : 'Välj'}</Button>}
      {bulkActions}
      {tickets.map(ticket => <div key={ticket.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
        {onSelectionChange && selectionMode && <label className="-m-3.5 flex size-11 shrink-0 cursor-pointer items-center justify-center"><Checkbox disabled={bulkSaving} checked={selectedIds.includes(ticket.id)} onCheckedChange={() => toggleOne(ticket.id)} aria-label={`Markera ${ticket.title}`} /></label>}
        <Link className="min-w-0 flex-1 space-y-2" to={`/tickets/${ticket.id}`} state={{ from: location.pathname + location.search }}>
          <span className="block font-medium break-words">{ticket.title}</span>
          <span className="flex flex-wrap gap-2"><StatusBadge status={ticket.status} /><PriorityBadge priority={ticket.priority} /></span>
        </Link>
      </div>)}
    </div>;
  }
  return (
    <div className="space-y-2">
      {bulkActions}

    <div className="rounded-lg overflow-hidden border border-border bg-card">
      <Table className={cn(compact && "text-xs")} containerClassName="max-h-[calc(100dvh-16rem)] overflow-auto">
        <TableHeader className="sticky top-0 z-10">
          <TableRow className="border-b border-border/50 bg-card hover:bg-card">
            {onSelectionChange && (
              <TableHead className="w-10 pl-4">
                <label className="flex size-11 cursor-pointer items-center justify-center">
                  <Checkbox
                    checked={allSelected}
                    ref={(el) => { if (el) (el as any).indeterminate = someSelected; }}
                    onCheckedChange={toggleAll}
                    aria-label="Markera alla"
                  />
                </label>
              </TableHead>
            )}
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <div className="flex items-center gap-2">
                Ärende
              </div>
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{renderSortButton('Status', 'status', enableStatusSort)}</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{renderSortButton('Prioritet', 'priority', enablePrioritySort)}</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Förlopp</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Tilldelad</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Beställare</TableHead>
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
                "ticket-row transition-colors duration-150",
                "hover:bg-muted/50",
                "border-b border-border/30 last:border-0",
                "relative group",
                selectedIds.includes(ticket.id) && "bg-primary/5"
              )}
            >
              {onSelectionChange && (
                <TableCell className="relative z-10 w-10 py-0 pl-4">
                  <label className="flex size-11 cursor-pointer items-center justify-center">
                    <Checkbox
                      checked={selectedIds.includes(ticket.id)}
                      onCheckedChange={() => toggleOne(ticket.id)}
                      aria-label={`Markera ${ticket.title}`}
                    />
                  </label>
                </TableCell>
              )}
              {/* Ärende: Title + Category row */}
              <TableCell className={cn("py-2.5 px-4", compact && "py-1.5")}>
                <div className="flex flex-col gap-1">
                  <Link
                    to={`/tickets/${ticket.id}`}
                    state={{ from: location.pathname + location.search }}
                    className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200 outline-hidden after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                  >
                    {ticket.title}
                  </Link>
                  <div className="relative z-10 flex w-fit items-center gap-2 flex-wrap">
                    <CategoryBadge category={ticket.category} />
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
                    return <span className="text-muted-foreground text-sm">—</span>;
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
                        isComplete ? "text-primary" : "text-muted-foreground"
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
