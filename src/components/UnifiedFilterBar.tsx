import { FilterView } from '@/types/filterView';
import { TicketStatus, TicketPriority } from '@/types/ticket';
import { SearchBar } from '@/components/SearchBar';
import { StatusMultiSelect } from '@/components/StatusMultiSelect';
import { TagMultiSelect } from '@/components/TagMultiSelect';
import { DateRangePopover } from '@/components/DateRangePopover';
import { ActiveFilterChips } from '@/components/ActiveFilterChips';
import { FilterViewSelector } from '@/components/FilterViewSelector';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCategories } from '@/hooks/useCategories';
import { Settings2 } from 'lucide-react';

interface UnifiedFilterBarProps {
  // Current filter values (from URL params in parent)
  search: string;
  selectedStatuses: TicketStatus[];
  priorityFilter: TicketPriority | 'all';
  categoryFilter: string;
  selectedTagIds: string[];
  tagMode: 'or' | 'and';
  checklistFilter: string;
  dateFrom: string;
  dateTo: string;
  dateField: 'created_at' | 'updated_at' | 'closed_at';

  // Page-specific overrides
  hideStatus?: boolean;            // true on Archive (per D-05)
  hideDateFieldSelector?: boolean; // true on Archive (per D-06)

  // Filter preset integration
  views: FilterView[];
  activeViewId: string | null;
  onSelectView: (view: FilterView) => void;
  onManageViews: () => void;

  // Single onChange handler — parent updates URL
  onChange: (updates: Record<string, any>) => void;
  onClearAll: () => void;

  // Search placeholder customization
  searchPlaceholder?: string;
}

export function UnifiedFilterBar({
  search,
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
  hideDateFieldSelector = false,
  views,
  activeViewId,
  onSelectView,
  onManageViews,
  onChange,
  onClearAll,
  searchPlaceholder = 'Sok arenden...',
}: UnifiedFilterBarProps) {
  const { categories } = useCategories();

  const handleSelectViewById = (viewId: string) => {
    const view = views.find((v) => v.id === viewId);
    if (view) {
      onSelectView(view);
    }
  };

  return (
    <div className="space-y-2">
      {/* Filter control row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 1. Search */}
        <div className="flex-1 min-w-[200px]">
          <SearchBar
            value={search}
            onChange={(value) => onChange({ search: value })}
            placeholder={searchPlaceholder}
          />
        </div>

        {/* 2. Status — hidden on Archive */}
        {!hideStatus && (
          <StatusMultiSelect
            selectedStatuses={selectedStatuses}
            onChange={(statuses) => onChange({ status: statuses })}
          />
        )}

        {/* 3. Priority Select */}
        <Select
          value={priorityFilter}
          onValueChange={(value) => onChange({ priority: value })}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Prioritet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla</SelectItem>
            <SelectItem value="low">Lag</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">Hog</SelectItem>
            <SelectItem value="critical">Kritisk</SelectItem>
          </SelectContent>
        </Select>

        {/* 4. Category Select */}
        <Select
          value={categoryFilter}
          onValueChange={(value) => onChange({ category: value })}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Kategori" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 5. Tags */}
        <TagMultiSelect
          selectedTagIds={selectedTagIds}
          onChange={(tagIds) => onChange({ tags: tagIds })}
        />

        {/* 6. Checklist Select */}
        <Select
          value={checklistFilter || 'all'}
          onValueChange={(value) => onChange({ checklist: value === 'all' ? '' : value })}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Checklista" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla</SelectItem>
            <SelectItem value="has_checklist">Med checklista</SelectItem>
            <SelectItem value="no_checklist">Utan checklista</SelectItem>
          </SelectContent>
        </Select>

        {/* 7. Date Range Popover */}
        <DateRangePopover
          dateFrom={dateFrom}
          dateTo={dateTo}
          dateField={dateField}
          hideDateFieldSelector={hideDateFieldSelector}
          onChange={onChange}
        />

        {/* 8. Filter View Selector + Manage button */}
        <FilterViewSelector
          views={views}
          activeViewId={activeViewId}
          onSelectView={handleSelectViewById}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          onClick={onManageViews}
          title="Hantera vyer"
        >
          <Settings2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Chip row */}
      <ActiveFilterChips
        selectedStatuses={selectedStatuses}
        priorityFilter={priorityFilter}
        categoryFilter={categoryFilter}
        selectedTagIds={selectedTagIds}
        tagMode={tagMode}
        checklistFilter={checklistFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        dateField={dateField}
        hideStatus={hideStatus}
        onRemove={onChange}
        onClearAll={onClearAll}
      />
    </div>
  );
}
