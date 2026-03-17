import { useState } from 'react';
import { FilterView } from '@/types/filterView';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';

interface FilterViewManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  views: FilterView[];
  currentFilters: Omit<FilterView, 'id' | 'createdAt' | 'updatedAt'>;
  onCreateView: (view: Omit<FilterView, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onDeleteView: (id: string) => void;
}

export function FilterViewManager({
  open,
  onOpenChange,
  views,
  currentFilters,
  onCreateView,
  onDeleteView,
}: FilterViewManagerProps) {
  const [newViewName, setNewViewName] = useState('');
  const customViews = views.filter((v) => !v.isDefault);

  const handleCreateView = () => {
    if (!newViewName.trim()) {
      toast.error('Vänligen ange ett namn för vyn');
      return;
    }

    // Check if name already exists
    if (views.some((v) => v.name.toLowerCase() === newViewName.trim().toLowerCase())) {
      toast.error('En vy med detta namn finns redan');
      return;
    }

    onCreateView({
      ...currentFilters,
      name: newViewName.trim(),
    });

    setNewViewName('');
    toast.success(`Vyn "${newViewName}" har skapats`);
  };

  const handleDeleteView = (id: string, name: string) => {
    if (confirm(`Är du säker på att du vill ta bort vyn "${name}"?`)) {
      onDeleteView(id);
      toast.success(`Vyn "${name}" har tagits bort`);
    }
  };

  const hasFilters =
    (currentFilters.filters.status && currentFilters.filters.status.length > 0) ||
    currentFilters.filters.priority ||
    currentFilters.filters.category ||
    (currentFilters.filters.tags && currentFilters.filters.tags.length > 0) ||
    currentFilters.filters.search;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Hantera vyer</DialogTitle>
          <DialogDescription>
            Skapa, redigera och ta bort dina sparade filtervyer
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Create new view */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Spara nuvarande filter som vy</h3>
            {hasFilters ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Aktiva filter:</p>
                  <ul className="list-disc list-inside">
                    {currentFilters.filters.status && currentFilters.filters.status.length > 0 && (
                      <li>Status: {currentFilters.filters.status.join(', ')}</li>
                    )}
                    {currentFilters.filters.priority && (
                      <li>Prioritet: {currentFilters.filters.priority}</li>
                    )}
                    {currentFilters.filters.category && (
                      <li>Kategori: {currentFilters.filters.category}</li>
                    )}
                    {currentFilters.filters.tags && currentFilters.filters.tags.length > 0 && (
                      <li>Taggar: {currentFilters.filters.tags.length} valda</li>
                    )}
                    {currentFilters.filters.search && (
                      <li>Sök: "{currentFilters.filters.search}"</li>
                    )}
                  </ul>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="view-name" className="sr-only">
                      Namn på vy
                    </Label>
                    <Input
                      id="view-name"
                      placeholder="Namn på vy..."
                      value={newViewName}
                      onChange={(e) => setNewViewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCreateView();
                        }
                      }}
                    />
                  </div>
                  <Button onClick={handleCreateView} size="sm" className="gap-2">
                    <Save className="w-4 h-4" />
                    Spara
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Inga aktiva filter att spara. Välj några filter i ärendelistan först.
              </p>
            )}
          </div>

          {/* List of custom views */}
          {customViews.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Mina sparade vyer</h3>
              <div className="space-y-2">
                {customViews.map((view) => (
                  <div
                    key={view.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium">{view.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {view.filters.status && view.filters.status.length > 0 && (
                          <span>Status: {view.filters.status.join(', ')}</span>
                        )}
                        {view.filters.priority && (
                          <span>
                            {view.filters.status && view.filters.status.length > 0 ? ' • ' : ''}
                            Prioritet: {view.filters.priority}
                          </span>
                        )}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteView(view.id, view.name)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {customViews.length === 0 && !hasFilters && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Du har inga sparade vyer ännu. Börja med att välja filter i ärendelistan och
              spara dem som en vy.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
