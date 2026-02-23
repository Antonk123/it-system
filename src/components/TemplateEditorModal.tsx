import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MarkdownTextarea } from '@/components/MarkdownTextarea';
import { Template } from '@/types/ticket';
import { Category } from '@/types/ticket';

interface TemplateEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template | null;
  categories: Category[];
  onSave: (templateData: Omit<Template, 'id' | 'position' | 'createdBy' | 'createdAt' | 'updatedAt'>) => void;
  onUpdate: (id: string, updates: Partial<Template>) => void;
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

  // Reset form when dialog opens/closes or template changes
  useEffect(() => {
    if (open && template) {
      // Editing existing template
      setFormData({
        name: template.name,
        description: template.description || '',
        titleTemplate: template.titleTemplate,
        descriptionTemplate: template.descriptionTemplate,
        priority: template.priority,
        category: template.category || 'none',
        notesTemplate: template.notesTemplate || '',
        solutionTemplate: template.solutionTemplate || '',
      });
    } else if (open && !template) {
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
    }
  }, [open, template]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Redigera mall' : 'Skapa ny mall'}</DialogTitle>
        </DialogHeader>

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
                Beskrivningsmall * <span className="text-xs text-muted-foreground">(Markdown stöds)</span>
              </Label>
              <MarkdownTextarea
                id="descriptionTemplate"
                value={formData.descriptionTemplate}
                onChange={(v) => setFormData({ ...formData, descriptionTemplate: v })}
                placeholder={"Detaljerad beskrivning av problemet...\n\nAnvändarnamn: \nAvdelning: \n\nÅtgärd:\n1. \n2. \n3. "}
                rows={8}
                required
                maxLength={5000}
                className="font-mono text-sm"
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
                Anteckningar mall <span className="text-xs text-muted-foreground">(valfritt, Markdown stöds)</span>
              </Label>
              <MarkdownTextarea
                id="notesTemplate"
                value={formData.notesTemplate}
                onChange={(v) => setFormData({ ...formData, notesTemplate: v })}
                placeholder="Kom ihåg att verifiera..."
                rows={3}
                maxLength={5000}
              />
            </div>

            {/* Solution Template */}
            <div className="space-y-2">
              <Label htmlFor="solutionTemplate">
                Lösning mall <span className="text-xs text-muted-foreground">(valfritt, Markdown stöds)</span>
              </Label>
              <MarkdownTextarea
                id="solutionTemplate"
                value={formData.solutionTemplate}
                onChange={(v) => setFormData({ ...formData, solutionTemplate: v })}
                placeholder="Löst genom att..."
                rows={3}
                maxLength={5000}
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
      </DialogContent>
    </Dialog>
  );
};
