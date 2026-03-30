import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Template } from '@/types/ticket';

interface TemplateComboboxProps {
  templates: Template[];
  selectedTemplate: Template | null;
  onSelect: (template: Template) => void;
  onClear: () => void;
  placeholder?: string;
}

export const TemplateCombobox = ({
  templates,
  selectedTemplate,
  onSelect,
  onClear,
  placeholder = 'Ingen mall',
}: TemplateComboboxProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredTemplates = useMemo(() => {
    if (!search) return templates;
    const lowerSearch = search.toLowerCase();
    return templates.filter((t) =>
      t.name.toLowerCase().includes(lowerSearch)
    );
  }, [templates, search]);

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            {selectedTemplate ? selectedTemplate.name : placeholder}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0 bg-popover border border-border z-50" align="start">
          <div className="flex items-center border-b px-3 py-2">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Input
              placeholder="Sök mall..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 border-0 bg-transparent p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filteredTemplates.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {templates.length === 0
                  ? 'Inga mallar tillgängliga'
                  : 'Inga resultat'}
              </div>
            ) : (
              filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60',
                    selectedTemplate?.id === template.id && 'bg-muted/60'
                  )}
                  onClick={() => {
                    onSelect(template);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0',
                      selectedTemplate?.id === template.id
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{template.name}</span>
                    {template.description && (
                      <span className="text-xs text-muted-foreground truncate">
                        {template.description}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      {selectedTemplate !== null && (
        <button
          type="button"
          className="text-xs text-accent hover:text-accent/80 mt-1"
          onClick={onClear}
        >
          Rensa mall
        </button>
      )}
    </div>
  );
};
