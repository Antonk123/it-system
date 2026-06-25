import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { TicketPriority } from '@/types/ticket';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSystemUsers } from '@/hooks/useSystemUsers';

interface BulkActionBarProps {
  selectedCount: number;
  /**
   * Whether Reopen makes sense for the current selection.
   * Pass `selectedTickets.some(t => t.status === 'resolved' || t.status === 'closed')`.
   * Defaults to true (Archive always lists closed tickets).
   */
  canReopen?: boolean;
  /** Whether assignee dropdown is shown (admins only). */
  canAssign?: boolean;
  onReopen: () => void;
  onChangePriority: (priority: TicketPriority) => void;
  onAssign?: (userId: string | null) => void;
  onExportCsv: () => void;
  onDeletePermanently: () => void;
}

export function BulkActionBar({
  selectedCount,
  canReopen = true,
  canAssign = false,
  onReopen,
  onChangePriority,
  onAssign,
  onExportCsv,
  onDeletePermanently,
}: BulkActionBarProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const isVisible = selectedCount > 0;
  // Only fetch system users when bulk-assign is available — avoids ett extra
  // network round-trip för non-admins som ändå inte kan använda dropdownen.
  const { users: systemUsers } = useSystemUsers({ enabled: canAssign });

  return (
    <>
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-50 flex flex-wrap items-center justify-center gap-2 sm:gap-3 px-3 py-2 bg-card shadow-lg rounded-lg border transition-transform duration-200 ease-out w-[calc(100vw-1rem)] max-w-[640px] sm:w-auto bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] md:bottom-6 ${
          isVisible ? 'translate-y-0' : 'translate-y-[200%] pointer-events-none'
        }`}
        role="region"
        aria-label="Massåtgärder"
      >
        <span className="text-sm font-medium whitespace-nowrap">
          {selectedCount} ärende(n) valda
        </span>

        <div className="hidden sm:block h-4 w-px bg-border" />

        {canReopen && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReopen}
            className="border-[hsl(var(--success))] text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/10 hover:text-[hsl(var(--success))]"
          >
            Öppna igen
          </Button>
        )}

        <Select onValueChange={(value) => onChangePriority(value as TicketPriority)}>
          <SelectTrigger className="h-9 w-[140px] sm:w-[150px]" aria-label="Ändra prioritet">
            <SelectValue placeholder="Ändra prioritet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Låg prioritet</SelectItem>
            <SelectItem value="medium">Medium prioritet</SelectItem>
            <SelectItem value="high">Hög prioritet</SelectItem>
            <SelectItem value="critical">Kritisk prioritet</SelectItem>
          </SelectContent>
        </Select>

        {canAssign && onAssign && (
          <Select
            onValueChange={(value) => onAssign(value === '__unassigned__' ? null : value)}
          >
            <SelectTrigger className="h-9 w-[150px] sm:w-[170px]" aria-label="Tilldela alla">
              <SelectValue placeholder="Tilldela alla" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned__">Ej tilldelad</SelectItem>
              {systemUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.displayName || u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={onExportCsv}
        >
          Exportera CSV
        </Button>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleteDialogOpen(true)}
        >
          Radera permanent
        </Button>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              Permanent radering — kan INTE ångras
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Du håller på att radera <strong>{selectedCount} ärende(n)</strong> permanent från databasen.
              </span>
              <span className="block text-foreground font-medium">
                Detta tar bort all data — kommentarer, bilagor, historik och tidsregistreringar — för dessa ärenden. Det finns ingen ångerfunktion.
              </span>
              <span className="block text-sm">
                Om du vill behålla data men dölja ärendena, stäng dem istället (status: Stängd).
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDeleteDialogOpen(false);
                onDeletePermanently();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Ja, radera {selectedCount} permanent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
