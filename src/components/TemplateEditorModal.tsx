import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Template, TemplateFieldRow } from '@/types/ticket';
import { Category } from '@/types/ticket';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, X, Check, Type } from 'lucide-react';
import { DynamicField } from '@/components/DynamicField';
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

interface TemplateEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template | null;
  categories: Category[];
  // Returnerar den skapade mallen (minst { id }) så nya dynamiska fält kan kopplas direkt efter create.
  // null returneras vid fel — handleSubmit hoppar då över fält-skapande (truthy-koll på newTemplate).
  onSave: (templateData: Omit<Template, 'id' | 'position' | 'createdBy' | 'createdAt' | 'updatedAt'>) => Promise<{ id: string } | null | void>;
  onUpdate: (id: string, updates: Partial<Template>) => void;
}

interface FieldFormData {
  field_name: string;
  field_label: string;
  field_type: 'text' | 'textarea' | 'number' | 'select' | 'date' | 'checkbox';
  placeholder: string;
  default_value: string;
  required: boolean;
  options: string;
  position: number;
}

export const TemplateEditorModal = ({
  open,
  onOpenChange,
  template,
  categories,
  onSave,
  onUpdate,
}: TemplateEditorModalProps) => {
  const isEditing = !!template;

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    titleTemplate: '',
    descriptionTemplate: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'critical',
    category: 'none' as string,
    notesTemplate: '',
    solutionTemplate: '',
  });

  // Dynamic fields state
  const [fields, setFields] = useState<TemplateFieldRow[]>([]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [showNewFieldForm, setShowNewFieldForm] = useState(false);
  const [fieldFormData, setFieldFormData] = useState<FieldFormData>({
    field_name: '',
    field_label: '',
    field_type: 'text',
    placeholder: '',
    default_value: '',
    required: false,
    options: '',
    position: 0,
  });
  // Visual select builder state
  const [selectOptions, setSelectOptions] = useState<string[]>([]);
  const [newOption, setNewOption] = useState('');

  // Template type state
  const [templateType, setTemplateType] = useState<'standard' | 'dynamic'>('dynamic');
  const [showTypeChooser, setShowTypeChooser] = useState(false);
  const [pendingFieldDelete, setPendingFieldDelete] = useState<string | null>(null);

  // Reset form when dialog opens/closes or template changes
  useEffect(() => {
    if (!open) {
      return;
    }

    // Defer state updates to next tick to ensure proper synchronization
    const timeoutId = setTimeout(() => {
      if (template) {
        // Editing existing template
        const newFormData = {
          name: template.name,
          description: template.description || '',
          titleTemplate: template.titleTemplate,
          descriptionTemplate: template.descriptionTemplate || '',
          priority: template.priority,
          category: template.category || 'none',
          notesTemplate: template.notesTemplate || '',
          solutionTemplate: template.solutionTemplate || '',
        };
        setFormData(newFormData);

        // Detect template type from template.type or fallback to checking fields
        const detectedType = template.type || (template.fields && template.fields.length > 0 ? 'dynamic' : 'standard');
        setTemplateType(detectedType);
        setShowTypeChooser(false);

        // Load fields for existing template
        loadFields(template.id);
      } else {
        // Creating new template - show type chooser
        setFormData({
          name: '',
          description: '',
          titleTemplate: '',
          descriptionTemplate: '',
          priority: 'medium',
          category: 'none',
          notesTemplate: '',
          solutionTemplate: '',
        });
        setFields([]);
        setShowTypeChooser(true);
        setTemplateType('dynamic'); // Default to dynamic
      }
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [open, template]);

  const loadFields = async (templateId: string) => {
    setIsLoadingFields(true);
    try {
      const data = await api.getTemplateFields(templateId);
      setFields(data.sort((a, b) => a.position - b.position));
    } catch (error) {
      console.error('Error loading template fields:', error);
      toast.error('Kunde inte ladda formulärfält');
    } finally {
      setIsLoadingFields(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate: dynamic templates need at least one field
    if (templateType === 'dynamic' && fields.length === 0 && !isEditing) {
      toast.error('Dynamiska mallar måste ha minst ett fält');
      return;
    }

    const templateData = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      type: templateType,
      titleTemplate: formData.titleTemplate.trim(),
      descriptionTemplate: templateType === 'dynamic' ? null : formData.descriptionTemplate.trim(),
      priority: formData.priority,
      category: formData.category === 'none' ? null : formData.category,
      notesTemplate: templateType === 'dynamic' ? null : (formData.notesTemplate.trim() || null),
      solutionTemplate: templateType === 'dynamic' ? null : (formData.solutionTemplate.trim() || null),
    };

    if (isEditing) {
      await onUpdate(template.id, templateData);
      onOpenChange(false);
    } else {
      // Create new template
      const newTemplate = await onSave(templateData);

      if (newTemplate && fields.length > 0) {
        // Save all pending fields
        toast.info(`Sparar ${fields.length} fält...`);

        try {
          for (const field of fields) {
            await api.createTemplateField(newTemplate.id, {
              field_name: field.field_name,
              field_label: field.field_label,
              field_type: field.field_type,
              placeholder: field.placeholder,
              default_value: field.default_value,
              required: field.required,
              options: field.options ? JSON.parse(field.options) : null,
              position: field.position,
            });
          }
          toast.success('Mall och fält skapade!');
        } catch (error) {
          console.error('Error saving fields:', error);
          toast.error('Mall skapades men vissa fält kunde inte sparas');
        }
      }

      onOpenChange(false);
    }
  };

  const resetFieldForm = () => {
    setFieldFormData({
      field_name: '',
      field_label: '',
      field_type: 'text',
      placeholder: '',
      default_value: '',
      required: false,
      options: '',
      position: fields.length,
    });
    setSelectOptions([]);
    setNewOption('');
    setEditingFieldId(null);
    setShowNewFieldForm(false);
  };

  const handleAddField = async () => {
    if (!fieldFormData.field_name.trim() || !fieldFormData.field_label.trim()) {
      toast.error('Fältnamn och etikett är obligatoriska');
      return;
    }

    // If template exists (editing), save to API immediately
    if (template?.id) {
      try {
        const newField = await api.createTemplateField(template.id, {
          field_name: fieldFormData.field_name.trim(),
          field_label: fieldFormData.field_label.trim(),
          field_type: fieldFormData.field_type,
          placeholder: fieldFormData.placeholder.trim() || null,
          default_value: fieldFormData.default_value.trim() || null,
          required: fieldFormData.required ? 1 : 0,
          options: fieldFormData.options ? JSON.parse(fieldFormData.options) : null,
          position: fields.length,
        });
        setFields([...fields, newField]);
        resetFieldForm();
        toast.success('Fält tillagt');
      } catch (error) {
        console.error('Error adding field:', error);
        toast.error('Kunde inte lägga till fält');
      }
    } else {
      // New template - add to local state only
      const tempField: TemplateFieldRow = {
        id: `temp-${Date.now()}`,
        template_id: 'temp',
        field_name: fieldFormData.field_name.trim(),
        field_label: fieldFormData.field_label.trim(),
        field_type: fieldFormData.field_type,
        placeholder: fieldFormData.placeholder.trim() || null,
        default_value: fieldFormData.default_value.trim() || null,
        required: fieldFormData.required ? 1 : 0,
        options: fieldFormData.options || null,
        position: fields.length,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setFields([...fields, tempField]);
      resetFieldForm();
      toast.success('Fält tillagt (sparas när mallen skapas)');
    }
  };

  const handleUpdateField = async () => {
    if (!editingFieldId) return;

    if (!fieldFormData.field_name.trim() || !fieldFormData.field_label.trim()) {
      toast.error('Fältnamn och etikett är obligatoriska');
      return;
    }

    // If it's a temporary field (not saved yet), just update in state
    if (editingFieldId.startsWith('temp-')) {
      const updatedField: TemplateFieldRow = {
        id: editingFieldId,
        template_id: 'temp',
        field_name: fieldFormData.field_name.trim(),
        field_label: fieldFormData.field_label.trim(),
        field_type: fieldFormData.field_type,
        placeholder: fieldFormData.placeholder.trim() || null,
        default_value: fieldFormData.default_value.trim() || null,
        required: fieldFormData.required ? 1 : 0,
        options: fieldFormData.options || null,
        position: fields.find(f => f.id === editingFieldId)?.position || 0,
        created_at: fields.find(f => f.id === editingFieldId)?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setFields(fields.map(f => f.id === editingFieldId ? updatedField : f));
      resetFieldForm();
      toast.success('Fält uppdaterat');
      return;
    }

    // Otherwise update via API
    if (!template?.id) return;

    try {
      const updatedField = await api.updateTemplateField(template.id, editingFieldId, {
        field_name: fieldFormData.field_name.trim(),
        field_label: fieldFormData.field_label.trim(),
        field_type: fieldFormData.field_type,
        placeholder: fieldFormData.placeholder.trim() || null,
        default_value: fieldFormData.default_value.trim() || null,
        required: fieldFormData.required ? 1 : 0,
        options: fieldFormData.options ? JSON.parse(fieldFormData.options) : null,
      });
      setFields(fields.map(f => f.id === editingFieldId ? updatedField : f));
      resetFieldForm();
      toast.success('Fält uppdaterat');
    } catch (error) {
      console.error('Error updating field:', error);
      toast.error('Kunde inte uppdatera fält');
    }
  };

  const handleDeleteField = (fieldId: string) => {
    setPendingFieldDelete(fieldId);
  };

  const confirmDeleteField = async () => {
    const fieldId = pendingFieldDelete;
    if (!fieldId) return;
    setPendingFieldDelete(null);

    // If it's a temporary field (not saved yet), just remove from state
    if (fieldId.startsWith('temp-')) {
      setFields(fields.filter(f => f.id !== fieldId));
      toast.success('Fält borttaget');
      return;
    }

    // Otherwise delete from API
    if (!template?.id) return;

    try {
      await api.deleteTemplateField(template.id, fieldId);
      setFields(fields.filter(f => f.id !== fieldId));
      toast.success('Fält borttaget');
    } catch (error) {
      console.error('Error deleting field:', error);
      toast.error('Kunde inte ta bort fält');
    }
  };

  const handleStartEditField = (field: TemplateFieldRow) => {
    setFieldFormData({
      field_name: field.field_name,
      field_label: field.field_label,
      field_type: field.field_type as any,
      placeholder: field.placeholder || '',
      default_value: field.default_value || '',
      required: field.required === 1,
      options: field.options || '',
      position: field.position,
    });

    // Parse options for select fields
    if (field.field_type === 'select' && field.options) {
      try {
        const parsed = JSON.parse(field.options);
        setSelectOptions(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        setSelectOptions([]);
      }
    } else {
      setSelectOptions([]);
    }

    setEditingFieldId(field.id);
    setShowNewFieldForm(true);
  };

  const handleMoveField = async (fieldId: string, direction: 'up' | 'down') => {
    const index = fields.findIndex(f => f.id === fieldId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    const reordered = [...fields];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

    // Update positions
    const updatedFields = reordered.map((f, i) => ({ ...f, position: i }));

    // If working with temporary fields or no template yet, just update state
    if (!template?.id || fields.some(f => f.id.startsWith('temp-'))) {
      setFields(updatedFields);
      toast.success('Fält omordnat');
      return;
    }

    // Otherwise save to API
    try {
      await api.reorderTemplateFields(template.id, updatedFields.map(f => f.id));
      setFields(updatedFields);
      toast.success('Fält omordnat');
    } catch (error) {
      console.error('Error reordering fields:', error);
      toast.error('Kunde inte omordna fält');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" key={template?.id || 'new'}>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Redigera mall' : 'Skapa ny mall'}</DialogTitle>
        </DialogHeader>

        {showTypeChooser ? (
          <div className="space-y-6 py-6">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">Vilken typ av mall vill du skapa?</h3>
              <p className="text-sm text-muted-foreground">
                Välj hur ärenden ska struktureras med denna mall
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Dynamic template option */}
              <button
                type="button"
                onClick={() => {
                  setTemplateType('dynamic');
                  setShowTypeChooser(false);
                }}
                className="p-6 border-2 rounded-lg hover:border-primary hover:bg-primary/5 transition-all text-left space-y-3 group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20">
                    <Plus className="w-5 h-5 text-primary" />
                  </div>
                  <h4 className="font-semibold">Dynamiska fält</h4>
                </div>
                <p className="text-sm text-muted-foreground">
                  Strukturerad data med anpassade fält. Rekommenderat för repetitiva ärenden där du vill samla specifik information.
                </p>
                <div className="text-xs text-primary font-medium">→ Rekommenderat</div>
              </button>

              {/* Standard template option */}
              <button
                type="button"
                onClick={() => {
                  setTemplateType('standard');
                  setShowTypeChooser(false);
                }}
                className="p-6 border-2 rounded-lg hover:border-primary hover:bg-primary/5 transition-all text-left space-y-3"
              >
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <Type className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <h4 className="font-semibold">Standard mall</h4>
                </div>
                <p className="text-sm text-muted-foreground">
                  Förfyllda textrutor för beskrivning, anteckningar och lösning. Lämplig för enkla mallar.
                </p>
              </button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">Grundinställningar</TabsTrigger>
            <TabsTrigger value="fields" disabled={!isEditing && templateType === 'standard'}>
              Dynamiska fält {isEditing && fields.length > 0 && `(${fields.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name">
                  Mallnamn * <span className="text-xs text-muted-foreground">(t.ex. "Lösenordsåterställning")</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Mallnamn..."
                  required
                  maxLength={100}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">
                  Beskrivning <span className="text-xs text-muted-foreground">(valfritt, syns i mallistan)</span>
                </Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Kort beskrivning av mallen..."
                  maxLength={500}
                />
              </div>

              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold mb-3">Ärende-standardvärden</h3>

                {/* Title Template */}
                <div className="space-y-2 mb-4">
                  <Label htmlFor="titleTemplate">
                    Titelmall * <span className="text-xs text-muted-foreground">(används som ärendetitel)</span>
                  </Label>
                  <Input
                    id="titleTemplate"
                    value={formData.titleTemplate}
                    onChange={(e) => setFormData({ ...formData, titleTemplate: e.target.value })}
                    placeholder="t.ex. 'Lösenordsåterställning för [användarnamn]'"
                    required
                    maxLength={200}
                  />
                </div>

                {/* Description Template */}
                {templateType === 'standard' && (
                  <div className="space-y-2 mb-4">
                    <Label htmlFor="descriptionTemplate">
                      Beskrivningsmall * <span className="text-xs text-muted-foreground">(används som huvudbeskrivning)</span>
                    </Label>
                    <RichTextEditor
                      value={formData.descriptionTemplate}
                      onChange={(html) => setFormData({ ...formData, descriptionTemplate: html })}
                      placeholder="Detaljerad beskrivning av problemet..."
                      minHeight="200px"
                      required
                    />
                  </div>
                )}

                {/* Priority */}
                <div className="space-y-2 mb-4">
                  <Label htmlFor="priority">Standardprioritet</Label>
                  <Select value={formData.priority} onValueChange={(value: any) => setFormData({ ...formData, priority: value })}>
                    <SelectTrigger id="priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Låg</SelectItem>
                      <SelectItem value="medium">Medel</SelectItem>
                      <SelectItem value="high">Hög</SelectItem>
                      <SelectItem value="critical">Kritisk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Category */}
                <div className="space-y-2 mb-4">
                  <Label htmlFor="category">Standardkategori</Label>
                  <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                    <SelectTrigger id="category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Ingen kategori</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Notes Template */}
                {templateType === 'standard' && (
                  <div className="space-y-2 mb-4">
                    <Label htmlFor="notesTemplate">
                      Anteckningar mall <span className="text-xs text-muted-foreground">(valfritt)</span>
                    </Label>
                    <RichTextEditor
                      value={formData.notesTemplate}
                      onChange={(html) => setFormData({ ...formData, notesTemplate: html })}
                      placeholder="Kom ihåg att verifiera..."
                      minHeight="100px"
                    />
                  </div>
                )}

                {/* Solution Template */}
                {templateType === 'standard' && (
                  <div className="space-y-2">
                    <Label htmlFor="solutionTemplate">
                      Lösning mall <span className="text-xs text-muted-foreground">(valfritt)</span>
                    </Label>
                    <RichTextEditor
                      value={formData.solutionTemplate}
                      onChange={(html) => setFormData({ ...formData, solutionTemplate: html })}
                      placeholder="Löst genom att..."
                      minHeight="100px"
                    />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Avbryt
                </Button>
                <Button type="submit">
                  {isEditing ? 'Spara ändringar' : 'Skapa mall'}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="fields" className="space-y-4">
            {isLoadingFields ? (
              <div className="text-center py-8 text-muted-foreground">
                Laddar fält...
              </div>
            ) : (
              <>
                <div className="text-sm text-muted-foreground mb-4">
                  Dynamiska fält ersätter standardbeskrivningen och låter användare fylla i strukturerad data.
                </div>

                {/* Info box */}
                <div className="rounded-lg bg-primary/10 border border-primary/20 p-4 text-sm mb-4">
                  <p className="font-medium text-primary mb-2">Om dynamiska fält</p>
                  <ul className="text-primary/80 space-y-1 text-xs">
                    <li>• Ersätter standardbeskrivningen med strukturerade formulärfält</li>
                    <li>• <strong>Fältnamn</strong> används tekniskt (databas), <strong>Fältetikett</strong> visas för användare</li>
                    <li>• Använd text för korta svar, textområde för längre beskrivningar</li>
                  </ul>
                </div>

                {/* Split panel layout */}
                <div className="grid grid-cols-2 gap-6">
                  {/* Left panel: Field configuration */}
                  <div className="space-y-4">
                    {/* Field List */}
                    <div className="border rounded-lg divide-y">
                  {fields.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      Inga fält ännu. Klicka på "Lägg till fält" nedan.
                    </div>
                  ) : (
                    fields.map((field, index) => (
                      <div key={field.id} className="flex items-center gap-3 p-3">
                        <div className="flex-1">
                          <p className="font-medium">{field.field_label}</p>
                          <p className="text-sm text-muted-foreground">
                            {field.field_name} • {field.field_type}
                            {field.required === 1 && ' • Obligatorisk'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleMoveField(field.id, 'up')}
                            disabled={index === 0}
                            aria-label="Flytta fält uppåt"
                          >
                            <ArrowUp className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleMoveField(field.id, 'down')}
                            disabled={index === fields.length - 1}
                            aria-label="Flytta fält nedåt"
                          >
                            <ArrowDown className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleStartEditField(field)}
                          aria-label="Redigera fält"
                        >
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDeleteField(field.id)}
                          aria-label="Ta bort fält"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))
                  )}
                    </div>

                    {/* Add/Edit Field Form */}
                    {showNewFieldForm ? (
                  <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">
                        {editingFieldId ? 'Redigera fält' : 'Lägg till nytt fält'}
                      </h3>
                      <Button size="icon" variant="ghost" onClick={resetFieldForm} aria-label="Stäng fältformuläret">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Fältnamn * <span className="text-xs text-muted-foreground">(tekniskt namn, t.ex. "antal_enheter")</span></Label>
                        <Input
                          value={fieldFormData.field_name}
                          onChange={(e) => setFieldFormData({ ...fieldFormData, field_name: e.target.value })}
                          placeholder="antal_enheter"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Fältetikett * <span className="text-xs text-muted-foreground">(visas för användaren)</span></Label>
                        <Input
                          value={fieldFormData.field_label}
                          onChange={(e) => setFieldFormData({ ...fieldFormData, field_label: e.target.value })}
                          placeholder="Antal enheter"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Fälttyp</Label>
                        <Select value={fieldFormData.field_type} onValueChange={(value: any) => setFieldFormData({ ...fieldFormData, field_type: value })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">
                              <div className="flex flex-col">
                                <span>Text</span>
                                <span className="text-xs text-muted-foreground">Kort textfält (t.ex. namn, e-post)</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="textarea">
                              <div className="flex flex-col">
                                <span>Textområde</span>
                                <span className="text-xs text-muted-foreground">Längre text med formatering</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="number">
                              <div className="flex flex-col">
                                <span>Nummer</span>
                                <span className="text-xs text-muted-foreground">Endast numeriska värden</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="select">
                              <div className="flex flex-col">
                                <span>Dropdown</span>
                                <span className="text-xs text-muted-foreground">Fördefinierade val</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="date">
                              <div className="flex flex-col">
                                <span>Datum</span>
                                <span className="text-xs text-muted-foreground">Datumväljare</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="checkbox">
                              <div className="flex flex-col">
                                <span>Kryssruta</span>
                                <span className="text-xs text-muted-foreground">Ja/Nej-val</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Placeholder</Label>
                        <Input
                          value={fieldFormData.placeholder}
                          onChange={(e) => setFieldFormData({ ...fieldFormData, placeholder: e.target.value })}
                          placeholder="T.ex. Ange antal..."
                        />
                      </div>
                    </div>

                    {fieldFormData.field_type === 'select' && (
                      <div className="space-y-2">
                        <Label>Alternativ</Label>
                        <div className="border rounded-md p-3 space-y-2 bg-background">
                          {selectOptions.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-2">
                              Inga alternativ ännu. Lägg till nedan.
                            </p>
                          ) : (
                            selectOptions.map((option, index) => (
                              <div key={index} className="flex items-center gap-2">
                                <Input
                                  value={option}
                                  onChange={(e) => {
                                    const updated = [...selectOptions];
                                    updated[index] = e.target.value;
                                    setSelectOptions(updated);
                                    setFieldFormData({ ...fieldFormData, options: JSON.stringify(updated) });
                                  }}
                                  placeholder={`Alternativ ${index + 1}`}
                                />
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  aria-label="Ta bort alternativ"
                                  onClick={() => {
                                    const updated = selectOptions.filter((_, i) => i !== index);
                                    setSelectOptions(updated);
                                    setFieldFormData({ ...fieldFormData, options: JSON.stringify(updated) });
                                  }}
                                >
                                  <X className="w-4 h-4 text-destructive" />
                                </Button>
                              </div>
                            ))
                          )}
                          <div className="flex gap-2 pt-2">
                            <Input
                              value={newOption}
                              onChange={(e) => setNewOption(e.target.value)}
                              placeholder="Nytt alternativ..."
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (newOption.trim()) {
                                    const updated = [...selectOptions, newOption.trim()];
                                    setSelectOptions(updated);
                                    setFieldFormData({ ...fieldFormData, options: JSON.stringify(updated) });
                                    setNewOption('');
                                  }
                                }
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                if (newOption.trim()) {
                                  const updated = [...selectOptions, newOption.trim()];
                                  setSelectOptions(updated);
                                  setFieldFormData({ ...fieldFormData, options: JSON.stringify(updated) });
                                  setNewOption('');
                                }
                              }}
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              Lägg till
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Standardvärde</Label>
                      <Input
                        value={fieldFormData.default_value}
                        onChange={(e) => setFieldFormData({ ...fieldFormData, default_value: e.target.value })}
                        placeholder="Standardvärde (valfritt)"
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="required"
                        checked={fieldFormData.required}
                        onChange={(e) => setFieldFormData({ ...fieldFormData, required: e.target.checked })}
                        className="rounded border-input"
                      />
                      <Label htmlFor="required" className="cursor-pointer">
                        Obligatoriskt fält
                      </Label>
                    </div>

                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={resetFieldForm}>
                        Avbryt
                      </Button>
                      <Button type="button" onClick={editingFieldId ? handleUpdateField : handleAddField}>
                        <Check className="w-4 h-4 mr-2" />
                        {editingFieldId ? 'Spara ändringar' : 'Lägg till fält'}
                      </Button>
                    </div>
                    </div>
                    ) : (
                      <Button onClick={() => setShowNewFieldForm(true)} className="w-full">
                        <Plus className="w-4 h-4 mr-2" />
                        Lägg till fält
                      </Button>
                    )}
                  </div>

                  {/* Right panel: Live Preview */}
                  <div className="border rounded-lg p-4 bg-muted/20 sticky top-4 self-start">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <span>Förhandsgranskning</span>
                      <span className="text-xs font-normal text-muted-foreground">(Så här ser formuläret ut)</span>
                    </h3>

                    {fields.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        Lägg till fält för att se förhandsgranskning
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {fields.map(field => (
                          <DynamicField
                            key={field.id}
                            field={field}
                            value={field.default_value || ''}
                            onChange={() => {}} // Read-only preview
                            error={undefined}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
        )}
      </DialogContent>

      <AlertDialog open={!!pendingFieldDelete} onOpenChange={(o) => !o && setPendingFieldDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort fält?</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort detta fält? Befintlig data i fältet förloras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteField} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};
