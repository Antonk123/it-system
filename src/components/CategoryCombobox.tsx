import { useMemo, useState, useEffect, useRef } from 'react';
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
  disabled?: boolean;
}

export const CategoryCombobox = ({
  categories,
  value,
  onValueChange,
  onAddCategory,
  placeholder = 'Välj kategori',
  disabled = false,
}: CategoryComboboxProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useRef(`category-listbox-${Math.random().toString(36).slice(2)}`).current;

  const filteredCategories = useMemo(() => {
    if (!search) return categories;
    const lowerSearch = search.toLowerCase();
    return categories.filter((cat) =>
      cat.label.toLowerCase().includes(lowerSearch)
    );
  }, [categories, search]);

  // Flat list of keyboard-navigable options in render order: the hardcoded
  // "Ingen kategori" entry first, then the filtered categories. Drives
  // aria-activedescendant + Up/Down arrow navigation on the search input.
  const navOptions = useMemo(
    () => [
      { id: 'none', domId: `${listboxId}-none`, value: 'none' as const },
      ...filteredCategories.map((cat) => ({
        id: cat.id,
        domId: `${listboxId}-opt-${cat.id}`,
        value: cat.id,
      })),
    ],
    [filteredCategories, listboxId]
  );

  // Reset/clamp the active option whenever the option set changes (search
  // typed, popover reopened) so the highlight never points past the list.
  useEffect(() => {
    setActiveIndex((prev) => (prev >= navOptions.length ? 0 : prev));
  }, [navOptions.length]);

  useEffect(() => {
    if (open) setActiveIndex(0);
  }, [open, search]);

  const selectOption = (optValue: string) => {
    onValueChange(optValue);
    setOpen(false);
    setSearch('');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (navOptions.length === 0 ? 0 : (prev + 1) % navOptions.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        navOptions.length === 0 ? 0 : (prev - 1 + navOptions.length) % navOptions.length
      );
    } else if (e.key === 'Enter') {
      const opt = navOptions[activeIndex];
      if (opt) {
        e.preventDefault();
        selectOption(opt.value);
      }
    }
  };

  const activeDescendant = navOptions[activeIndex]?.domId;

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
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
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
            onKeyDown={handleSearchKeyDown}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeDescendant}
            aria-autocomplete="list"
            className="h-8 border-0 bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-0"
          />
        </div>
        <div id={listboxId} role="listbox" className="max-h-60 overflow-y-auto overscroll-contain">
          {/* Hardcoded "Ingen kategori" option */}
          <div
            id={`${listboxId}-none`}
            role="option"
            aria-selected={value === 'none'}
            tabIndex={0}
            onMouseMove={() => setActiveIndex(0)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60',
              value === 'none' && 'bg-muted/60',
              activeIndex === 0 && 'bg-muted/60'
            )}
            onClick={() => selectOption('none')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectOption('none');
              }
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
            filteredCategories.map((cat, i) => {
              // navOptions index is offset by 1 (the "Ingen kategori" entry is 0).
              const navIdx = i + 1;
              return (
              <div
                key={cat.id}
                id={`${listboxId}-opt-${cat.id}`}
                role="option"
                aria-selected={value === cat.id}
                tabIndex={0}
                onMouseMove={() => setActiveIndex(navIdx)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60',
                  value === cat.id && 'bg-muted/60',
                  activeIndex === navIdx && 'bg-muted/60'
                )}
                onClick={() => selectOption(cat.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectOption(cat.id);
                  }
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
              );
            })
          )}
        </div>

        {/* Footer: "Ny kategori" inline creation */}
        <div className="border-t border-border/40">
          {!showNewInput ? (
            <div
              role="option"
              aria-selected={false}
              tabIndex={0}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60 text-sm"
              onClick={() => setShowNewInput(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setShowNewInput(true);
                }
              }}
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
