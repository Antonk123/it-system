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
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 bg-card shadow-lg rounded-lg border transition-transform duration-200 ease-out ${
          isVisible ? 'translate-y-0' : 'translate-y-[200%]'
        }`}
      >
        <span className="text-sm font-medium whitespace-nowrap">
          {selectedCount} arende(n) valda
        </span>

        <div className="h-4 w-px bg-border" />

        <Button
          variant="outline"
          size="sm"
          onClick={onReopen}
          className="border-green-500 text-green-500 hover:bg-green-500/10 hover:text-green-500"
        >
          Oppna igen
        </Button>

        <Select onValueChange={(value) => onChangePriority(value as TicketPriority)}>
          <SelectTrigger className="h-8 w-[150px]">
            <SelectValue placeholder="Andra prioritet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Lag prioritet</SelectItem>
            <SelectItem value="medium">Medium prioritet</SelectItem>
            <SelectItem value="high">Hog prioritet</SelectItem>
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
              Du haller pa att radera {selectedCount} arende(n) permanent. Atgarden kan inte angras.
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
              Radera arendena
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
