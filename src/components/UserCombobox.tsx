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
import { User } from '@/types/ticket';

interface UserComboboxProps {
  users: User[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}

export const UserCombobox = ({
  users,
  value,
  onValueChange,
  placeholder = 'Välj användare',
}: UserComboboxProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
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
            placeholder="Sök användare..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 border-0 bg-transparent p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {filteredUsers.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {users.length === 0
                ? 'Inga användare tillgängliga'
                : 'Ingen användare hittades'}
            </div>
          ) : (
            filteredUsers.map((user) => (
              <div
                key={user.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60',
                  value === user.id && 'bg-muted/60'
                )}
                onClick={() => {
                  onValueChange(user.id);
                  setOpen(false);
                  setSearch('');
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
