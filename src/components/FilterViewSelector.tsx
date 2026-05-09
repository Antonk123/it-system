import { FilterView } from '@/types/filterView';
import { Star } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui/select';

interface FilterViewSelectorProps {
  views: FilterView[];
  activeViewId: string | null;
  onSelectView: (viewId: string) => void;
}

export function FilterViewSelector({
  views,
  activeViewId,
  onSelectView,
}: FilterViewSelectorProps) {
  const activeView = views.find((v) => v.id === activeViewId);
  const displayValue = activeView?.name || 'Anpassad vy';

  return (
    <Select value={activeViewId || 'custom'} onValueChange={onSelectView}>
      <SelectTrigger className="w-[200px]">
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">Vy:</span>
          <span>{displayValue}</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Vyer</SelectLabel>
          {views.map((view) => (
            <SelectItem key={view.id} value={view.id}>
              <span className="flex items-center gap-1.5">
                {view.isDefault && <Star className="w-3 h-3 fill-current text-primary shrink-0" />}
                {view.name}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value="custom" disabled>
          Anpassad vy
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
