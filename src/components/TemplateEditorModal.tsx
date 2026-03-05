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
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, X, Check } from 'lucide-react';

interface TemplateEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template | null;
  categories: Category[];
  onSave: (templateData: Omit<Template, 'id' | 'position' | 'createdBy' | 'createdAt' | 'updatedAt'>) => void;
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

  // Reset form when dialog opens/closes or template changes
  useEffect(() => {
    if (!open) {
      return;
    }

    // Defer state updates to next tick to ensure proper synchronization
    setTimeout(() => {
      if (template) {
        // Editing existing template
        const newFormData = {
          name: template.name,
          description: template.description || '',
          titleTemplate: template.titleTemplate,
          descriptionTemplate: template.descriptionTemplate,
          priority: template.priority,
          category: template.category || 'none',
          notesTemplate: template.notesTemplate || '',
          solutionTemplate: template.solutionTemplate || '',
        };
        setFormData(newFormData);
        // Load fields for existing template
        loadFields(template.id);
      } else {
        // Creating new template - reset to empty
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
      }
    }, 0);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const templateData = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      titleTemplate: formData.titleTemplate.trim(),
      descriptionTemplate: formData.descriptionTemplate.trim(),
      priority: formData.priority,
      category: formData.category === 'none' ? null : formData.category,
      notesTemplate: formData.notesTemplate.trim() || null,
      solutionTemplate: formData.solutionTemplate.trim() || null,
    };

    if (isEditing) {
      onUpdate(template.id, templateData);
    } else {
      onSave(templateData);
    }

    onOpenChange(false);
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
    setEditingFieldId(null);
    setShowNewFieldForm(false);
  };

  const handleAddField = async () => {
    if (!template?.id) {
      toast.error('Spara mallen först innan du lägger till fält');
      return;
    }

    if (!fieldFormData.field_name.trim() || !fieldFormData.field_label.trim()) {
      toast.error('Fältnamn och etikett är obligatoriska');
      return;
    }

    try {
      const newField = await api.createTemplateField(template.id, {
        field_name: fieldFormData.field_name.trim(),
        field_label: fieldFormData.field_label.trim(),
        field_type: fieldFormData.field_type,
        placeholder: fieldFormData.placeholder.trim() || null,
        default_value: fieldFormData.default_value.trim() || null,
        required: fieldFormData.required ? 1 : 0,
        options: fieldFormData.options.trim() || null,
        position: fields.length,
      });
      setFields([...fields, newField]);
      resetFieldForm();
      toast.success('Fält tillagt');
    } catch (error) {
      console.error('Error adding field:', error);
      toast.error('Kunde inte lägga till fält');
    }
  };

  const handleUpdateField = async () => {
    if (!template?.id || !editingFieldId) return;

    if (!fieldFormData.field_name.trim() || !fieldFormData.field_label.trim()) {
      toast.error('Fältnamn och etikett är obligatoriska');
      return;
    }

    try {
      const updatedField = await api.updateTemplateField(template.id, editingFieldId, {
        field_name: fieldFormData.field_name.trim(),
        field_label: fieldFormData.field_label.trim(),
        field_type: fieldFormData.field_type,
        placeholder: fieldFormData.placeholder.trim() || null,
        default_value: fieldFormData.default_value.trim() || null,
        required: fieldFormData.required ? 1 : 0,
        options: fieldFormData.options.trim() || null,
      });
      setFields(fields.map(f => f.id === editingFieldId ? updatedField : f));
      resetFieldForm();
      toast.success('Fält uppdaterat');
    } catch (error) {
      console.error('Error updating field:', error);
      toast.error('Kunde inte uppdatera fält');
    }
  };

  const handleDeleteField = async (fieldId: string) => {
    if (!template?.id) return;
    if (!confirm('Är du säker på att du vill ta bort detta fält?')) return;

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
    setEditingFieldId(field.id);
    setShowNewFieldForm(true);
  };

  const handleMoveField = async (fieldId: string, direction: 'up' | 'down') => {
    if (!template?.id) return;

    const index = fields.findIndex(f => f.id === fieldId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    const reordered = [...fields];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

    try {
      await api.reorderTemplateFields(template.id, reordered.map(f => f.id));
      setFields(reordered);
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

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">Grundinställningar</TabsTrigger>
            <TabsTrigger value="fields" disabled={!isEditing}>
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
                <div className="space-y-2 mb-4">
                  <Label htmlFor="descriptionTemplate">
                    Beskrivningsmall * <span className="text-xs text-muted-foreground">(används om inga dynamiska fält)</span>
                  </Label>
                  <RichTextEditor
                    value={formData.descriptionTemplate}
                    onChange={(html) => setFormData({ ...formData, descriptionTemplate: html })}
                    placeholder="Detaljerad beskrivning av problemet..."
                    minHeight="200px"
                    required
                  />
                </div>

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

                {/* Solution Template */}
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
                          >
                            <ArrowUp className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleMoveField(field.id, 'down')}
                            disabled={index === fields.length - 1}
                          >
                            <ArrowDown className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleStartEditField(field)}
                        >
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDeleteField(field.id)}
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
                      <Button size="icon" variant="ghost" onClick={resetFieldForm}>
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
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="textarea">Textområde (RichTextEditor)</SelectItem>
                            <SelectItem value="number">Nummer</SelectItem>
                            <SelectItem value="select">Dropdown</SelectItem>
                            <SelectItem value="date">Datum</SelectItem>
                            <SelectItem value="checkbox">Kryssruta</SelectItem>
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
                        <Label>Alternativ <span className="text-xs text-muted-foreground">(JSON-array, t.ex. ["Val 1", "Val 2", "Val 3"])</span></Label>
                        <Textarea
                          value={fieldFormData.options}
                          onChange={(e) => setFieldFormData({ ...fieldFormData, options: e.target.value })}
                          placeholder='["Val 1", "Val 2", "Val 3"]'
                          rows={2}
                        />
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
                        className="rounded border-gray-300"
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
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
