import { Fragment } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCategories } from '@/hooks/useCategories';
import { useTags } from '@/hooks/useTags';

interface ActiveFilterChipsProps {
  selectedStatuses: string[];
  priorityFilter: string;
  categoryFilter: string;
  selectedTagIds: string[];
  tagMode: 'or' | 'and';
  checklistFilter: string;
  dateFrom: string;
  dateTo: string;
  dateField: string;
  hideStatus?: boolean; // true on Archive
  onRemove: (updates: Record<string, any>) => void;
  onClearAll: () => void;
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Låg',
  medium: 'Medium',
  high: 'Hög',
  critical: 'Kritisk',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Öppen',
  'in-progress': 'Pågående',
  waiting: 'Väntar',
  resolved: 'Löst',
  closed: 'Stängd',
};

const CHECKLIST_LABELS: Record<string, string> = {
  has_checklist: 'Med checklista',
  no_checklist: 'Utan checklista',
};

export function ActiveFilterChips({
  selectedStatuses,
  priorityFilter,
  categoryFilter,
  selectedTagIds,
  tagMode,
  checklistFilter,
  dateFrom,
  dateTo,
  dateField,
  hideStatus = false,
  onRemove,
  onClearAll,
}: ActiveFilterChipsProps) {
  const { categories } = useCategories();
  const { tags } = useTags();

  // Count active filters to determine if we should render anything
  const statusCount = hideStatus ? 0 : selectedStatuses.length;
  const hasPriority = priorityFilter && priorityFilter !== 'all';
  const hasCategory = categoryFilter && categoryFilter !== 'all';
  const hasChecklist = Boolean(checklistFilter);
  const hasDate = Boolean(dateFrom || dateTo);
  const tagCount = selectedTagIds.length;

  const totalActive =
    statusCount +
    (hasPriority ? 1 : 0) +
    (hasCategory ? 1 : 0) +
    tagCount +
    (hasChecklist ? 1 : 0) +
    (hasDate ? 1 : 0);

  if (totalActive === 0) {
    return null;
  }

  const categoryLabel = categories.find((c) => c.id === categoryFilter)?.label || categoryFilter;
  const selectedTags = tags.filter((t) => selectedTagIds.includes(t.id));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Status chips */}
      {!hideStatus &&
        selectedStatuses.map((status) => (
          <Badge
            key={status}
            variant="secondary"
            className="flex items-center gap-1 pr-1 border border-primary text-xs font-semibold"
          >
            <span className="text-muted-foreground">Status:</span>
            {STATUS_LABELS[status] || status}
            <button
              onClick={() =>
                onRemove({ status: selectedStatuses.filter((s) => s !== status) })
              }
              className="ml-1 rounded-sm hover:text-destructive p-0.5"
              aria-label={`Ta bort statusfilter ${status}`}
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}

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

      {/* Tag chips with AND/OR toggle */}
      {selectedTags.map((tag, index) => (
        <Fragment key={tag.id}>
          {index > 0 && selectedTagIds.length > 1 && (
            <button
              onClick={() => onRemove({ tagMode: tagMode === 'or' ? 'and' : 'or' })}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground px-1 transition-colors"
              title={
                tagMode === 'or'
                  ? 'Klicka for att byta till AND (maste ha alla taggar)'
                  : 'Klicka for att byta till OR (racker med en tagg)'
              }
            >
              {tagMode === 'or' ? 'ELLER' : 'OCH'}
            </button>
          )}
          <Badge
            variant="secondary"
            className="flex items-center gap-1 pr-1 border border-primary text-xs font-semibold"
            style={{ borderColor: tag.color }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
            {tag.name}
            <button
              onClick={() =>
                onRemove({ tags: selectedTagIds.filter((id) => id !== tag.id) })
              }
              className="ml-1 rounded-sm hover:text-destructive p-0.5"
              aria-label={`Ta bort taggfilter ${tag.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        </Fragment>
      ))}

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
          <span className="text-muted-foreground">Datum:</span>
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
