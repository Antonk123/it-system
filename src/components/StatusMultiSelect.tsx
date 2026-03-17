import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { TicketStatus } from '@/types/ticket';

interface StatusMultiSelectProps {
  selectedStatuses: TicketStatus[];
  onChange: (statuses: TicketStatus[]) => void;
}

const STATUS_OPTIONS: { value: TicketStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Öppen', color: '#22c55e' },
  { value: 'in-progress', label: 'Pågående', color: '#3b82f6' },
  { value: 'waiting', label: 'Väntar', color: '#f59e0b' },
  { value: 'resolved', label: 'Löst', color: '#8b5cf6' },
  { value: 'closed', label: 'Stängd', color: '#6b7280' },
];

export function StatusMultiSelect({ selectedStatuses, onChange }: StatusMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const toggleStatus = (status: TicketStatus) => {
    const newSelection = selectedStatuses.includes(status)
      ? selectedStatuses.filter(s => s !== status)
      : [...selectedStatuses, status];
    onChange(newSelection);
  };

  const selectedCount = selectedStatuses.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[140px] justify-between"
        >
          {selectedCount > 0 ? `${selectedCount} statusar` : 'Status'}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder="Sök status..." />
          <CommandList>
            <CommandEmpty>Ingen status hittades.</CommandEmpty>
            <CommandGroup>
              {STATUS_OPTIONS.map((status) => {
                const isSelected = selectedStatuses.includes(status.value);
                return (
                  <CommandItem
                    key={status.value}
                    value={status.label}
                    onSelect={() => toggleStatus(status.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        isSelected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span
                      className="w-2 h-2 rounded-full mr-2"
                      style={{ backgroundColor: status.color }}
                    />
                    {status.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
