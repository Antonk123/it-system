import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import { Tag } from '@/types/ticket';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface TagSelectorProps {
  selectedTagIds?: string[];
  preloadedTags?: Tag[];  // Already-resolved tag objects from ticket data
  onTagsChange: (tagIds: string[]) => void;
  label?: string;
}

const PREDEFINED_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#6366f1', // indigo
  '#14b8a6', // teal
];

export function TagSelector({ selectedTagIds = [], preloadedTags, onTagsChange, label = 'Tags' }: TagSelectorProps) {
  const { tags, createTag, isCreating } = useTags();
  const [isOpen, setIsOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PREDEFINED_COLORS[0]);

  // Use preloaded tag objects if available (avoids dependency on useTags loading timing)
  // Fall back to filtering from useTags for any IDs not in preloadedTags
  const selectedTags: Tag[] = selectedTagIds.map((id) => {
    const fromPreloaded = preloadedTags?.find((t) => t.id === id);
    const fromFetched = tags.find((t) => t.id === id);
    return fromPreloaded || fromFetched;
  }).filter(Boolean) as Tag[];

  const handleToggleTag = (tagId: string) => {
    const newIds = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];
    onTagsChange(newIds);
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    try {
      const newTag = await createTag({
        name: newTagName,
        color: selectedColor,
      });
      handleToggleTag(newTag.id);
      setNewTagName('');
      setSelectedColor(PREDEFINED_COLORS[0]);
    } catch (error) {
      console.error('Failed to create tag:', error);
    }
  };

  const handleRemoveTag = (tagId: string) => {
    handleToggleTag(tagId);
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {/* Selected tags display */}
      {selectedTags.length > 0 && (
        <div className="flex gap-2 flex-wrap p-2 bg-muted/50 rounded border">
          {selectedTags.map((tag) => (
            <div
              key={tag.id}
              style={{ backgroundColor: tag.color }}
              className="px-3 py-1 rounded-full text-sm font-medium text-white flex items-center gap-2"
            >
              {tag.name}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag.id)}
                className="hover:opacity-80 transition-opacity"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tag selector popover */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-start">
            <Plus size={16} className="mr-2" />
            {selectedTags.length === 0 ? 'Lägg till taggar' : 'Lägg till fler taggar'}
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-64 p-4">
          <div className="space-y-4">
            {/* Existing tags */}
            <div>
              <p className="text-sm font-semibold mb-2">Tillgängliga taggar</p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleToggleTag(tag.id)}
                    className="w-full flex items-center gap-2 p-2 rounded hover:bg-muted transition-colors text-left"
                  >
                    <div
                      style={{ backgroundColor: tag.color }}
                      className="w-3 h-3 rounded-full flex-shrink-0"
                    />
                    <span className="flex-1 text-sm">{tag.name}</span>
                    {selectedTagIds.includes(tag.id) && (
                      <Check size={16} className="text-green-600" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Create new tag */}
            <div className="border-t pt-3 space-y-2">
              <p className="text-sm font-semibold">Skapa ny tagg</p>
              <Input
                type="text"
                placeholder="Taggnamn"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateTag();
                  }
                }}
                className="text-sm"
              />

              <div>
                <p className="text-xs text-muted-foreground mb-2">Färg</p>
                <div className="flex gap-2 flex-wrap">
                  {PREDEFINED_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      style={{ backgroundColor: color }}
                      className={`w-6 h-6 rounded-full transition-all ${
                        selectedColor === color ? 'ring-2 ring-offset-2 ring-gray-400' : ''
                      }`}
                    />
                  ))}
                </div>
              </div>

              <Button
                type="button"
                onClick={handleCreateTag}
                disabled={!newTagName.trim() || isCreating}
                size="sm"
                className="w-full"
              >
                {isCreating ? 'Skapar...' : 'Skapa tagg'}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
