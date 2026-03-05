import { Ticket, User } from '@/types/ticket';
import { TicketTable } from './TicketTable';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';

interface KPIDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  tickets: Ticket[];
  users: User[];
  description?: string;
}

export const KPIDetailDialog = ({
  open,
  onOpenChange,
  title,
  tickets,
  users,
  description,
}: KPIDetailDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="mt-4">
          {tickets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Inga ärenden att visa
            </div>
          ) : (
            <TicketTable
              tickets={tickets}
              users={users}
              compact={true}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Stäng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
