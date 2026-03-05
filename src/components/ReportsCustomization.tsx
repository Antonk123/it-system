import { useState } from 'react';
import { Settings, Eye, EyeOff, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';
import { Button } from './ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet';
import { useReportsPreferences, type ReportModuleId } from '@/hooks/useReportsPreferences';
import { cn } from '@/lib/utils';

export const ReportsCustomization = () => {
  const [open, setOpen] = useState(false);
  const { preferences, toggleModule, moveModule, resetPreferences, toggleAll } =
    useReportsPreferences();

  const visibleCount = preferences.modules.filter(m => m.visible).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Settings className="h-4 w-4" />
          <span className="hidden sm:inline">Customize</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Customize Reports</SheetTitle>
          <SheetDescription>
            Show, hide, or reorder report sections to your preference
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Quick Actions */}
          <div className="flex items-center justify-between gap-2 pb-4 border-b">
            <span className="text-sm text-muted-foreground">
              {visibleCount} of {preferences.modules.length} visible
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAll(true)}
                disabled={visibleCount === preferences.modules.length}
              >
                Show All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAll(false)}
                disabled={visibleCount === 0}
              >
                Hide All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={resetPreferences}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Module List */}
          <div className="space-y-2">
            {preferences.modules.map((module, index) => (
              <div
                key={module.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                  module.visible ? 'bg-card' : 'bg-muted/50 opacity-60'
                )}
              >
                {/* Visibility Toggle */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 flex-shrink-0"
                  onClick={() => toggleModule(module.id as ReportModuleId)}
                >
                  {module.visible ? (
                    <Eye className="h-4 w-4 text-primary" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>

                {/* Module Info */}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'font-medium text-sm',
                    !module.visible && 'text-muted-foreground'
                  )}>
                    {module.label}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {module.description}
                  </p>
                </div>

                {/* Reorder Controls */}
                <div className="flex flex-col gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => moveModule(module.id as ReportModuleId, 'up')}
                    disabled={index === 0}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => moveModule(module.id as ReportModuleId, 'down')}
                    disabled={index === preferences.modules.length - 1}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Info */}
          <div className="pt-4 text-xs text-muted-foreground border-t">
            <p>💡 Tip: Changes are saved automatically and persist across sessions.</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
