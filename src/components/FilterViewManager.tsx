import { useState, useId } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Trash2, Save, Pencil, Check, X, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useCategories } from '@/hooks/useCategories';

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

const ALL_STATUSES = [
  { value: 'open', label: 'Öppen' },
  { value: 'in-progress', label: 'Pågående' },
  { value: 'waiting', label: 'Väntar' },
  { value: 'resolved', label: 'Löst' },
  { value: 'closed', label: 'Stängd' },
];

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  ALL_STATUSES.map((s) => [s.value, s.label])
);

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'Alla' },
  { value: 'low', label: 'Låg' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'Hög' },
  { value: 'critical', label: 'Kritisk' },
];

function FilterSummary({ filters }: { filters: FilterView['filters'] }) {
  const parts: string[] = [];
  if (filters.status && filters.status.length > 0) {
    parts.push(`Status: ${filters.status.map((s) => STATUS_LABELS[s] || s).join(', ')}`);
  }
  if (filters.priority && filters.priority !== 'all') {
    const p = PRIORITY_OPTIONS.find((o) => o.value === filters.priority);
    parts.push(`Prioritet: ${p?.label || filters.priority}`);
  }
  if (filters.category && filters.category !== 'all') parts.push('Kategori');
  if (filters.tags && filters.tags.length > 0) parts.push(`${filters.tags.length} taggar`);
  if (filters.search) parts.push(`Sök: "${filters.search}"`);
  return <span className="text-xs text-muted-foreground">{parts.join(' · ') || 'Inga filter'}</span>;
}

interface EditState {
  name: string;
  statuses: string[];
  priority: string;
  category: string;
}

function ViewFilterEditor({
  initial,
  onSave,
  onCancel,
  existingNames,
}: {
  initial: { name: string; filters: FilterView['filters'] };
  onSave: (name: string, filters: FilterView['filters']) => void;
  onCancel: () => void;
  existingNames: string[];
}) {
  const { categories } = useCategories();
  const formId = useId();
  const [edit, setEdit] = useState<EditState>({
    name: initial.name,
    statuses: initial.filters.status || [],
    priority: initial.filters.priority || 'all',
    category: initial.filters.category || 'all',
  });

  const toggleStatus = (status: string) => {
    setEdit((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status],
    }));
  };

  const handleSave = () => {
    if (!edit.name.trim()) {
      toast.error('Namnet får inte vara tomt');
      return;
    }
    const nameLower = edit.name.trim().toLowerCase();
    if (existingNames.some((n) => n.toLowerCase() === nameLower && n.toLowerCase() !== initial.name.toLowerCase())) {
      toast.error('En vy med detta namn finns redan');
      return;
    }
    onSave(edit.name.trim(), {
      ...initial.filters,
      status: edit.statuses.length > 0 ? edit.statuses : undefined,
      priority: edit.priority !== 'all' ? edit.priority : undefined,
      category: edit.category !== 'all' ? edit.category : undefined,
    });
  };

  return (
    <div className="space-y-3 pt-2 animate-in slide-in-from-top-1 duration-150">
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-name`} className="text-xs text-muted-foreground">Namn</Label>
        <Input
          id={`${formId}-name`}
          value={edit.name}
          onChange={(e) => setEdit((prev) => ({ ...prev, name: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel(); }}
          className="h-8 text-sm"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground" id={`${formId}-status-label`}>Status</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5" role="group" aria-labelledby={`${formId}-status-label`}>
          {ALL_STATUSES.map((s) => (
            <label key={s.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <Checkbox
                checked={edit.statuses.includes(s.value)}
                onCheckedChange={() => toggleStatus(s.value)}
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-priority`} className="text-xs text-muted-foreground">Prioritet</Label>
          <Select value={edit.priority} onValueChange={(v) => setEdit((prev) => ({ ...prev, priority: v }))}>
            <SelectTrigger id={`${formId}-priority`} className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-category`} className="text-xs text-muted-foreground">Kategori</Label>
          <Select value={edit.category} onValueChange={(v) => setEdit((prev) => ({ ...prev, category: v }))}>
            <SelectTrigger id={`${formId}-category`} className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Avbryt
        </Button>
        <Button size="sm" onClick={handleSave} className="gap-1.5">
          <Check className="w-3.5 h-3.5" />
          Spara
        </Button>
      </div>
    </div>
  );
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
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

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

  const handleSaveEdit = (id: string, name: string, filters: FilterView['filters']) => {
    onUpdateView(id, { name, filters });
    setEditingId(null);
    toast.success('Vyn uppdaterad');
  };

  const handleDeleteView = (id: string, name: string) => {
    setPendingDelete({ id, name });
  };

  const confirmDeleteView = () => {
    if (!pendingDelete) return;
    onDeleteView(pendingDelete.id);
    if (editingId === pendingDelete.id) setEditingId(null);
    toast.success(`Vyn "${pendingDelete.name}" borttagen`);
    setPendingDelete(null);
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
  const existingNames = allViews.map((v) => v.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hantera vyer</DialogTitle>
          <DialogDescription>
            Skapa, redigera och välj standardvy för ärendelistan
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            {allViews.map((view) => (
              <div
                key={view.id}
                className={cn(
                  'border rounded-lg transition-colors',
                  view.isDefault && 'border-primary/40 bg-primary/5'
                )}
              >
                <div className="flex items-center gap-2 p-3">
                  <button
                    onClick={() => handleSetDefault(view.id)}
                    className={cn(
                      'shrink-0 transition-colors',
                      view.isDefault
                        ? 'text-primary'
                        : 'text-muted-foreground/40 hover:text-muted-foreground'
                    )}
                    title={view.isDefault ? 'Standardvy' : 'Sätt som standard'}
                    aria-label={view.isDefault ? 'Standardvy' : 'Sätt som standard'}
                  >
                    <Star className={cn('w-4 h-4', view.isDefault && 'fill-current')} />
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{view.name}</p>
                    <FilterSummary filters={view.filters} />
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditingId(editingId === view.id ? null : view.id)}
                      title="Redigera"
                      aria-label="Redigera"
                    >
                      {editingId === view.id ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <Pencil className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    {view.id !== 'active-tickets' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteView(view.id, view.name)}
                        title="Ta bort"
                        aria-label="Ta bort"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {editingId === view.id && (
                  <div className="px-3 pb-3 border-t border-border/50">
                    <ViewFilterEditor
                      initial={{ name: view.name, filters: view.filters }}
                      onSave={(name, filters) => handleSaveEdit(view.id, name, filters)}
                      onCancel={() => setEditingId(null)}
                      existingNames={existingNames}
                    />
                  </div>
                )}
              </div>
            ))}
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

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort vy?</AlertDialogTitle>
            <AlertDialogDescription>
              Vyn <strong>{pendingDelete?.name}</strong> tas bort. Filtren förblir intakta — bara vyn raderas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteView} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
