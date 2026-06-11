import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useRecurringTemplates, RecurringTemplate, CreateTemplateInput } from '@/hooks/useRecurringTemplates';
import { useCategories } from '@/hooks/useCategories';
import { useTags } from '@/hooks/useTags';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  RefreshCw,
  Plus,
  Play,
  Pause,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';
import { cn } from '@/lib/utils';

// ─── helpers ────────────────────────────────────────────────────────────────

function getIntervalLabel(type: string, day: number | null): string {
  if (type === 'daily') return 'Dagligen';
  if (type === 'weekly') {
    const days = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
    return `Varje ${days[day ?? 1]}`;
  }
  if (type === 'monthly') return `Den ${day ?? 1}:e varje månad`;
  return type;
}

const priorityLabels: Record<string, string> = {
  low: 'Låg',
  medium: 'Normal',
  high: 'Hög',
  critical: 'Kritisk',
};

const weekdays = [
  { value: '0', label: 'Söndag' },
  { value: '1', label: 'Måndag' },
  { value: '2', label: 'Tisdag' },
  { value: '3', label: 'Onsdag' },
  { value: '4', label: 'Torsdag' },
  { value: '5', label: 'Fredag' },
  { value: '6', label: 'Lördag' },
];

// ─── default form state ──────────────────────────────────────────────────────

type FormState = {
  name: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category_id: string;
  tags: string[];
  interval_type: 'daily' | 'weekly' | 'monthly';
  interval_day: string;
};

const emptyForm: FormState = {
  name: '',
  title: '',
  description: '',
  priority: 'medium',
  category_id: '',
  tags: [],
  interval_type: 'weekly',
  interval_day: '1',
};

function templateToForm(t: RecurringTemplate): FormState {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    priority: t.priority,
    category_id: t.category_id ?? '',
    tags: t.tags ?? [],
    interval_type: t.interval_type,
    interval_day: String(t.interval_day ?? 1),
  };
}

function formToInput(f: FormState): CreateTemplateInput {
  const interval_day =
    f.interval_type === 'daily'
      ? null
      : parseInt(f.interval_day, 10);
  return {
    name: f.name,
    title: f.title,
    description: f.description,
    priority: f.priority,
    category_id: f.category_id || null,
    tags: f.tags,
    interval_type: f.interval_type,
    interval_day,
  };
}

// ─── template form dialog ────────────────────────────────────────────────────

interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: RecurringTemplate | null;
}

