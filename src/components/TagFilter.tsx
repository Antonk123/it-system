import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTags } from '@/hooks/useTags';

interface TagFilterProps {
  selectedTagIds: string[];
  onRemoveTag: (tagId: string) => void;
  onClearAll: () => void;
}

export function TagFilter({ selectedTagIds, onRemoveTag, onClearAll }: TagFilterProps) {
  const { tags } = useTags();

  if (selectedTagIds.length === 0) {
    return null;
  }

  const selectedTags = tags.filter(tag => selectedTagIds.includes(tag.id));

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-muted/50 rounded-lg border">
      <span className="text-sm font-medium text-muted-foreground">
        Filtrerar på taggar:
      </span>
      {selectedTags.map(tag => (
        <Badge
          key={tag.id}
          variant="secondary"
          className="flex items-center gap-1 pr-1"
          style={{ borderColor: tag.color }}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
          <button
            onClick={() => onRemoveTag(tag.id)}
            className="ml-1 rounded-sm hover:bg-muted p-0.5"
            aria-label={`Ta bort filter för ${tag.name}`}
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearAll}
        className="h-6 px-2 text-xs"
      >
        Rensa alla
      </Button>
    </div>
  );
}
