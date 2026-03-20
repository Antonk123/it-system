import { Fragment } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTags } from '@/hooks/useTags';

interface TagFilterProps {
  selectedTagIds: string[];
  tagMode?: 'or' | 'and';
  onRemoveTag: (tagId: string) => void;
  onClearAll: () => void;
  onTagModeChange?: (mode: 'or' | 'and') => void;
}

export function TagFilter({ selectedTagIds, tagMode = 'or', onRemoveTag, onClearAll, onTagModeChange }: TagFilterProps) {
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
      {selectedTags.map((tag, index) => (
        <Fragment key={tag.id}>
          {index > 0 && onTagModeChange && selectedTagIds.length > 1 && (
            <button
              onClick={() => onTagModeChange(tagMode === 'or' ? 'and' : 'or')}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground px-1 transition-colors"
              title={tagMode === 'or' ? 'Klicka för att byta till AND (måste ha alla taggar)' : 'Klicka för att byta till OR (räcker med en tagg)'}
            >
              {tagMode === 'or' ? 'ELLER' : 'OCH'}
            </button>
          )}
          <Badge
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
        </Fragment>
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
