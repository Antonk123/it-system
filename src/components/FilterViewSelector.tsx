import { FilterView } from '@/types/filterView';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
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
  const defaultViews = views.filter((v) => v.isDefault);
  const customViews = views.filter((v) => !v.isDefault);

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
        {defaultViews.length > 0 && (
          <SelectGroup>
            <SelectLabel>Standard vyer</SelectLabel>
            {defaultViews.map((view) => (
              <SelectItem key={view.id} value={view.id}>
                {view.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {customViews.length > 0 && (
          <>
            {defaultViews.length > 0 && <SelectSeparator />}
            <SelectGroup>
              <SelectLabel>Mina vyer</SelectLabel>
              {customViews.map((view) => (
                <SelectItem key={view.id} value={view.id}>
                  {view.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
        <SelectSeparator />
        <SelectItem value="custom" disabled>
          Anpassad vy
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