function TemplateFormDialog({ open, onOpenChange, editing }: TemplateFormDialogProps) {
  const { createTemplate, updateTemplate } = useRecurringTemplates();
  const { categories } = useCategories();
  const { tags: allTags } = useTags();

  const [form, setForm] = useState<FormState>(
    editing ? templateToForm(editing) : emptyForm
  );

  // Sync form when editing changes (dialog reopens for a different template)
  const [lastEditing, setLastEditing] = useState(editing);
  if (editing !== lastEditing) {
    setLastEditing(editing);
    setForm(editing ? templateToForm(editing) : emptyForm);
  }

  const isPending = createTemplate.isPending || updateTemplate.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = formToInput(form);
    if (editing) {
      updateTemplate.mutate(
        { id: editing.id, ...input },
        { onSuccess: () => onOpenChange(false) }
      );
    } else {
      createTemplate.mutate(input, { onSuccess: () => onOpenChange(false) });
    }
  }

  function toggleTag(tagId: string) {
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(tagId)
        ? f.tags.filter((t) => t !== tagId)
        : [...f.tags, tagId],
    }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Redigera schema' : 'Nytt återkommande schema'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* name */}
          <div className="space-y-1">
            <Label htmlFor="rf-name">Schemanamn *</Label>
            <Input
              id="rf-name"
              placeholder="T.ex. Veckorapport IT"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          {/* title */}
          <div className="space-y-1">
            <Label htmlFor="rf-title">Ärendetitel *</Label>
            <Input
              id="rf-title"
              placeholder="Ärendetitel som skapas"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          {/* description */}
          <div className="space-y-1">
            <Label htmlFor="rf-desc">Beskrivning</Label>
            <Textarea
              id="rf-desc"
              placeholder="Beskrivning av ärendet"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
            />
          </div>

          {/* priority */}
          <div className="space-y-1">
            <Label>Prioritet</Label>
            <Select
              value={form.priority}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, priority: v as FormState['priority'] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Låg</SelectItem>
                <SelectItem value="medium">Normal</SelectItem>
                <SelectItem value="high">Hög</SelectItem>
                <SelectItem value="critical">Kritisk</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* category */}
          <div className="space-y-1">
            <Label>Kategori</Label>
            <Select
              value={form.category_id || '__none__'}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, category_id: v === '__none__' ? '' : v }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Ingen kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Ingen kategori</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* tags */}
          {allTags.length > 0 && (
            <div className="space-y-1">
              <Label>Taggar</Label>
              <div className="border rounded-md p-2 max-h-32 overflow-y-auto space-y-1">
                {allTags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex items-center gap-2 text-sm cursor-pointer select-none px-1 py-0.5 hover:bg-accent/30 rounded"
                  >
                    <Checkbox
                      checked={form.tags.includes(tag.id)}
                      onCheckedChange={() => toggleTag(tag.id)}
                    />
                    <span>{tag.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* interval_type */}
          <div className="space-y-1">
            <Label>Intervall</Label>
            <Select
              value={form.interval_type}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  interval_type: v as FormState['interval_type'],
                  interval_day: v === 'weekly' ? '1' : v === 'monthly' ? '1' : '0',
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Dagligen</SelectItem>
                <SelectItem value="weekly">Veckovis</SelectItem>
                <SelectItem value="monthly">Månadsvis</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* interval_day — conditional */}
          {form.interval_type === 'weekly' && (
            <div className="space-y-1">
              <Label>Veckodag</Label>
              <Select
                value={form.interval_day}
                onValueChange={(v) => setForm((f) => ({ ...f, interval_day: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekdays.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {form.interval_type === 'monthly' && (
            <div className="space-y-1">
              <Label htmlFor="rf-day">Dag i månaden (1–31)</Label>
              <Input
                id="rf-day"
                type="number"
                min={1}
                max={31}
                value={form.interval_day}
                onChange={(e) => setForm((f) => ({ ...f, interval_day: e.target.value }))}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Avbryt
            </Button>
            <Button type="submit" disabled={isPending}>
              {editing ? 'Spara' : 'Skapa schema'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── template card ───────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: RecurringTemplate;
  onEdit: (t: RecurringTemplate) => void;
}

function TemplateCard({ template, onEdit }: TemplateCardProps) {
  const { toggleTemplate, deleteTemplate } = useRecurringTemplates();
  const [expanded, setExpanded] = useState(false);

  const isActive = template.is_active === 1;

  return (
    <Card className="overflow-hidden border border-border/60 bg-card/80 backdrop-blur-xs transition-shadow hover:shadow-md">
      <CardContent className="p-0">
        {/* Main row */}
        <div className="flex items-start gap-4 p-4">
          {/* Icon column */}
          <div
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              isActive
                ? 'bg-emerald-500/15 text-emerald-500'
                : 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]'
            )}
          >
            <RefreshCw className="h-4 w-4" />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground truncate">{template.name}</span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]'
                )}
              >
                {isActive ? 'Aktiv' : 'Pausad'}
              </span>
              <span className="text-xs text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5">
                {priorityLabels[template.priority]}
              </span>
            </div>

            <p className="text-sm text-muted-foreground mt-0.5">
              {getIntervalLabel(template.interval_type, template.interval_day)}
            </p>

            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
              <span>
                Nästa:{' '}
                <span className="text-foreground/80">
                  {formatDistanceToNow(new Date(template.next_run), {
                    addSuffix: true,
                    locale: sv,
                  })}
                </span>
              </span>
              {template.last_run && (
                <span>
                  Senast:{' '}
                  <span className="text-foreground/80">
                    {format(new Date(template.last_run), 'd MMM yyyy', { locale: sv })}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={isActive ? 'Pausa schema' : 'Aktivera schema'}
              aria-label={isActive ? `Pausa schemat ${template.title || ''}` : `Aktivera schemat ${template.title || ''}`}
              onClick={() => toggleTemplate.mutate(template.id)}
              disabled={toggleTemplate.isPending}
            >
              {isActive ? (
                <Pause className="h-4 w-4 text-[hsl(var(--warning))]" />
              ) : (
                <Play className="h-4 w-4 text-emerald-500" />
              )}
            </Button>

            {/* Edit */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Redigera"
              aria-label={`Redigera schemat ${template.title || ''}`}
              onClick={() => onEdit(template)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>

            {/* Delete */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 hover:text-destructive"
                  title="Ta bort"
                  aria-label={`Ta bort schemat ${template.title || ''}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Är du säker?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Detta tar bort schemat och all historik. Åtgärden kan inte
                    ångras.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteTemplate.mutate(template.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Ta bort
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* History toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={expanded ? 'Dölj historik' : 'Visa historik'}
              aria-label={expanded ? 'Dölj historik' : 'Visa historik'}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Expandable history — grid-rows trick animates height correctly */}
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-300 ease-out',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
          <div className="border-t border-border/40 bg-muted/20 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Senaste ärenden
            </p>
            {template.history && template.history.length > 0 ? (
              <ul className="space-y-1">
                {template.history.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2">
                    <Link
                      to={`/tickets/${entry.ticket_id}`}
                      className="text-sm text-primary hover:underline truncate"
                    >
                      {entry.ticket_title}
                    </Link>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {format(new Date(entry.created_at), 'd MMM yyyy', { locale: sv })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Inga ärenden skapade ännu.</p>
            )}
          </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function Recurring() {
  const { templates } = useRecurringTemplates();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);

  const list = templates.data ?? [];

  function openCreate() {
    setEditingTemplate(null);
    setDialogOpen(true);
  }

  function openEdit(t: RecurringTemplate) {
    setEditingTemplate(t);
    setDialogOpen(true);
  }

  return (
    <Layout>
      {/* Page header */}
      <div
        className="flex items-center justify-between mb-6"
        style={{ animationDelay: '0ms' }}
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Återkommande ärenden</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Hantera scheman som skapar ärenden automatiskt
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Nytt schema
        </Button>
      </div>

      {/* Content */}
      {templates.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 rounded-lg bg-muted/40 animate-pulse"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      ) : list.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
            <RefreshCw className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-lg font-semibold mb-1">Inga återkommande scheman</h2>
          <p className="text-sm text-muted-foreground max-w-xs mb-6">
            Skapa ett schema för att automatiskt skapa ärenden med ett fast intervall.
          </p>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Skapa ditt första schema
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((template, i) => (
            <div
              key={template.id}
              style={{
                animation: 'fadeSlideIn 0.3s ease both',
                animationDelay: `${i * 50}ms`,
              }}
            >
              <TemplateCard template={template} onEdit={openEdit} />
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <TemplateFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editingTemplate}
      />

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Layout>
  );
}
