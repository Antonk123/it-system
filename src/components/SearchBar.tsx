import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/useDebounce';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

export const SearchBar = ({ value, onChange, placeholder = 'Sök...', ariaLabel }: SearchBarProps) => {
  // Local input state keeps typing responsive; the debounced value is what
  // actually propagates upward (and from there into the backend query), so
  // every keystroke doesn't trigger a COUNT+SELECT round-trip.
  const [localValue, setLocalValue] = useState(value);
  const debouncedValue = useDebounce(localValue, 200);

  // Push the debounced value upward once it settles.
  useEffect(() => {
    if (debouncedValue !== value) {
      onChange(debouncedValue);
    }
    // onChange is intentionally omitted — callers pass inline/unstable
    // functions, and including it would re-fire this effect on every
    // parent render regardless of the debounced value actually changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue]);

  // Keep local state in sync with external changes (e.g. "clear filters"
  // or a filter view being applied) that don't originate from typing here.
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
      <Input
        type="search"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        className="pl-10"
      />
    </div>
  );
};
