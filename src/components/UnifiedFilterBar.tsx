import { useState } from 'react';
import { TicketPriority } from '@/types/ticket';
import { SearchBar } from '@/components/SearchBar';
import { DateRangePopover } from '@/components/DateRangePopover';
import { ActiveFilterChips } from '@/components/ActiveFilterChips';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { useCategories } from '@/hooks/useCategories';
import type { ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';

interface UnifiedFilterBarProps {
  // Current filter values (from URL params in parent)
  companyControl?: ReactNode;
  companyActive?: boolean;
  search: string;
  mine: boolean;
  onMineChange: (mine: boolean) => void;
  priorityFilter: TicketPriority | 'all';
  categoryFilter: string;
  checklistFilter: string;
  dateFrom: string;
  dateTo: string;
  dateField: 'created_at' | 'updated_at' | 'closed_at';

  // Page-specific overrides
  hideDateFieldSelector?: boolean; // true on Archive (per D-06)

  // Single onChange handler — parent updates URL
  onChange: (updates: Record<string, any>) => void;
  onClearAll: () => void;

  // Search placeholder customization
  searchPlaceholder?: string;
}

export function UnifiedFilterBar({
  companyControl,
  companyActive = false,
  search,
  mine,
  onMineChange,
  priorityFilter,
  categoryFilter,
  checklistFilter,
  dateFrom,
  dateTo,
  dateField,
  hideDateFieldSelector = false,
  onChange,
  onClearAll,
  searchPlaceholder = 'Sök ärenden...',
}: UnifiedFilterBarProps) {
  const { categories } = useCategories();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Helper to get priority label
  const getPriorityLabel = (value: string) => {
    switch(value) {
      case 'all': return 'Alla';
      case 'low': return 'Låg';
      case 'medium': return 'Medium';
      case 'high': return 'Hög';
      case 'critical': return 'Kritisk';
      default: return 'Alla';
    }
  };

  // Helper to get category label
  const getCategoryLabel = (value: string) => {
    if (value === 'all') return 'Alla';
    const category = categories.find(c => c.id === value);
    return category?.label || 'Alla';
  };

  // Helper to get checklist label
  const getChecklistLabel = (value: string) => {
    switch(value) {
      case 'all': return 'Alla';
      case '': return 'Alla';
      case 'has_checklist': return 'Med checklista';
      case 'no_checklist': return 'Utan checklista';
      default: return 'Alla';
    }
  };

  // Count active filters (excluding search) for mobile badge
  const activeFilterCount = [
    companyActive,
    priorityFilter !== 'all',
    categoryFilter !== 'all',
    checklistFilter !== '' && checklistFilter !== 'all',
    dateFrom !== '',
    dateTo !== '',
  ].filter(Boolean).length;

  const filterControls = (
    <>
      {companyControl}
      {/* 3. Priority Select */}
      <Select
        value={priorityFilter}
        onValueChange={(value) => onChange({ priority: value })}
      >
        <SelectTrigger className="w-full md:w-[160px]">
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">Prioritet:</span>
            <span>{getPriorityLabel(priorityFilter)}</span>
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alla</SelectItem>
          <SelectItem value="low">Låg</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="high">Hög</SelectItem>
          <SelectItem value="critical">Kritisk</SelectItem>
        </SelectContent>
      </Select>

      {/* 4. Category Select */}
      <Select
        value={categoryFilter}
        onValueChange={(value) => onChange({ category: value })}
      >
        <SelectTrigger className="w-full md:w-[170px]">
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">Kategori:</span>
            <span>{getCategoryLabel(categoryFilter)}</span>
          </span>
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


      {/* 6. Checklist Select */}
      <Select
        value={checklistFilter || 'all'}
        onValueChange={(value) => onChange({ checklist: value === 'all' ? '' : value })}
      >
        <SelectTrigger className="w-full md:w-[210px]">
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">Checklista:</span>
            <span>{getChecklistLabel(checklistFilter || 'all')}</span>
          </span>
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

    </>
  );

  return (
    <div className="space-y-2">
      {/* Search + mobile filter toggle */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <SearchBar
            value={search}
            onChange={(value) => onChange({ search: value })}
            placeholder={searchPlaceholder}
          />
        </div>
        <Button variant={mine ? 'secondary' : 'outline'} aria-pressed={mine} onClick={() => onMineChange(!mine)} className="min-h-11 shrink-0">Bara mina</Button>
        {(
          <Button
            variant={filtersOpen ? 'secondary' : 'outline'}
            size="sm"
            className="min-h-11 shrink-0 gap-2"
            onClick={() => setFiltersOpen(!filtersOpen)}
            title="Filter"
            aria-label={`Filter${activeFilterCount > 0 ? ` (${activeFilterCount} aktiva)` : ''}`}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
        )}
      </div>

      {filtersOpen && <div className="flex flex-wrap items-center gap-2">{filterControls}</div>}
      {!filtersOpen && activeFilterCount > 0 && <p className="text-xs text-muted-foreground">{activeFilterCount} filter aktiva <Button variant="link" onClick={onClearAll}>Rensa filter</Button></p>}

      {/* Chip row */}
      <ActiveFilterChips
        priorityFilter={priorityFilter}
        categoryFilter={categoryFilter}
        checklistFilter={checklistFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        dateField={dateField}
        onRemove={onChange}
        onClearAll={onClearAll}
      />
    </div>
  );
}
