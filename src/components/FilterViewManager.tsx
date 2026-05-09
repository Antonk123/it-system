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
import { Trash2, Save, Pencil, Check, X, Star } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface FilterViewManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  views: FilterView[];
  currentFilters: Omit<FilterView, 'id' | 'createdAt' | 'updatedAt'>;
  onCreateView: (view: Omit<FilterView, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateView: (id: string, updates: Partial<Omit<FilterView, 'id' | 'createdAt'>>) => void;
  onDeleteView: (id: string) => void;
  onSetDefault: (id: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

function FilterSummary({ filters }: { filters: FilterView['filters'] }) {
  const parts: string[] = [];
  if (filters.status && filters.status.length > 0) {
    parts.push(`Status: ${filters.status.map((s) => STATUS_LABELS[s] || s).join(', ')}`);
  }
  if (filters.priority && filters.priority !== 'all') parts.push(`Prioritet: ${filters.priority}`);
  if (filters.category && filters.category !== 'all') parts.push(`Kategori`);
  if (filters.tags && filters.tags.length > 0) parts.push(`${filters.tags.length} taggar`);
  if (filters.search) parts.push(`Sök: "${filters.search}"`);
  return <span className="text-xs text-muted-foreground">{parts.join(' · ') || 'Inga filter'}</span>;
}

export function FilterViewManager({
  open,
  onOpenChange,
  views,
  currentFilters,
  onCreateView,
  onUpdateView,
  onDeleteView,
  onSetDefault,
}: FilterViewManagerProps) {
  const [newViewName, setNewViewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const builtInView = views.find((v) => v.id === 'active-tickets');
  const customViews = views.filter((v) => v.id !== 'active-tickets');

  const handleCreateView = () => {
    if (!newViewName.trim()) {
      toast.error('Ange ett namn för vyn');
      return;
    }
    if (views.some((v) => v.name.toLowerCase() === newViewName.trim().toLowerCase())) {
      toast.error('En vy med detta namn finns redan');
      return;
    }
    onCreateView({ ...currentFilters, name: newViewName.trim() });
    setNewViewName('');
    toast.success(`Vyn "${newViewName.trim()}" skapad`);
  };

  const handleStartEdit = (view: FilterView) => {
    setEditingId(view.id);
    setEditName(view.name);
  };

  const handleSaveEdit = (id: string) => {
    if (!editName.trim()) {
      toast.error('Namnet får inte vara tomt');
      return;
    }
    if (views.some((v) => v.id !== id && v.name.toLowerCase() === editName.trim().toLowerCase())) {
      toast.error('En vy med detta namn finns redan');
      return;
    }
    onUpdateView(id, { name: editName.trim() });
    setEditingId(null);
    toast.success('Vyn uppdaterad');
  };

  const handleUpdateFilters = (id: string) => {
    onUpdateView(id, { filters: currentFilters.filters });
    toast.success('Vyns filter uppdaterade med nuvarande filter');
  };

  const handleDeleteView = (id: string, name: string) => {
    if (confirm(`Ta bort vyn "${name}"?`)) {
      onDeleteView(id);
      if (editingId === id) setEditingId(null);
      toast.success(`Vyn "${name}" borttagen`);
    }
  };

  const handleSetDefault = (id: string) => {
    onSetDefault(id);
    const view = views.find((v) => v.id === id);
    toast.success(`"${view?.name}" är nu standardvy`);
  };

  const hasFilters =
    (currentFilters.filters.status && currentFilters.filters.status.length > 0) ||
    currentFilters.filters.priority ||
    currentFilters.filters.category ||
    (currentFilters.filters.tags && currentFilters.filters.tags.length > 0) ||
    currentFilters.filters.search;

  const allViews = [builtInView, ...customViews].filter(Boolean) as FilterView[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Hantera vyer</DialogTitle>
          <DialogDescription>
            Skapa, redigera och välj standardvy för ärendelistan
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* All views list */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Vyer</h3>
            <div className="space-y-2">
              {allViews.map((view) => (
                <div
                  key={view.id}
                  className={cn(
                    'flex items-center gap-2 p-3 border rounded-lg transition-colors',
                    view.isDefault && 'border-primary/40 bg-primary/5'
                  )}
                >
                  {/* Default star */}
                  <button
                    onClick={() => handleSetDefault(view.id)}
                    className={cn(
                      'shrink-0 transition-colors',
                      view.isDefault
                        ? 'text-primary'
                        : 'text-muted-foreground/40 hover:text-muted-foreground'
                    )}
                    title={view.isDefault ? 'Standardvy' : 'Sätt som standard'}
                  >
                    <Star className={cn('w-4 h-4', view.isDefault && 'fill-current')} />
                  </button>

                  {/* Name / edit */}
                  <div className="flex-1 min-w-0">
                    {editingId === view.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(view.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="h-7 text-sm"
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => handleSaveEdit(view.id)}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-medium truncate">{view.name}</p>
                        <FilterSummary filters={view.filters} />
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {editingId !== view.id && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleStartEdit(view)}
                        title="Byt namn"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {hasFilters && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleUpdateFilters(view.id)}
                          title="Uppdatera med nuvarande filter"
                        >
                          <Save className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {view.id !== 'active-tickets' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteView(view.id, view.name)}
                          title="Ta bort"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Create new view */}
          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-medium">Skapa ny vy från nuvarande filter</h3>
            {hasFilters ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  <FilterSummary filters={currentFilters.filters} />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="view-name" className="sr-only">Namn på vy</Label>
                    <Input
                      id="view-name"
                      placeholder="Namn på vy..."
                      value={newViewName}
                      onChange={(e) => setNewViewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateView();
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
                Välj filter i ärendelistan först för att spara dem som en ny vy.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
