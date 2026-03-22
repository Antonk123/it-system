import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChecklistTemplate } from '@/lib/api';
import { ListChecks, ChevronRight } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  templates: ChecklistTemplate[];
  onSelect: (template: ChecklistTemplate) => void;
}

export const ChecklistTemplateModal = ({ open, onClose, templates, onSelect }: Props) => {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Välj checklistmall
          </DialogTitle>
        </DialogHeader>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Inga mallar skapade ännu. Gå till Inställningar för att skapa mallar.
          </p>
        ) : (
          <div className="space-y-2 py-2">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => { onSelect(t); onClose(); }}
                className="w-full text-left px-4 py-3 rounded-lg border hover:bg-muted/50 transition-colors flex items-center justify-between group"
              >
                <div>
                  <div className="font-medium text-sm">{t.name}</div>
                  {t.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    {t.items.length} punkt{t.items.length !== 1 ? 'er' : ''}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
