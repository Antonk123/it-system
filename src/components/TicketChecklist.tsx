import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X, Plus, CheckSquare } from 'lucide-react';
import { ChecklistItem } from '@/hooks/useTicketChecklists';

interface PendingItem {
  id: string;
  label: string;
  completed: boolean;
}

interface TicketChecklistProps {
  items: ChecklistItem[];
  pendingItems?: PendingItem[];
  onToggle?: (id: string, completed: boolean) => void;
  onDelete?: (id: string) => void;
  onAdd?: (label: string) => void;
  onPendingAdd?: (label: string) => void;
  onPendingDelete?: (id: string) => void;
  readOnly?: boolean;
}

export const TicketChecklist = ({
  items,
  pendingItems = [],
  onToggle,
  onDelete,
  onAdd,
  onPendingAdd,
  onPendingDelete,
  readOnly = false,
}: TicketChecklistProps) => {
  const [newItemLabel, setNewItemLabel] = useState('');

  const allItems = [...items, ...pendingItems.map(p => ({ ...p, ticket_id: '', position: 0, created_at: '', updated_at: '' }))];
  const completedCount = items.filter(i => i.completed).length;
  const totalCount = items.length + pendingItems.length;

  const handleAddItem = () => {
    if (!newItemLabel.trim()) return;
    
    if (onPendingAdd) {
      onPendingAdd(newItemLabel.trim());
    } else if (onAdd) {
      onAdd(newItemLabel.trim());
    }
    setNewItemLabel('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddItem();
    }
  };

  const isPending = (id: string) => pendingItems.some(p => p.id === id);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckSquare className="h-4 w-4" />
        <span>
          Checklista {totalCount > 0 && `(${completedCount}/${totalCount} slutförda)`}
        </span>
      </div>

      <div className="space-y-2">
        {allItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 group"
          >
            <Checkbox
              checked={item.completed}
              onCheckedChange={(checked) => {
                if (!readOnly && onToggle && !isPending(item.id)) {
                  onToggle(item.id, checked as boolean);
                }
              }}
              disabled={readOnly || isPending(item.id)}
            />
            <span
              className={`flex-1 text-sm ${
                item.completed ? 'line-through text-muted-foreground' : ''
              } ${isPending(item.id) ? 'italic text-muted-foreground' : ''}`}
            >
              {item.label}
              {isPending(item.id) && ' (väntar)'}
            </span>
            {!readOnly && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => {
                  if (isPending(item.id)) {
                    onPendingDelete?.(item.id);
                  } else {
                    onDelete?.(item.id);
                  }
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Lägg till ny punkt..."
            value={newItemLabel}
            onChange={(e) => setNewItemLabel(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleAddItem}
            disabled={!newItemLabel.trim()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};
