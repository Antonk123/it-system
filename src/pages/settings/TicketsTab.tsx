import { useState, useCallback, memo, useEffect, useMemo, lazy, Suspense } from 'react';

// Lazy-ladda TemplateEditorModal så TipTap-vendor-chunken inte laddas förrän dialogen öppnas
const TemplateEditorModal = lazy(() =>
  import('@/components/TemplateEditorModal').then((m) => ({ default: m.TemplateEditorModal }))
);
import { useCategories } from '@/hooks/useCategories';
import { useTags } from '@/hooks/useTags';
import { useTemplates } from '@/hooks/useTemplates';
import { useChecklistTemplates } from '@/hooks/useChecklistTemplates';
import { useSLAPolicies } from '@/hooks/useSLAPolicies';
import { useCompanies } from '@/hooks/useCompanies';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Plus, Pencil, Trash2, Check, X, Tag, Tags, Type, ListChecks, CornerDownRight, ArrowUp, ArrowDown, Timer, Save, RotateCcw, Loader2 } from 'lucide-react';
import { Select as UiSelect, SelectContent as UiSelectContent, SelectItem as UiSelectItem, SelectTrigger as UiSelectTrigger, SelectValue as UiSelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const TAG_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6',
];

type SlaUnit = 'min' | 'h' | 'd';

function formatSlaMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const h = minutes / 60;
    return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
  }
  const days = minutes / 1440;
  return Number.isInteger(days) ? `${days} dygn` : `${days.toFixed(1)} dygn`;
}

function minutesToParts(minutes: number): { value: number; unit: SlaUnit } {
  if (minutes >= 1440 && minutes % 1440 === 0) return { value: minutes / 1440, unit: 'd' };
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: 'h' };
  return { value: minutes, unit: 'min' };
}

function partsToMinutes(value: number, unit: SlaUnit): number {
  if (unit === 'd') return value * 1440;
  if (unit === 'h') return value * 60;
  return value;
}

const CategoryItem = memo(({
  category,
  isFirst,
  isLast,
  editingId,
  editingName,
  onMove,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  setEditingName
}: any) => (
  <div className="flex items-center gap-3 p-3">
    {editingId === category.id ? (
      <>
        <Input
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSaveEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          className="flex-1"
          autoFocus
        />
        <Button size="icon" variant="ghost" onClick={onSaveEdit} aria-label="Spara kategorinamn">
          <Check className="w-4 h-4 text-[hsl(var(--success))]" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onCancelEdit} aria-label="Avbryt redigering">
          <X className="w-4 h-4 text-muted-foreground" />
        </Button>
      </>
    ) : (
      <>
        <span className="flex-1 font-medium">{category.label}</span>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onMove(category.id, 'up')}
            disabled={isFirst}
            aria-label={`Flytta ${category.label} uppåt`}
          >
            <ArrowUp className="w-4 h-4 text-muted-foreground" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onMove(category.id, 'down')}
            disabled={isLast}
            aria-label={`Flytta ${category.label} nedåt`}
          >
            <ArrowDown className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onStartEdit(category.id, category.label)}
          aria-label={`Redigera ${category.label}`}
        >
          <Pencil className="w-4 h-4 text-muted-foreground" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onDelete(category.id)}
          aria-label={`Ta bort ${category.label}`}
        >
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </>
    )}
  </div>
));

CategoryItem.displayName = 'CategoryItem';

const TemplateItem = memo(({
  template,
  index,
  totalCount,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete
}: any) => (
  <div className="flex items-center gap-3 p-3">
    <div className="flex-1">
      <p className="font-medium">{template.name}</p>
      {template.description && (
        <p className="text-sm text-muted-foreground">{template.description}</p>
      )}
    </div>
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        onClick={onMoveUp}
        disabled={index === 0}
        aria-label={`Flytta ${template.name} uppåt`}
      >
        <ArrowUp className="w-4 h-4 text-muted-foreground" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={onMoveDown}
        disabled={index === totalCount - 1}
        aria-label={`Flytta ${template.name} nedåt`}
      >
        <ArrowDown className="w-4 h-4 text-muted-foreground" />
      </Button>
    </div>
    <Button
      size="icon"
      variant="ghost"
      onClick={onEdit}
      aria-label={`Redigera mallen ${template.name}`}
    >
      <Pencil className="w-4 h-4 text-muted-foreground" />
    </Button>
    <Button
      size="icon"
      variant="ghost"
      onClick={onDelete}
      aria-label={`Ta bort mallen ${template.name}`}
    >
      <Trash2 className="w-4 h-4 text-destructive" />
    </Button>
  </div>
));

TemplateItem.displayName = 'TemplateItem';

// Stabil modul-konstant — utanför komponenten för att undvika react-hooks/exhaustive-deps-varningar
const PRIO_ORDER = ['critical', 'high', 'medium', 'low'] as const;

