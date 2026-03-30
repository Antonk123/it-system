import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Category } from '@/types/ticket';

interface CategoryComboboxProps {
  categories: Category[];
  value: string;
  onValueChange: (value: string) => void;
  onAddCategory: (label: string) => Promise<void>;
  placeholder?: string;
}

export const CategoryCombobox = ({
  categories,
  value,
  onValueChange,
  onAddCategory,
  placeholder = 'Välj kategori',
}: CategoryComboboxProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const filteredCategories = useMemo(() => {
    if (!search) return categories;
    const lowerSearch = search.toLowerCase();
    return categories.filter((cat) =>
      cat.label.toLowerCase().includes(lowerSearch)
    );
  }, [categories, search]);

  const selectedCategory = categories.find((c) => c.id === value);

  const displayLabel =
    value === 'none'
      ? 'Ingen kategori'
      : selectedCategory
      ? selectedCategory.label
      : placeholder;

  const handleAddCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed || isAdding) return;
    setIsAdding(true);
    try {
      await onAddCategory(trimmed);
      setNewCategoryName('');
      setShowNewInput(false);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {displayLabel}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0 bg-popover border border-border z-50" align="start">
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            placeholder="Sök kategori..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 border-0 bg-transparent p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {/* Hardcoded "Ingen kategori" option */}
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60',
              value === 'none' && 'bg-muted/60'
            )}
            onClick={() => {
              onValueChange('none');
              setOpen(false);
              setSearch('');
            }}
          >
            <Check
              className={cn(
                'h-4 w-4 shrink-0',
                value === 'none' ? 'opacity-100' : 'opacity-0'
              )}
            />
            <span className="text-muted-foreground">Ingen kategori</span>
          </div>

          {filteredCategories.length === 0 && search ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Inga resultat
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Inga kategorier
            </div>
          ) : (
            filteredCategories.map((cat) => (
              <div
                key={cat.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60',
                  value === cat.id && 'bg-muted/60'
                )}
                onClick={() => {
                  onValueChange(cat.id);
                  setOpen(false);
                  setSearch('');
                }}
              >
                <Check
                  className={cn(
                    'h-4 w-4 shrink-0',
                    value === cat.id ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <span>{cat.label}</span>
              </div>
            ))
          )}
        </div>

        {/* Footer: "Ny kategori" inline creation */}
        <div className="border-t border-border/40">
          {!showNewInput ? (
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60 text-sm"
              onClick={() => setShowNewInput(true)}
            >
              <PlusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>Ny kategori...</span>
            </div>
          ) : (
            <div className="flex gap-2 p-2">
              <Input
                autoFocus
                placeholder="Kategorinamn..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCategory();
                  } else if (e.key === 'Escape') {
                    setShowNewInput(false);
                    setNewCategoryName('');
                  }
                }}
                disabled={isAdding}
                className="h-8 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddCategory}
                disabled={isAdding || !newCategoryName.trim()}
                className="shrink-0 h-8 text-xs"
              >
                Lägg till
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
