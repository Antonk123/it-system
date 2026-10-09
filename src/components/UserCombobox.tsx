import { useEffect, useId, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { User } from '@/types/ticket';

interface UserComboboxProps {
  users: User[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}

export const UserCombobox = ({
  users,
  value,
  onValueChange,
  placeholder = 'Välj kontakt',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: UserComboboxProps) => {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredUsers = useMemo(() => {
    if (!search) return users;
    const lowerSearch = search.toLowerCase();
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(lowerSearch) ||
        user.email.toLowerCase().includes(lowerSearch) ||
        (user.department?.toLowerCase().includes(lowerSearch) ?? false)
    );
  }, [users, search]);

  const selectedUser = users.find((u) => u.id === value);

  // Reset the highlight whenever the option set changes (search typed, popover reopened).
  useEffect(() => {
    setActiveIndex(0);
  }, [open, search]);

  const selectUser = (id: string) => {
    onValueChange(id);
    setOpen(false);
    setSearch('');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (filteredUsers.length === 0 ? 0 : (prev + 1) % filteredUsers.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        filteredUsers.length === 0 ? 0 : (prev - 1 + filteredUsers.length) % filteredUsers.length
      );
    } else if (e.key === 'Enter') {
      const user = filteredUsers[activeIndex];
      if (user) {
        e.preventDefault();
        selectUser(user.id);
      }
    }
  };

  const activeDescendant = filteredUsers[activeIndex] ? `${listboxId}-opt-${filteredUsers[activeIndex].id}` : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-label="Beställare"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-required={ariaRequired}
          className="w-full justify-between font-normal"
        >
          {selectedUser ? selectedUser.name : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0 bg-popover border border-border z-50" align="start">
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            placeholder="Sök kontakt..."
            aria-label="Sök kontakt"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeDescendant}
            aria-autocomplete="list"
            className="h-8 border-0 bg-transparent p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div id={listboxId} role="listbox" aria-label="Kontakter" className="max-h-60 overflow-y-auto">
          {filteredUsers.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {users.length === 0
                ? 'Inga kontakter tillgängliga'
                : 'Ingen kontakt hittades'}
            </div>
          ) : (
            filteredUsers.map((user, i) => (
              <div
                key={user.id}
                id={`${listboxId}-opt-${user.id}`}
                role="option"
                aria-selected={value === user.id}
                tabIndex={-1}
                onMouseMove={() => setActiveIndex(i)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60',
                  value === user.id && 'bg-muted/60',
                  activeIndex === i && 'bg-muted/60'
                )}
                onClick={() => selectUser(user.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectUser(user.id);
                  }
                }}
              >
                <Check
                  className={cn(
                    'h-4 w-4 shrink-0',
                    value === user.id ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{user.name}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {user.email}
                    {user.department && ` • ${user.department}`}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
