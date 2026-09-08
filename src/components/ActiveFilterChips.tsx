import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCategories } from '@/hooks/useCategories';
import { PRIORITY_LABELS } from '@/lib/constants';

interface ActiveFilterChipsProps {
  priorityFilter: string;
  categoryFilter: string;
  checklistFilter: string;
  dateFrom: string;
  dateTo: string;
  dateField: string;
  onRemove: (updates: Record<string, any>) => void;
  onClearAll: () => void;
}

const CHECKLIST_LABELS: Record<string, string> = {
  has_checklist: 'Med checklista',
  no_checklist: 'Utan checklista',
};

const DATE_FIELD_LABELS: Record<string, string> = {
  created_at: 'Skapad',
  updated_at: 'Uppdaterad',
  closed_at: 'Stängd',
};

export function ActiveFilterChips({
  priorityFilter,
  categoryFilter,
  checklistFilter,
  dateFrom,
  dateTo,
  dateField,
  onRemove,
  onClearAll,
}: ActiveFilterChipsProps) {
  const { categories } = useCategories();

  // Count active filters to determine if we should render anything
  const hasPriority = priorityFilter && priorityFilter !== 'all';
  const hasCategory = categoryFilter && categoryFilter !== 'all';
  const hasChecklist = Boolean(checklistFilter);
  const hasDate = Boolean(dateFrom || dateTo);

  const totalActive =
    (hasPriority ? 1 : 0) +
    (hasCategory ? 1 : 0) +
    (hasChecklist ? 1 : 0) +
    (hasDate ? 1 : 0);

  if (totalActive === 0) {
    return null;
  }

  const categoryLabel = categories.find((c) => c.id === categoryFilter)?.label || categoryFilter;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Priority chip */}
      {hasPriority && (
        <Badge
          variant="secondary"
          className="flex items-center gap-1 pr-1 border border-primary text-xs font-semibold"
        >
          <span className="text-muted-foreground">Prioritet:</span>
          {PRIORITY_LABELS[priorityFilter] || priorityFilter}
          <button
            onClick={() => onRemove({ priority: 'all' })}
            className="ml-1 rounded-sm hover:text-destructive p-0.5"
            aria-label="Ta bort prioritetsfilter"
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      )}

      {/* Category chip */}
      {hasCategory && (
        <Badge
          variant="secondary"
          className="flex items-center gap-1 pr-1 border border-primary text-xs font-semibold"
        >
          <span className="text-muted-foreground">Kategori:</span>
          {categoryLabel}
          <button
            onClick={() => onRemove({ category: 'all' })}
            className="ml-1 rounded-sm hover:text-destructive p-0.5"
            aria-label="Ta bort kategorifilter"
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      )}

      {/* Checklist chip */}
      {hasChecklist && (
        <Badge
          variant="secondary"
          className="flex items-center gap-1 pr-1 border border-primary text-xs font-semibold"
        >
          <span className="text-muted-foreground">Checklista:</span>
          {CHECKLIST_LABELS[checklistFilter] || checklistFilter}
          <button
            onClick={() => onRemove({ checklist: '' })}
            className="ml-1 rounded-sm hover:text-destructive p-0.5"
            aria-label="Ta bort checklistefilter"
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      )}

      {/* Date range chip */}
      {hasDate && (
        <Badge
          variant="secondary"
          className="flex items-center gap-1 pr-1 border border-primary text-xs font-semibold"
        >
          <span className="text-muted-foreground">{DATE_FIELD_LABELS[dateField] ?? 'Datum'}:</span>
          {dateFrom && dateTo
            ? `${dateFrom} till ${dateTo}`
            : dateFrom
            ? `Fran ${dateFrom}`
            : `Till ${dateTo}`}
          <button
            onClick={() => onRemove({ dateFrom: '', dateTo: '' })}
            className="ml-1 rounded-sm hover:text-destructive p-0.5"
            aria-label="Ta bort datumfilter"
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      )}

      {/* Clear all button — only visible when 2+ chips active */}
      {totalActive >= 2 && (
        <Button
          variant="ghost"
          className="text-xs h-6"
          onClick={onClearAll}
        >
          Rensa alla
        </Button>
      )}
    </div>
  );
}
