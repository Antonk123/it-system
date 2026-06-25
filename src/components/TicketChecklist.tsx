import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X, Plus, CheckSquare, Calendar, ListChecks, Bookmark, CornerDownRight } from 'lucide-react';
import { ChecklistItem } from '@/hooks/useTicketChecklists';
import { ChecklistTemplate } from '@/lib/api';
import { ChecklistTemplateModal } from './ChecklistTemplateModal';
import { format, parseISO, isPast, startOfDay } from 'date-fns';
import { sv } from 'date-fns/locale';

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
  onAdd?: (label: string, parentId?: string | null) => void;
  onUpdate?: (id: string, updates: Partial<Pick<ChecklistItem, 'label' | 'due_date'>>) => void;
  onPendingAdd?: (label: string) => void;
  onPendingDelete?: (id: string) => void;
  readOnly?: boolean;
  templates?: ChecklistTemplate[];
  onApplyTemplate?: (template: ChecklistTemplate) => void;
  onSaveAsTemplate?: (items: ChecklistItem[]) => void;
}

export const TicketChecklist = ({
  items,
  pendingItems = [],
  onToggle,
  onDelete,
  onAdd,
  onUpdate,
  onPendingAdd,
  onPendingDelete,
  readOnly = false,
  templates = [],
  onApplyTemplate,
  onSaveAsTemplate,
}: TicketChecklistProps) => {
  const [newItemLabel, setNewItemLabel] = useState('');
  const [subItemInputs, setSubItemInputs] = useState<Record<string, string>>({});
  const [showSubInputFor, setShowSubInputFor] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const completedCount = items.filter(i => i.completed).length;
  const totalCount = items.length + pendingItems.length;

  const topLevelItems = items.filter(i => !i.parent_id);
  const getChildren = (parentId: string) => items.filter(i => i.parent_id === parentId);

  const handleAddTopLevel = () => {
    if (!newItemLabel.trim()) return;
    if (onPendingAdd) {
      onPendingAdd(newItemLabel.trim());
    } else if (onAdd) {
      onAdd(newItemLabel.trim(), null);
    }
    setNewItemLabel('');
  };

  const handleAddSubItem = (parentId: string) => {
    const label = subItemInputs[parentId]?.trim();
    if (!label) return;
    onAdd?.(label, parentId);
    setSubItemInputs(prev => ({ ...prev, [parentId]: '' }));
    setShowSubInputFor(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      action();
    }
    if (e.key === 'Escape') {
      setShowSubInputFor(null);
    }
  };

  const isOverdue = (dueDate: string, completed: boolean) =>
    !completed && isPast(startOfDay(parseISO(dueDate)));

  const renderDueDateBadge = (item: ChecklistItem) => {
    if (!item.due_date) return null;
    const overdue = isOverdue(item.due_date, item.completed);
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded shrink-0 ${
          overdue
            ? 'bg-destructive/10 text-destructive'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        <Calendar className="h-3 w-3" />
        {format(parseISO(item.due_date), 'd MMM', { locale: sv })}
      </span>
    );
  };

  const renderDatePicker = (item: ChecklistItem) => {
    if (readOnly || !onUpdate) return null;
    return (
      <label
        htmlFor={`date-${item.id}`}
        className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity cursor-pointer"
        title="Sätt förfallodatum"
        aria-label="Sätt förfallodatum"
      >
        <input
          id={`date-${item.id}`}
          type="date"
          value={item.due_date || ''}
          onChange={(e) => onUpdate(item.id, { due_date: e.target.value || null })}
          className="sr-only"
        />
        <span className="inline-flex items-center justify-center h-9 w-9 md:h-7 md:w-7 rounded hover:bg-muted transition-colors">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      </label>
    );
  };

  const renderItem = (item: ChecklistItem, isChild = false) => {
    const children = getChildren(item.id);
    const hasChildren = children.length > 0;

    return (
      <div key={item.id}>
        <div
          className={`flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group ${
            isChild ? 'ml-6' : ''
          }`}
        >
          {isChild && <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0" />}
          <Checkbox
            checked={item.completed}
            onCheckedChange={(checked) => {
              if (!readOnly && onToggle) {
                onToggle(item.id, checked as boolean);
              }
            }}
            disabled={readOnly}
          />
          <span
            className={`flex-1 text-sm min-w-0 ${
              item.completed ? 'line-through text-muted-foreground' : ''
            }`}
          >
            {item.label}
          </span>

          {renderDueDateBadge(item)}
          {renderDatePicker(item)}

          {!readOnly && !isChild && onAdd && (
            <button
              onClick={() => setShowSubInputFor(showSubInputFor === item.id ? null : item.id)}
              className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity inline-flex items-center justify-center h-9 w-9 md:h-7 md:w-7 rounded hover:bg-muted"
              title="Lägg till deluppgift"
              aria-label="Lägg till deluppgift"
            >
              <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}

          {!readOnly && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 md:h-7 md:w-7 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity shrink-0"
              onClick={() => onDelete?.(item.id)}
              aria-label="Ta bort uppgift"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Sub-item input */}
        {showSubInputFor === item.id && !readOnly && (
          <div className="ml-12 mt-1 flex items-center gap-2">
            <Input
              placeholder="Lägg till deluppgift..."
              value={subItemInputs[item.id] || ''}
              onChange={(e) => setSubItemInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
              onKeyDown={(e) => handleKeyDown(e, () => handleAddSubItem(item.id))}
              className="flex-1 h-8 text-sm"
              autoFocus
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => handleAddSubItem(item.id)}
              disabled={!subItemInputs[item.id]?.trim()}
              aria-label="Lägg till deluppgift"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => setShowSubInputFor(null)}
              aria-label="Avbryt"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Children */}
        {hasChildren && (
          <div className="space-y-0.5 mt-0.5">
            {children.map(child => renderItem(child, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckSquare className="h-4 w-4" />
          <span>
            Checklista {totalCount > 0 && `(${completedCount}/${totalCount} slutförda)`}
          </span>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1">
            {onApplyTemplate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setShowTemplateModal(true)}
              >
                <ListChecks className="h-3.5 w-3.5" />
                Välj mall
              </Button>
            )}
            {onSaveAsTemplate && items.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => onSaveAsTemplate(items)}
              >
                <Bookmark className="h-3.5 w-3.5" />
                Spara som mall
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="space-y-0.5">
        {topLevelItems.map(item => renderItem(item))}

        {/* Pending items */}
        {pendingItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group"
          >
            <Checkbox checked={false} disabled />
            <span className="flex-1 text-sm italic text-muted-foreground">
              {item.label} (väntar)
            </span>
            {!readOnly && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 md:h-7 md:w-7 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity"
                onClick={() => onPendingDelete?.(item.id)}
                aria-label="Ta bort väntande uppgift"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Add top-level item */}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Lägg till ny punkt..."
            value={newItemLabel}
            onChange={(e) => setNewItemLabel(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, handleAddTopLevel)}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleAddTopLevel}
            disabled={!newItemLabel.trim()}
            aria-label="Lägg till ny punkt"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Template modal */}
      {onApplyTemplate && (
        <ChecklistTemplateModal
          open={showTemplateModal}
          onClose={() => setShowTemplateModal(false)}
          templates={templates}
          onSelect={onApplyTemplate}
        />
      )}
    </div>
  );
};
