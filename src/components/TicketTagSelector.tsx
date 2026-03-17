import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Tag as TagIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { api } from '@/lib/api';
import { useTags } from '@/hooks/useTags';
import { Tag } from '@/types/ticket';

const DEFAULT_NEW_TAG_COLOR = '#6366f1';

interface TicketTagSelectorProps {
  ticketId: string;
}

export const TicketTagSelector = ({ ticketId }: TicketTagSelectorProps) => {
  const queryClient = useQueryClient();
  const { tags: allTags, createTag } = useTags();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: ticketTags = [] } = useQuery({
    queryKey: ['ticket-tags', ticketId],
    queryFn: async () => {
      const data = await api.getTicketTags(ticketId);
      return data.map((t): Tag => ({ id: t.id, name: t.name, color: t.color }));
    },
    staleTime: 1000 * 30,
  });

  const setTags = useCallback(
    async (newIds: string[]) => {
      setSaving(true);
      try {
        const updated = await api.setTicketTags(ticketId, newIds);
        queryClient.setQueryData(
          ['ticket-tags', ticketId],
          updated.map((t): Tag => ({ id: t.id, name: t.name, color: t.color }))
        );
      } finally {
        setSaving(false);
      }
    },
    [ticketId, queryClient]
  );

  const addTag = async (tag: Tag) => {
    if (ticketTags.some((t) => t.id === tag.id)) return;
    await setTags([...ticketTags.map((t) => t.id), tag.id]);
    setOpen(false);
    setSearch('');
  };

  const removeTag = async (tagId: string) => {
    await setTags(ticketTags.filter((t) => t.id !== tagId).map((t) => t.id));
  };

  const handleCreateAndAdd = async () => {
    const name = search.trim();
    if (!name) return;
    const created = await createTag(name, DEFAULT_NEW_TAG_COLOR);
    if (created) {
      await setTags([...ticketTags.map((t) => t.id), created.id]);
    }
    setOpen(false);
    setSearch('');
  };

  const filteredTags = allTags.filter(
    (t) =>
      !ticketTags.some((tt) => tt.id === t.id) &&
      t.name.toLowerCase().includes(search.toLowerCase())
  );

  const exactMatch = allTags.some(
    (t) => t.name.toLowerCase() === search.trim().toLowerCase()
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ticketTags.map((tag) => (
        <Badge
          key={tag.id}
          variant="outline"
          className="flex items-center gap-1 pr-1 text-xs font-normal"
          style={{ borderColor: tag.color, color: tag.color }}
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
          <button
            onClick={() => removeTag(tag.id)}
            disabled={saving}
            className="ml-0.5 rounded-sm hover:bg-muted/50 p-0.5 transition-colors"
            aria-label={`Ta bort tagg ${tag.name}`}
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-6 w-6 p-0 rounded-full border-dashed"
            disabled={saving}
            aria-label="Lägg till tagg"
          >
            <Plus className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-52" align="start">
          <Command>
            <CommandInput
              placeholder="Sök tagg..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {filteredTags.length === 0 && search.trim() === '' && (
                <div className="py-3 px-3 text-xs text-muted-foreground flex items-center gap-2">
                  <TagIcon className="w-3.5 h-3.5" />
                  Inga fler taggar att lägga till
                </div>
              )}
              {filteredTags.length > 0 && (
                <CommandGroup>
                  {filteredTags.map((tag) => (
                    <CommandItem
                      key={tag.id}
                      value={tag.name}
                      onSelect={() => addTag(tag)}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {search.trim() !== '' && !exactMatch && (
                <CommandGroup>
                  <CommandItem
                    value={`__create__${search}`}
                    onSelect={handleCreateAndAdd}
                    className="flex items-center gap-2 cursor-pointer text-muted-foreground"
                  >
                    <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                    Skapa tagg &ldquo;{search.trim()}&rdquo;
                  </CommandItem>
                </CommandGroup>
              )}
              {search.trim() !== '' && exactMatch && filteredTags.length === 0 && (
                <CommandEmpty>Taggen finns redan och är tillagd</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
