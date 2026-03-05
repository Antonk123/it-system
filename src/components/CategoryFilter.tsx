import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCategories } from '@/hooks/useCategories';

interface CategoryFilterProps {
  selectedCategoryId: string | null;
  onRemoveCategory: () => void;
}

export function CategoryFilter({ selectedCategoryId, onRemoveCategory }: CategoryFilterProps) {
  const { getCategoryLabel } = useCategories();

  if (!selectedCategoryId || selectedCategoryId === 'all') {
    return null;
  }

  const categoryLabel = getCategoryLabel(selectedCategoryId);

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-muted/50 rounded-lg border">
      <span className="text-sm font-medium text-muted-foreground">
        Filtrerar på kategori:
      </span>
      <Badge
        variant="secondary"
        className="flex items-center gap-1 pr-1"
      >
        {categoryLabel}
        <button
          onClick={onRemoveCategory}
          className="ml-1 rounded-sm hover:bg-muted p-0.5"
          aria-label={`Ta bort filter för ${categoryLabel}`}
        >
          <X className="w-3 h-3" />
        </button>
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemoveCategory}
        className="h-6 px-2 text-xs"
      >
        Rensa
      </Button>
    </div>
  );
}
