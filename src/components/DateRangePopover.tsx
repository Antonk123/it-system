import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';

interface DateRangePopoverProps {
  dateFrom: string;
  dateTo: string;
  dateField: 'created_at' | 'updated_at' | 'closed_at';
  hideDateFieldSelector?: boolean; // true on Archive (per D-06)
  onChange: (updates: Record<string, any>) => void;
}

const DATE_FIELD_OPTIONS: { value: 'created_at' | 'updated_at' | 'closed_at'; label: string }[] = [
  { value: 'created_at', label: 'Skapad' },
  { value: 'updated_at', label: 'Uppdaterad' },
  { value: 'closed_at', label: 'Stängd' },
];

export function DateRangePopover({
  dateFrom,
  dateTo,
  dateField,
  hideDateFieldSelector = false,
  onChange,
}: DateRangePopoverProps) {
  const [open, setOpen] = useState(false);

  const hasActiveDate = Boolean(dateFrom || dateTo);

  const getDateFieldLabel = () => {
    const field = DATE_FIELD_OPTIONS.find(f => f.value === dateField);
    return field?.label || 'Skapad';
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10 gap-2">
          {hasActiveDate && (
            <span className="w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
          )}
          <Calendar className="w-4 h-4" />
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">Datum:</span>
            <span className="text-xs">{getDateFieldLabel()}</span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-4 space-y-4" align="start">
        {!hideDateFieldSelector && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Datumfält</Label>
            <div className="flex gap-2">
              {DATE_FIELD_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={dateField === option.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onChange({ dateField: option.value })}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="date-from" className="text-xs text-muted-foreground">
            Från
          </Label>
          <input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="date-to" className="text-xs text-muted-foreground">
            Till
          </Label>
          <input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => onChange({ dateTo: e.target.value })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {hasActiveDate && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => onChange({ dateFrom: '', dateTo: '', dateField: 'created_at' })}
          >
            Rensa datum
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
