import { useState } from 'react';
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

interface BulkActionBarProps {
  selectedCount: number;
  onReopen: () => void;
  onChangePriority: (priority: TicketPriority) => void;
  onExportCsv: () => void;
  onDeletePermanently: () => void;
}

export function BulkActionBar({
  selectedCount,
  onReopen,
  onChangePriority,
  onExportCsv,
  onDeletePermanently,
}: BulkActionBarProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const isVisible = selectedCount > 0;

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

        <Button
          variant="outline"
          size="sm"
          onClick={onReopen}
          className="border-green-500 text-green-500 hover:bg-green-500/10 hover:text-green-500"
        >
          Öppna igen
        </Button>

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
            <AlertDialogTitle>Radera permanent?</AlertDialogTitle>
            <AlertDialogDescription>
              Du håller på att radera {selectedCount} ärende(n) permanent. Åtgärden kan inte ångras.
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
              Radera ärendena
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