const TicketsTab = () => {
  const { categories, addCategory, updateCategory, deleteCategory, reorderCategories } = useCategories();
  const { tags, createTag, updateTag, deleteTag, isCreating: isCreatingTag } = useTags();
  const { templates, addTemplate, updateTemplate, deleteTemplate, reorderTemplates } = useTemplates();
  const {
    templates: checklistTemplates,
    fetchTemplates: fetchChecklistTemplates,
    createTemplate: createChecklistTemplate,
    updateTemplate: updateChecklistTemplate,
    deleteTemplate: deleteChecklistTemplate,
  } = useChecklistTemplates();

  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  // Lokal pending-flagga för kategoriläggning (useCategories exponerar inte isPending)
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  // Bekräftelsedialog för att ta bort kategori
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);

  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [editingTagColor, setEditingTagColor] = useState('');
  const [deleteTagId, setDeleteTagId] = useState<string | null>(null);
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);

  const [clTemplateFormOpen, setClTemplateFormOpen] = useState(false);
  const [clEditingId, setClEditingId] = useState<string | null>(null);
  const [clTemplateName, setClTemplateName] = useState('');
  const [clTemplateDesc, setClTemplateDesc] = useState('');
  const [clTemplateItems, setClTemplateItems] = useState<{ label: string; isChild: boolean; parentIndex: number | null }[]>([]);
  const [clNewItemLabel, setClNewItemLabel] = useState('');
  const [deleteClTemplateId, setDeleteClTemplateId] = useState<string | null>(null);
  // Inline-input för sub-item per parent-index (null = inget öppet)
  const [addingSubItemFor, setAddingSubItemFor] = useState<number | null>(null);
  const [clNewSubItemLabel, setClNewSubItemLabel] = useState('');
  const [isSavingCl, setIsSavingCl] = useState(false);

  const [sectionsOpen, setSectionsOpen] = useState({
    categories: false,
    tags: false,
    templates: false,
    checklistTemplates: false,
    sla: false,
  });

  // SLA-policy scope: 'default' = global, eller specifikt företags-id
  const [slaScope, setSlaScope] = useState<string>('default');
  const { companies, updateCompany } = useCompanies();
  const { policies: defaultSlaPolicies } = useSLAPolicies('default');
  const { policies: slaPolicies, isLoading: isSlaLoading, upsertPolicies } = useSLAPolicies(slaScope);

  // SLA-disable per företag (interna ärenden behöver oftast ingen SLA)
  const selectedCompany = useMemo(
    () => slaScope !== 'default' ? companies.find(c => c.id === slaScope) : null,
    [companies, slaScope]
  );
  const slaDisabled = !!selectedCompany?.sla_disabled;
  const [isTogglingSla, setIsTogglingSla] = useState(false);

  const handleToggleSlaDisabled = useCallback(async (disabled: boolean) => {
    if (!selectedCompany) return;
    setIsTogglingSla(true);
    try {
      await updateCompany(selectedCompany.id, { sla_disabled: disabled ? 1 : 0 } as any);
      toast.success(disabled
        ? `SLA inaktiverad för ${selectedCompany.name} — aktiva ärenden rensade`
        : `SLA aktiverad för ${selectedCompany.name} — applicerad på aktiva ärenden`
      );
    } catch (err) {
      toast.error('Kunde inte ändra SLA-status: ' + (err instanceof Error ? err.message : 'okänt fel'));
    } finally {
      setIsTogglingSla(false);
    }
  }, [selectedCompany, updateCompany]);

  // Företag som har egna overrides (för att markera i dropdown)
  const { policies: allSlaPolicies } = useSLAPolicies();
  const companiesWithOverrides = useMemo(() => {
    const set = new Set<string>();
    for (const p of allSlaPolicies) {
      if (p.company_id) set.add(p.company_id);
    }
    return set;
  }, [allSlaPolicies]);

  // SLA edit-state: per prioritet, response/resolution som {value, unit}
  type SlaDraft = { response: { value: number; unit: SlaUnit }; resolution: { value: number; unit: SlaUnit } };
  const [slaDraft, setSlaDraft] = useState<Record<string, SlaDraft>>({});
  const [isSavingSla, setIsSavingSla] = useState(false);

  // Synka draft. Om vald scope saknar policies, använd default som startpunkt
  // (företag utan override använder default-policy i prod ändå).
  useEffect(() => {
    const source = slaPolicies.length > 0 ? slaPolicies : defaultSlaPolicies;
    if (source.length === 0) return;
    const next: Record<string, SlaDraft> = {};
    for (const prio of PRIO_ORDER) {
      const p = source.find(x => x.priority === prio);
      if (p) {
        next[prio] = {
          response: minutesToParts(p.response_time_minutes),
          resolution: minutesToParts(p.resolution_time_minutes),
        };
      }
    }
    setSlaDraft(next);
  }, [slaPolicies, defaultSlaPolicies, slaScope]);

  // Om scope saknar overrides är "dirty" = någon prio skiljer från default,
  // dvs admin håller på att SKAPA en första override för det företaget.
  const scopeHasOverrides = slaPolicies.length > 0;
  const slaIsDirty = useMemo(() => {
    const compareTo = scopeHasOverrides ? slaPolicies : defaultSlaPolicies;
    return PRIO_ORDER.some(prio => {
      const p = compareTo.find(x => x.priority === prio);
      const d = slaDraft[prio];
      if (!p || !d) return false;
      return (
        partsToMinutes(d.response.value, d.response.unit) !== p.response_time_minutes ||
        partsToMinutes(d.resolution.value, d.resolution.unit) !== p.resolution_time_minutes
      );
    });
  }, [slaPolicies, defaultSlaPolicies, slaDraft, scopeHasOverrides]);

  const handleSlaUpdate = useCallback((prio: string, field: 'response' | 'resolution', patch: Partial<{ value: number; unit: SlaUnit }>) => {
    setSlaDraft(prev => ({
      ...prev,
      [prio]: {
        ...prev[prio],
        [field]: { ...prev[prio][field], ...patch },
      },
    }));
  }, []);

  const handleSlaReset = useCallback(() => {
    const source = scopeHasOverrides ? slaPolicies : defaultSlaPolicies;
    const next: Record<string, SlaDraft> = {};
    for (const prio of PRIO_ORDER) {
      const p = source.find(x => x.priority === prio);
      if (p) {
        next[prio] = {
          response: minutesToParts(p.response_time_minutes),
          resolution: minutesToParts(p.resolution_time_minutes),
        };
      }
    }
    setSlaDraft(next);
  }, [slaPolicies, defaultSlaPolicies, scopeHasOverrides]);

  const handleSlaSave = useCallback(async () => {
    // Validera: båda tider > 0, response < resolution
    for (const prio of PRIO_ORDER) {
      const d = slaDraft[prio];
      if (!d) continue;
      const resp = partsToMinutes(d.response.value, d.response.unit);
      const reso = partsToMinutes(d.resolution.value, d.resolution.unit);
      if (resp <= 0 || reso <= 0) {
        toast.error(`${prio}: tider måste vara större än 0`);
        return;
      }
      if (resp >= reso) {
        toast.error(`${prio}: svar (${formatSlaMinutes(resp)}) måste vara kortare än lösning (${formatSlaMinutes(reso)})`);
        return;
      }
    }
    setIsSavingSla(true);
    try {
      const payload = PRIO_ORDER.map(prio => {
        const d = slaDraft[prio];
        return {
          priority: prio,
          response_time_minutes: partsToMinutes(d.response.value, d.response.unit),
          resolution_time_minutes: partsToMinutes(d.resolution.value, d.resolution.unit),
        };
      }).filter(p => p.response_time_minutes > 0 && p.resolution_time_minutes > 0);
      const targetCompanyId = slaScope === 'default' ? null : slaScope;
      await upsertPolicies(targetCompanyId, payload);
    } finally {
      setIsSavingSla(false);
    }
  }, [slaDraft, upsertPolicies, slaScope]);

  const handleSlaRemoveOverrides = useCallback(async () => {
    if (slaScope === 'default') return;
    setIsSavingSla(true);
    try {
      // PUT med tom array deletas alla policies för det företaget → default-policy gäller igen.
      await upsertPolicies(slaScope, []);
    } finally {
      setIsSavingSla(false);
    }
  }, [slaScope, upsertPolicies]);

  useEffect(() => { fetchChecklistTemplates(); }, [fetchChecklistTemplates]);

  const handleAddCategory = useCallback(async () => {
    if (!newCategoryName.trim()) {
      toast.error('Ange ett kategorinamn');
      return;
    }
    setIsAddingCategory(true);
    try {
      await addCategory(newCategoryName.trim());
      setNewCategoryName('');
      toast.success('Kategori tillagd');
    } catch {
      toast.error('Kunde inte skapa kategori');
    } finally {
      setIsAddingCategory(false);
    }
  }, [newCategoryName, addCategory]);

  const handleStartEdit = useCallback((id: string, label: string) => {
    setEditingId(id);
    setEditingName(label);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingName.trim()) {
      toast.error('Kategorinamnet kan inte vara tomt');
      return;
    }
    if (editingId) {
      try {
        await updateCategory(editingId, editingName.trim());
        setEditingId(null);
        setEditingName('');
        toast.success('Kategori uppdaterad');
      } catch {
        toast.error('Kunde inte uppdatera kategori');
      }
    }
  }, [editingName, editingId, updateCategory]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingName('');
  }, []);

  const handleDeleteCategory = useCallback(async () => {
    if (!deleteCategoryId) return;
    try {
      await deleteCategory(deleteCategoryId);
      setDeleteCategoryId(null);
      toast.success('Kategori borttagen');
    } catch {
      toast.error('Kunde inte ta bort kategori');
    }
  }, [deleteCategory, deleteCategoryId]);

  const handleMoveCategory = useCallback((id: string, direction: 'up' | 'down') => {
    const index = categories.findIndex((cat) => cat.id === id);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const reordered = [...categories];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    reorderCategories(reordered.map((cat) => cat.id));
  }, [categories, reorderCategories]);

  const handleAddTag = async () => {
    if (!newTagName.trim()) {
      toast.error('Ange ett taggnamn');
      return;
    }
    try {
      await createTag({ name: newTagName.trim(), color: newTagColor });
      setNewTagName('');
      setNewTagColor('#3b82f6');
      toast.success('Tagg tillagd');
    } catch {
      toast.error('Kunde inte skapa tagg');
    }
  };

  const handleStartEditTag = (id: string, name: string, color: string) => {
    setEditingTagId(id);
    setEditingTagName(name);
    setEditingTagColor(color);
  };

  const handleSaveTagEdit = async () => {
    if (!editingTagName.trim()) {
      toast.error('Taggnamnet kan inte vara tomt');
      return;
    }
    if (editingTagId) {
      try {
        await updateTag({ id: editingTagId, name: editingTagName.trim(), color: editingTagColor });
        setEditingTagId(null);
        toast.success('Tagg uppdaterad');
      } catch {
        toast.error('Kunde inte uppdatera tagg');
      }
    }
  };

  const handleCancelTagEdit = () => {
    setEditingTagId(null);
    setEditingTagName('');
    setEditingTagColor('');
  };

  const handleDeleteTag = async () => {
    if (deleteTagId) {
      try {
        await deleteTag(deleteTagId);
        setDeleteTagId(null);
        toast.success('Tagg borttagen');
      } catch {
        toast.error('Kunde inte ta bort tagg');
      }
    }
  };

  const handleTemplateModalClose = useCallback((open: boolean) => {
    setTemplateModalOpen(open);
    if (!open) {
      setEditingTemplate(null);
    }
  }, []);

  const handleTemplateMoveUp = useCallback((index: number) => {
    if (index > 0) {
      const newOrder = [...templates];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      reorderTemplates(newOrder.map(t => t.id));
    }
  }, [templates, reorderTemplates]);

  const handleTemplateMoveDown = useCallback((index: number) => {
    if (index < templates.length - 1) {
      const newOrder = [...templates];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      reorderTemplates(newOrder.map(t => t.id));
    }
  }, [templates, reorderTemplates]);

  const handleTemplateEdit = useCallback((template: any) => {
    setEditingTemplate(template);
    setTemplateModalOpen(true);
  }, []);

  const handleTemplateDelete = useCallback(async () => {
    if (deleteTemplateId) {
      await deleteTemplate(deleteTemplateId);
      setDeleteTemplateId(null);
    }
  }, [deleteTemplate, deleteTemplateId]);

  const handleClOpenCreate = () => {
    setClEditingId(null);
    setClTemplateName('');
    setClTemplateDesc('');
    setClTemplateItems([]);
    setClNewItemLabel('');
    setClTemplateFormOpen(true);
  };

  const handleClOpenEdit = (t: typeof checklistTemplates[0]) => {
    setClEditingId(t.id);
    setClTemplateName(t.name);
    setClTemplateDesc(t.description || '');
    const builtItems: { label: string; isChild: boolean; parentIndex: number | null }[] = [];
    const parents = t.items.filter(i => !i.parent_label);
    parents.forEach(p => {
      const parentIdx = builtItems.length;
      builtItems.push({ label: p.label, isChild: false, parentIndex: null });
      t.items.filter(c => c.parent_label === p.label).forEach(c => {
        builtItems.push({ label: c.label, isChild: true, parentIndex: parentIdx });
      });
    });
    setClTemplateItems(builtItems);
    setClNewItemLabel('');
    setClTemplateFormOpen(true);
  };

  const handleClSave = async () => {
    if (!clTemplateName.trim()) { toast.error('Namn krävs'); return; }
    if (clTemplateItems.length === 0) { toast.error('Minst ett item krävs'); return; }
    const apiItems = clTemplateItems.map(item => {
      if (item.isChild && item.parentIndex !== null) {
        const parent = clTemplateItems[item.parentIndex];
        return { label: item.label, parent_label: parent?.label };
      }
      return { label: item.label };
    });
    setIsSavingCl(true);
    try {
      if (clEditingId) {
        await updateChecklistTemplate(clEditingId, { name: clTemplateName.trim(), description: clTemplateDesc.trim() || undefined, items: apiItems });
      } else {
        await createChecklistTemplate({ name: clTemplateName.trim(), description: clTemplateDesc.trim() || undefined, items: apiItems });
      }
      setClTemplateFormOpen(false);
      await fetchChecklistTemplates();
    } finally {
      setIsSavingCl(false);
    }
  };

  const handleClAddItem = (isChild: boolean, parentIdx: number | null) => {
    if (!clNewItemLabel.trim()) return;
    setClTemplateItems(prev => [...prev, { label: clNewItemLabel.trim(), isChild, parentIndex: parentIdx }]);
    setClNewItemLabel('');
  };

  const handleClDeleteItem = (idx: number) => {
    setClTemplateItems(prev => prev.filter((_, i) => i !== idx).map(item => {
      if (item.parentIndex === idx) return { ...item, isChild: false, parentIndex: null };
      if (item.parentIndex !== null && item.parentIndex > idx) return { ...item, parentIndex: item.parentIndex - 1 };
      return item;
    }));
  };

  const handleClDeleteTemplate = async () => {
    if (deleteClTemplateId) {
      await deleteChecklistTemplate(deleteClTemplateId);
      setDeleteClTemplateId(null);
    }
  };

  return (
    <>
        <Collapsible open={sectionsOpen.categories} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, categories: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Tag className="w-5 h-5" />
                  Kategorier
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.categories ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Hantera ärendekategorier. Ändringar gäller för nya ärenden.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Nytt kategorinamn..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isAddingCategory && handleAddCategory()}
                disabled={isAddingCategory}
              />
              <Button onClick={handleAddCategory} className="shrink-0" disabled={isAddingCategory}>
                <Plus className="w-4 h-4 mr-2" />
                Lägg till
              </Button>
            </div>

            <div className="border rounded-lg divide-y">
              {categories.map((category, index) => (
                <CategoryItem
                  key={category.id}
                  category={category}
                  isFirst={index === 0}
                  isLast={index === categories.length - 1}
                  editingId={editingId}
                  editingName={editingName}
                  onMove={handleMoveCategory}
                  onStartEdit={handleStartEdit}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={handleCancelEdit}
                  onDelete={setDeleteCategoryId}
                  setEditingName={setEditingName}
                />
              ))}
              {categories.length === 0 && (
                <div className="p-4 text-center text-muted-foreground">
                  Inga kategorier ännu. Lägg till en ovan.
                </div>
              )}
            </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={sectionsOpen.tags} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, tags: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Tags className="w-5 h-5" />
                  Taggar
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.tags ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Hantera taggar för att organisera och filtrera ärenden.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Input
                  placeholder="Nytt taggnamn..."
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isCreatingTag && handleAddTag()}
                  disabled={isCreatingTag}
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    style={{ backgroundColor: newTagColor }}
                    className="w-10 h-10 rounded-md border border-border shrink-0 hover:opacity-80 transition-opacity"
                    title="Välj färg"
                  />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3">
                  <p className="text-xs text-muted-foreground mb-2">Välj färg</p>
                  <div className="flex gap-2 flex-wrap max-w-[200px]">
                    {TAG_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewTagColor(color)}
                        style={{ backgroundColor: color }}
                        className={`w-7 h-7 rounded-full transition-all ${
                          newTagColor === color ? 'ring-2 ring-offset-2 ring-offset-background ring-primary' : ''
                        }`}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Button onClick={handleAddTag} className="shrink-0" disabled={isCreatingTag}>
                <Plus className="w-4 h-4 mr-2" />
                Lägg till
              </Button>
            </div>

            <div className="border rounded-lg divide-y">
              {tags.map((tag) => (
                <div key={tag.id} className="flex items-center gap-3 p-3">
                  {editingTagId === tag.id ? (
                    <>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            style={{ backgroundColor: editingTagColor }}
                            className="w-7 h-7 rounded-full shrink-0 hover:opacity-80 transition-opacity"
                          />
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-3">
                          <div className="flex gap-2 flex-wrap max-w-[200px]">
                            {TAG_COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => setEditingTagColor(color)}
                                style={{ backgroundColor: color }}
                                className={`w-7 h-7 rounded-full transition-all ${
                                  editingTagColor === color ? 'ring-2 ring-offset-2 ring-offset-background ring-primary' : ''
                                }`}
                              />
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Input
                        value={editingTagName}
                        onChange={(e) => setEditingTagName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveTagEdit();
                          if (e.key === 'Escape') handleCancelTagEdit();
                        }}
                        className="flex-1"
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" onClick={handleSaveTagEdit} aria-label="Spara tagg">
                        <Check className="w-4 h-4 text-[hsl(var(--success))]" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={handleCancelTagEdit} aria-label="Avbryt taggredigering">
                        <X className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <div
                        style={{ backgroundColor: tag.color }}
                        className="w-4 h-4 rounded-full shrink-0"
                        aria-hidden="true"
                      />
                      <span className="flex-1 font-medium">{tag.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {tag.color}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleStartEditTag(tag.id, tag.name, tag.color)}
                        aria-label={`Redigera taggen ${tag.name}`}
                      >
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteTagId(tag.id)}
                        aria-label={`Ta bort taggen ${tag.name}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
              {tags.length === 0 && (
                <div className="p-4 text-center text-muted-foreground">
                  Inga taggar ännu. Lägg till en ovan.
                </div>
              )}
            </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={sectionsOpen.templates} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, templates: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Type className="w-5 h-5" />
                  Ärendemallar
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.templates ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Hantera mallar för snabbare ärendeskapande. Mallar kan användas vid skapande av nya ärenden.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
            <Button
              onClick={() => {
                setEditingTemplate(null);
                setTemplateModalOpen(true);
              }}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Ny mall
            </Button>

            <div className="border rounded-lg divide-y">
              {templates.map((template, index) => (
                <TemplateItem
                  key={template.id}
                  template={template}
                  index={index}
                  totalCount={templates.length}
                  onMoveUp={() => handleTemplateMoveUp(index)}
                  onMoveDown={() => handleTemplateMoveDown(index)}
                  onEdit={() => handleTemplateEdit(template)}
                  onDelete={() => setDeleteTemplateId(template.id)}
                />
              ))}
              {templates.length === 0 && (
                <div className="p-4 text-center text-muted-foreground">
                  Inga mallar ännu. Klicka på "Ny mall" ovan för att skapa din första mall.
                </div>
              )}
            </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={sectionsOpen.checklistTemplates} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, checklistTemplates: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="w-5 h-5" />
                  Checklistmallar
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.checklistTemplates ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Återanvändbara checklistmallar som kan appliceras på ärenden.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                {!clTemplateFormOpen ? (
                  <Button onClick={handleClOpenCreate} className="w-full">
                    <Plus className="w-4 h-4 mr-2" />
                    Ny checklistmall
                  </Button>
                ) : (
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="font-medium text-sm">{clEditingId ? 'Redigera mall' : 'Ny mall'}</div>
                    <Input
                      placeholder="Mallnamn (t.ex. Ny dator-setup)..."
                      value={clTemplateName}
                      onChange={(e) => setClTemplateName(e.target.value)}
                    />
                    <Input
                      placeholder="Beskrivning (valfri)..."
                      value={clTemplateDesc}
                      onChange={(e) => setClTemplateDesc(e.target.value)}
                    />
                    <div className="space-y-1">
                      {clTemplateItems.map((item, idx) => (
                        <div key={idx}>
                          <div className={`flex items-center gap-2 ${item.isChild ? 'ml-6' : ''}`}>
                            {item.isChild && <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                            <span className="flex-1 text-sm border rounded px-2 py-1 bg-muted/30">{item.label}</span>
                            {!item.isChild && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Lägg till deluppgift under denna"
                                aria-label="Lägg till deluppgift"
                                onClick={() => {
                                  setAddingSubItemFor(idx);
                                  setClNewSubItemLabel('');
                                }}
                              >
                                <CornerDownRight className="h-3 w-3" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleClDeleteItem(idx)} aria-label="Ta bort checklistepunkt">
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                          {/* Inline-input för sub-item direkt under aktuell parent */}
                          {addingSubItemFor === idx && (
                            <div className="flex items-center gap-2 ml-6 mt-1">
                              <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0" />
                              <Input
                                placeholder="Deluppgiftens text..."
                                value={clNewSubItemLabel}
                                onChange={(e) => setClNewSubItemLabel(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && clNewSubItemLabel.trim()) {
                                    setClTemplateItems(prev => {
                                      const next = [...prev];
                                      next.splice(idx + 1, 0, { label: clNewSubItemLabel.trim(), isChild: true, parentIndex: idx });
                                      return next;
                                    });
                                    setAddingSubItemFor(null);
                                    setClNewSubItemLabel('');
                                  }
                                  if (e.key === 'Escape') {
                                    setAddingSubItemFor(null);
                                    setClNewSubItemLabel('');
                                  }
                                }}
                                className="flex-1 h-7 text-sm"
                                autoFocus
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={!clNewSubItemLabel.trim()}
                                aria-label="Bekräfta deluppgift"
                                onClick={() => {
                                  if (!clNewSubItemLabel.trim()) return;
                                  setClTemplateItems(prev => {
                                    const next = [...prev];
                                    next.splice(idx + 1, 0, { label: clNewSubItemLabel.trim(), isChild: true, parentIndex: idx });
                                    return next;
                                  });
                                  setAddingSubItemFor(null);
                                  setClNewSubItemLabel('');
                                }}
                              >
                                <Check className="h-3 w-3 text-[hsl(var(--success))]" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="Avbryt deluppgift"
                                onClick={() => {
                                  setAddingSubItemFor(null);
                                  setClNewSubItemLabel('');
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Ny punkt..."
                        value={clNewItemLabel}
                        onChange={(e) => setClNewItemLabel(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleClAddItem(false, null)}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleClAddItem(false, null)}
                        disabled={!clNewItemLabel.trim()}
                        aria-label="Lägg till punkt"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" onClick={() => setClTemplateFormOpen(false)} disabled={isSavingCl}>Avbryt</Button>
                      <Button onClick={handleClSave} disabled={isSavingCl}>
                        {isSavingCl ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sparar...</> : 'Spara mall'}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="border rounded-lg divide-y">
                  {checklistTemplates.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{t.name}</div>
                        {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                        <div className="text-xs text-muted-foreground">{t.items.length} punkt{t.items.length !== 1 ? 'er' : ''}</div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => handleClOpenEdit(t)} aria-label={`Redigera mallen ${t.name}`}>
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteClTemplateId(t.id)} aria-label={`Ta bort mallen ${t.name}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {checklistTemplates.length === 0 && (
                    <div className="p-4 text-center text-muted-foreground">
                      Inga checklistmallar ännu. Skapa din första ovan.
                    </div>
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={sectionsOpen.sla} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, sla: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Timer className="w-5 h-5" />
                  SLA-policy
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.sla ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Service Level Agreement: hur snabbt ärenden ska kvitteras (svar) och stängas (lösning) per prioritet.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  SLA räknas från ärendets skapad-tid. Svar = tid till första statusbyte (open → annat). Lösning = tid till resolved/closed.
                  Default-policyn gäller om inget annat anges. Företag kan ha egna overrides — välj i listan nedan.
                </p>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-muted-foreground shrink-0">Policy för:</label>
                  <UiSelect value={slaScope} onValueChange={setSlaScope}>
                    <UiSelectTrigger className="w-full md:w-72 h-9" aria-label="Välj SLA-scope">
                      <UiSelectValue />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      <UiSelectItem value="default">Default (alla företag)</UiSelectItem>
                      {companies.map(c => (
                        <UiSelectItem key={c.id} value={c.id}>
                          {c.name}{companiesWithOverrides.has(c.id) ? ' • har egen' : ''}
                        </UiSelectItem>
                      ))}
                    </UiSelectContent>
                  </UiSelect>
                  {slaScope !== 'default' && !scopeHasOverrides && (
                    <Badge variant="outline" className="text-xs shrink-0">Använder default</Badge>
                  )}
                  {slaScope !== 'default' && scopeHasOverrides && !slaDisabled && (
                    <Badge variant="secondary" className="text-xs shrink-0">Egen override</Badge>
                  )}
                  {slaScope !== 'default' && slaDisabled && (
                    <Badge variant="outline" className="text-xs shrink-0 border-destructive/40 text-destructive">SLA inaktiverad</Badge>
                  )}
                </div>

                {selectedCompany && (
                  <div className="flex items-start gap-3 p-3 mb-3 border rounded-lg bg-muted/30">
                    <Switch
                      id="sla-enabled-toggle"
                      checked={!slaDisabled}
                      onCheckedChange={(v) => handleToggleSlaDisabled(!v)}
                      disabled={isTogglingSla}
                    />
                    <div className="flex-1 min-w-0">
                      <Label htmlFor="sla-enabled-toggle" className="text-sm font-medium cursor-pointer">
                        SLA aktiverad för {selectedCompany.name}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Stänger du av räknas ingen SLA-deadline för det här företaget — passar interna ärenden eller företag utan avtal. Aktiva (öppna) ärenden synkas direkt; stängda lämnas orörda för rapporter.
                      </p>
                    </div>
                  </div>
                )}

                {isSlaLoading ? (
                  <div className="text-sm text-muted-foreground p-3">Hämtar policies...</div>
                ) : slaDisabled ? (
                  <div className="text-sm text-muted-foreground p-3 border rounded-lg">
                    SLA är inaktiverat för det här företaget. Inga deadlines beräknas och inga SLA-badges visas. Slå på igen ovan för att återaktivera.
                  </div>
                ) : Object.keys(slaDraft).length === 0 ? (
                  <div className="text-sm text-muted-foreground p-3 border rounded-lg">
                    Inga policies hittades. Default-policy seedas automatiskt vid serverstart.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium">Prioritet</th>
                            <th className="text-left px-3 py-2 font-medium">Svar inom</th>
                            <th className="text-left px-3 py-2 font-medium">Lösning inom</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {PRIO_ORDER.map(prio => {
                            const d = slaDraft[prio];
                            if (!d) return null;
                            const prioLabel = prio === 'critical' ? 'Kritisk' : prio === 'high' ? 'Hög' : prio === 'medium' ? 'Medium' : 'Låg';
                            return (
                              <tr key={prio}>
                                <td className="px-3 py-2 font-medium align-middle">{prioLabel}</td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="number"
                                      min={1}
                                      value={d.response.value}
                                      onChange={(e) => handleSlaUpdate(prio, 'response', { value: Math.max(0, Number(e.target.value) || 0) })}
                                      className="w-20 h-9"
                                      aria-label={`Svarstid för ${prioLabel}`}
                                    />
                                    <UiSelect
                                      value={d.response.unit}
                                      onValueChange={(v) => handleSlaUpdate(prio, 'response', { unit: v as SlaUnit })}
                                    >
                                      <UiSelectTrigger className="w-28 h-9" aria-label={`Tidsenhet för svar ${prioLabel}`}>
                                        <UiSelectValue />
                                      </UiSelectTrigger>
                                      <UiSelectContent>
                                        <UiSelectItem value="min">Minuter</UiSelectItem>
                                        <UiSelectItem value="h">Timmar</UiSelectItem>
                                        <UiSelectItem value="d">Dygn</UiSelectItem>
                                      </UiSelectContent>
                                    </UiSelect>
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="number"
                                      min={1}
                                      value={d.resolution.value}
                                      onChange={(e) => handleSlaUpdate(prio, 'resolution', { value: Math.max(0, Number(e.target.value) || 0) })}
                                      className="w-20 h-9"
                                      aria-label={`Lösningstid för ${prioLabel}`}
                                    />
                                    <UiSelect
                                      value={d.resolution.unit}
                                      onValueChange={(v) => handleSlaUpdate(prio, 'resolution', { unit: v as SlaUnit })}
                                    >
                                      <UiSelectTrigger className="w-28 h-9" aria-label={`Tidsenhet för lösning ${prioLabel}`}>
                                        <UiSelectValue />
                                      </UiSelectTrigger>
                                      <UiSelectContent>
                                        <UiSelectItem value="min">Minuter</UiSelectItem>
                                        <UiSelectItem value="h">Timmar</UiSelectItem>
                                        <UiSelectItem value="d">Dygn</UiSelectItem>
                                      </UiSelectContent>
                                    </UiSelect>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-xs text-muted-foreground">
                        {slaIsDirty ? 'Osparade ändringar' : 'Inga ändringar'}
                      </p>
                      <div className="flex items-center gap-2">
                        {slaScope !== 'default' && scopeHasOverrides && (
                          <Button variant="outline" size="sm" onClick={handleSlaRemoveOverrides} disabled={isSavingSla}>
                            <Trash2 className="w-4 h-4 mr-2 text-destructive" />
                            Ta bort override
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={handleSlaReset} disabled={!slaIsDirty || isSavingSla}>
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Återställ
                        </Button>
                        <Button size="sm" onClick={handleSlaSave} disabled={!slaIsDirty || isSavingSla}>
                          <Save className="w-4 h-4 mr-2" />
                          {isSavingSla ? 'Sparar...' : (slaScope !== 'default' && !scopeHasOverrides ? 'Spara som override' : 'Spara')}
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Ändringar påverkar bara <strong>nya ärenden</strong>. Existerande ärenden behåller sina ursprungliga deadlines.
                      {slaScope !== 'default' && ' Företag utan egen override använder default-policyn.'}
                    </p>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

      <AlertDialog open={!!deleteCategoryId} onOpenChange={() => setDeleteCategoryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort kategori?</AlertDialogTitle>
            <AlertDialogDescription>
              Kategorin tas bort permanent. Ärenden som använder kategorin påverkas inte men förlorar sin kategorikoppling. Denna åtgärd kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCategory} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTagId} onOpenChange={() => setDeleteTagId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort tagg?</AlertDialogTitle>
            <AlertDialogDescription>
              Taggen tas bort från alla ärenden den är kopplad till. Denna åtgärd kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTag} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTemplateId} onOpenChange={() => setDeleteTemplateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort mall?</AlertDialogTitle>
            <AlertDialogDescription>
              Mallen och alla dess dynamiska fält kommer att raderas. Denna åtgärd kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleTemplateDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteClTemplateId} onOpenChange={() => setDeleteClTemplateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort checklistmall?</AlertDialogTitle>
            <AlertDialogDescription>
              Mallen tas bort permanent. Ärenden som redan fått items från mallen påverkas inte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleClDeleteTemplate} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Suspense-wrapper säkerställer att TipTap-chunken laddas lazily när dialogen öppnas */}
      <Suspense fallback={null}>
        <TemplateEditorModal
          open={templateModalOpen}
          onOpenChange={handleTemplateModalClose}
          template={editingTemplate}
          categories={categories}
          onSave={addTemplate}
          onUpdate={updateTemplate}
        />
      </Suspense>
    </>
  );
};

export default TicketsTab;
