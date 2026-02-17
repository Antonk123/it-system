import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useCategories } from '@/hooks/useCategories';
import { useTemplates } from '@/hooks/useTemplates';
import { useTicketAttachments, TicketAttachment } from '@/hooks/useTicketAttachments';
import { useTicketChecklists } from '@/hooks/useTicketChecklists';
import { Layout } from '@/components/Layout';
import { FileUpload } from '@/components/FileUpload';
import { TicketChecklist } from '@/components/TicketChecklist';
import { UserCombobox } from '@/components/UserCombobox';
import { DynamicFieldsForm } from '@/components/DynamicFieldsForm';
import { CustomFieldInput, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TicketPriority, TicketStatus, Template } from '@/types/ticket';
import { toast } from 'sonner';
import { ticketInsertSchema, ticketUpdateSchema } from '@/lib/validations';

const TicketForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addTicket, updateTicket, getTicketById } = useTickets();
  const { users } = useUsers();
  const { categories, addCategory } = useCategories();
  const { templates } = useTemplates();
  const { 
    attachments, 
    isUploading, 
    fetchAttachments, 
    uploadAttachment, 
    deleteAttachment 
  } = useTicketAttachments();
  const {
    items: checklistItems,
    fetchChecklists,
    addChecklistItem,
    updateChecklistItem,
    deleteChecklistItem,
    bulkAddChecklistItems,
  } = useTicketChecklists();
  
  const isEditing = !!id;
  const existingTicket = isEditing ? getTicketById(id) : null;

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as TicketPriority,
    status: 'open' as TicketStatus,
    category: 'none' as string,
    requesterId: '',
    notes: '',
    solution: '',
  });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingChecklistItems, setPendingChecklistItems] = useState<{ id: string; label: string; completed: boolean }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldInput[]>([]);
  const [editInitialFieldValues, setEditInitialFieldValues] = useState<CustomFieldInput[]>([]);
  const solutionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (existingTicket) {
      setFormData({
        title: existingTicket.title,
        description: existingTicket.description,
        priority: existingTicket.priority,
        status: existingTicket.status,
        category: existingTicket.category || 'none',
        requesterId: existingTicket.requesterId,
        notes: existingTicket.notes || '',
        solution: existingTicket.solution || '',
      });
    }
  }, [existingTicket]);

  useEffect(() => {
    if (id) {
      fetchAttachments(id);
      fetchChecklists(id);
    }
  }, [id, fetchAttachments, fetchChecklists]);

  // Load dynamic field values when editing a ticket that was created from a template
  useEffect(() => {
    if (!isEditing || !id || templates.length === 0) return;
    api.getTicket(id).then((ticketDetail) => {
      if (ticketDetail.template_id && ticketDetail.field_values && ticketDetail.field_values.length > 0) {
        const matchingTemplate = templates.find((t) => t.id === ticketDetail.template_id);
        if (matchingTemplate) {
          const savedValues = ticketDetail.field_values.map((fv) => ({
            fieldName: fv.field_name,
            fieldLabel: fv.field_label,
            fieldValue: fv.field_value || '',
          }));
          setSelectedTemplate(matchingTemplate);
          setEditInitialFieldValues(savedValues);
        }
      }
    }).catch(() => { /* ignore */ });
  }, [isEditing, id, templates]);

  // Track unsaved changes
  useEffect(() => {
    if (existingTicket) {
      const hasChanges =
        formData.title !== existingTicket.title ||
        formData.description !== existingTicket.description ||
        formData.priority !== existingTicket.priority ||
        formData.status !== existingTicket.status ||
        formData.category !== (existingTicket.category || 'none') ||
        formData.requesterId !== existingTicket.requesterId ||
        formData.notes !== (existingTicket.notes || '') ||
        formData.solution !== (existingTicket.solution || '') ||
        pendingFiles.length > 0 ||
        pendingChecklistItems.length > 0;

      setHasUnsavedChanges(hasChanges);
    } else if (!isEditing) {
      // For new tickets, mark as unsaved if any data is entered
      const hasData = formData.title || formData.description || formData.requesterId;
      setHasUnsavedChanges(hasData);
    }
  }, [formData, existingTicket, isEditing, pendingFiles, pendingChecklistItems]);

  // Prevent navigation with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges && !isSubmitting) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, isSubmitting]);

  const handleFilesSelect = (files: File[]) => {
    setPendingFiles((prev) => [...prev, ...files]);
  };

  const handleRemovePending = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveAttachment = async (attachment: TicketAttachment) => {
    const success = await deleteAttachment(attachment);
    if (success) {
      toast.success('Bilaga borttagen');
    } else {
      toast.error('Kunde inte ta bort bilaga');
    }
  };

  const handleAddPendingChecklist = (label: string) => {
    setPendingChecklistItems(prev => [
      ...prev,
      { id: `pending-${Date.now()}`, label, completed: false }
    ]);
  };

  const handleDeletePendingChecklist = (id: string) => {
    setPendingChecklistItems(prev => prev.filter(item => item.id !== id));
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      toast.error('Ange ett kategorinamn');
      return;
    }
    setIsAddingCategory(true);
    const created = await addCategory(newCategoryName.trim());
    setIsAddingCategory(false);
    if (created) {
      setFormData((prev) => ({ ...prev, category: created.id }));
      setErrors((prev) => { const p = { ...prev }; delete p['category']; return p; });
      setNewCategoryName('');
      toast.success('Kategori tillagd');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.requesterId) {
      toast.error('Välj en beställare');
      return;
    }

    // If dynamic fields are used, use a placeholder so Zod validation passes.
    // The backend composes the real description from customFields.
    let submitFormData = { ...formData };
    if (customFieldValues.length > 0) {
      submitFormData = { ...submitFormData, description: 'Fältdata' };
    }

    // Validate with Zod and show inline errors
    const schema = isEditing ? ticketUpdateSchema : ticketInsertSchema;
    const validation = schema.safeParse(submitFormData as any);
    if (!validation.success) {
      const fieldErrors: Record<string, string> = {};
      validation.error.errors.forEach((err) => {
        const key = err.path[0] ? String(err.path[0]) : '_form';
        fieldErrors[key] = err.message;
      });
      setErrors(fieldErrors);
      toast.error('Rätta felen i formuläret');
      return;
    }

    setIsSubmitting(true);
    setIsSaving(true);

    try {
      if (isEditing && id) {
        await updateTicket(id, submitFormData, customFieldValues.length > 0 ? customFieldValues : undefined);

        // Upload pending files
        for (const file of pendingFiles) {
          await uploadAttachment(id, file);
        }

        // Add pending checklist items
        if (pendingChecklistItems.length > 0) {
          await bulkAddChecklistItems(id, pendingChecklistItems.map(i => i.label));
        }

        setHasUnsavedChanges(false);
        toast.success('Ärendet uppdaterades');
        navigate(`/tickets/${id}`);
      } else {
        const ticketWithTemplate = selectedTemplate
          ? { ...submitFormData, templateId: selectedTemplate.id }
          : submitFormData;
        const newTicket = await addTicket(ticketWithTemplate, customFieldValues.length > 0 ? customFieldValues : undefined);

        if (newTicket) {
          // Upload pending files to the new ticket
          let uploadErrors = 0;
          for (const file of pendingFiles) {
            try {
              await uploadAttachment(newTicket.id, file);
            } catch (error) {
              console.error('Error uploading file:', file.name, error);
              uploadErrors++;
            }
          }

          // Add pending checklist items to the new ticket
          if (pendingChecklistItems.length > 0) {
            try {
              await bulkAddChecklistItems(newTicket.id, pendingChecklistItems.map(i => i.label));
            } catch (error) {
              console.error('Error adding checklist items:', error);
              toast.error('Kunde inte lägga till checklistor');
            }
          }

          setHasUnsavedChanges(false);

          if (uploadErrors > 0) {
            toast.success(`Ärendet skapades, men ${uploadErrors} fil(er) kunde inte laddas upp`);
          } else {
            toast.success('Ärendet skapades');
          }

          navigate(`/tickets/${newTicket.id}`);
          return;
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error submitting ticket:', error);
      toast.error('Kunde inte spara ärendet');
    } finally {
      setIsSubmitting(false);
      setIsSaving(false);
    }
  };

  const insertSolutionSnippet = (snippet: string, cursorOffset = 0) => {
    const textarea = solutionTextareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart ?? formData.solution.length;
    const end = textarea.selectionEnd ?? formData.solution.length;
    const nextValue = `${formData.solution.slice(0, start)}${snippet}${formData.solution.slice(end)}`;
    const nextCursorPosition = start + snippet.length + cursorOffset;

    setFormData((prev) => ({ ...prev, solution: nextValue }));

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  const handleNavigateBack = () => {
    if (hasUnsavedChanges && !isSaving) {
      if (window.confirm('Du har osparade ändringar. Är du säker på att du vill lämna sidan?')) {
        navigate(-1);
      }
    } else {
      navigate(-1);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="gap-2"
              onClick={handleNavigateBack}
              disabled={isSaving}
            >
              <ArrowLeft className="w-4 h-4" />
              Tillbaka
            </Button>

            {!isEditing && (
              <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline">
                    Skapa från mall
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Välj ärendemall</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2">
                    {templates.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Inga mallar tillgängliga. Skapa mallar i Inställningar.
                      </p>
                    ) : (
                      templates.map((template) => (
                        <Button
                          key={template.id}
                          variant="outline"
                          className="w-full justify-start"
                          onClick={() => {
                            const hasFields = template.fields && template.fields.length > 0;
                            setSelectedTemplate(template);
                            setCustomFieldValues([]);
                            setFormData({
                              ...formData,
                              title: template.titleTemplate,
                              description: hasFields ? '' : template.descriptionTemplate,
                              priority: template.priority,
                              category: template.category || 'none',
                              notes: template.notesTemplate || '',
                              solution: template.solutionTemplate || '',
                            });
                            setTemplateDialogOpen(false);
                            toast.success(`Mall "${template.name}" laddad`);
                          }}
                        >
                          <div className="text-left">
                            <div className="font-medium">{template.name}</div>
                            {template.description && (
                              <div className="text-xs text-muted-foreground">{template.description}</div>
                            )}
                          </div>
                        </Button>
                      ))
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* Save status indicator */}
          {isSaving && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              Sparar...
            </div>
          )}
          {!isSaving && hasUnsavedChanges && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-yellow-500" />
              Osparade ändringar
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{isEditing ? 'Redigera ärende' : 'Skapa nytt ärende'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">Titel *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => { setFormData({ ...formData, title: e.target.value }); setErrors(prev => { const p = { ...prev }; delete p['title']; return p; }); }}
                  placeholder="Kort beskrivning av problemet"
                  required
                />
              </div>

              {selectedTemplate && selectedTemplate.fields && selectedTemplate.fields.length > 0 && (
                <div>
                  <DynamicFieldsForm
                    fields={selectedTemplate.fields}
                    onValuesChange={setCustomFieldValues}
                    initialValues={isEditing && editInitialFieldValues.length > 0 ? editInitialFieldValues : undefined}
                  />
                  <button
                    type="button"
                    className="mt-2 text-xs text-muted-foreground hover:text-foreground underline"
                    onClick={() => {
                      // Restore existing description from ticket when clearing template
                      if (isEditing && existingTicket && !formData.description) {
                        setFormData(prev => ({ ...prev, description: existingTicket.description }));
                      }
                      setSelectedTemplate(null);
                      setCustomFieldValues([]);
                      setEditInitialFieldValues([]);
                    }}
                  >
                    Rensa mall — skriv fri beskrivning istället
                  </button>
                </div>
              )}

              {(!selectedTemplate || !selectedTemplate.fields || selectedTemplate.fields.length === 0) && (
                <div className="space-y-2">
                  <Label htmlFor="description">
                    Beskrivning * <span className="text-xs text-muted-foreground">(Markdown stöds)</span>
                  </Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => { setFormData({ ...formData, description: e.target.value }); setErrors(prev => { const p = { ...prev }; delete p['description']; return p; }); }}
                    placeholder="Detaljerad beskrivning av problemet... (stöder **fetstil**, *kursiv*, `kod`, listor, etc.)"
                    rows={6}
                    required
                    className="font-mono text-sm"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Beställare *</Label>
                  <UserCombobox
                    users={users}
                    value={formData.requesterId}
                    onValueChange={(v) => { setFormData({ ...formData, requesterId: v }); setErrors(prev => { const p = { ...prev }; delete p['requesterId']; return p; }); }}
                    placeholder="Välj användare"
                  />
                  {users.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      <a href="/users" className="text-primary hover:underline">Lägg till användare</a> för att tilldela ärenden
                    </p>
                  )}
                  {errors.requesterId && <p className="text-sm text-destructive mt-1">{errors.requesterId}</p>}
                </div>

                <div className="space-y-2">
                  <Label>Prioritet</Label>
                  <Select 
                    value={formData.priority} 
                    onValueChange={(v) => { setFormData({ ...formData, priority: v as TicketPriority }); setErrors(prev => { const p = { ...prev }; delete p['priority']; return p; }); }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Låg</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">Hög</SelectItem>
                      <SelectItem value="critical">Kritisk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Kategori</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(v) => {
                      setFormData({ ...formData, category: v });
                      setErrors(prev => { const p = { ...prev }; delete p['category']; return p; });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Välj kategori" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Ingen kategori</SelectItem>
                      {categories.map(cat => (
                        <SelectItem
                          key={cat.id}
                          value={cat.id}
                          className="data-[highlighted]:bg-primary/20 data-[highlighted]:text-foreground data-[state=checked]:bg-primary/10"
                        >
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ny kategori..."
                      value={newCategoryName}
                      onChange={(e) => { setNewCategoryName(e.target.value); setErrors(prev => { const p = { ...prev }; delete p['category']; return p; }); }}
                      onKeyDown={(e) => e.key === 'Enter' && !isAddingCategory && handleAddCategory()}
                      disabled={isAddingCategory}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAddCategory}
                      disabled={isAddingCategory}
                      className="shrink-0"
                    >
                      Lägg till
                    </Button>
                    {errors.category && <p className="text-sm text-destructive mt-1">{errors.category}</p>}
                  </div>
                </div>

                {isEditing && (
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select 
                      value={formData.status} 
                      onValueChange={(v) => { setFormData({ ...formData, status: v as TicketStatus }); setErrors(prev => { const p = { ...prev }; delete p['status']; return p; }); }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Öppen</SelectItem>
                        <SelectItem value="in-progress">Pågående</SelectItem>
                        <SelectItem value="waiting">Väntar</SelectItem>
                        <SelectItem value="resolved">Löst</SelectItem>
                        <SelectItem value="closed">Stängd</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* File Attachments */}
              <div className="space-y-2">
                <Label>Bilagor</Label>
                <FileUpload
                  attachments={attachments}
                  pendingFiles={pendingFiles}
                  onFilesSelect={handleFilesSelect}
                  onRemovePending={handleRemovePending}
                  onRemoveAttachment={handleRemoveAttachment}
                  isUploading={isUploading}
                  disabled={isSubmitting}
                />
              </div>

              {/* Checklist */}
              <div className="space-y-2">
                <Label>Checklista / Att göra</Label>
                <div className="border rounded-lg p-4">
                  <TicketChecklist
                    items={checklistItems}
                    pendingItems={pendingChecklistItems}
                    onToggle={(id, completed) => updateChecklistItem(id, { completed })}
                    onDelete={deleteChecklistItem}
                    onAdd={(label) => addChecklistItem(id!, label)}
                    onPendingAdd={handleAddPendingChecklist}
                    onPendingDelete={handleDeletePendingChecklist}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="solution">
                  Lösning <span className="text-xs text-muted-foreground">(Markdown stöds)</span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => insertSolutionSnippet('[Länktext](https://)')}
                  >
                    Länk
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      insertSolutionSnippet(
                        '### Orsak\n- \n\n### Åtgärd\n1. \n2. \n\n### Verifiering\n- [ ] Testat\n- [ ] Klart\n'
                      )
                    }
                  >
                    Lösningsmall
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => insertSolutionSnippet('```\n\n```', -4)}>
                    Kodblock
                  </Button>
                </div>
                <Textarea
                  ref={solutionTextareaRef}
                  id="solution"
                  value={formData.solution}
                  onChange={(e) => setFormData({ ...formData, solution: e.target.value })}
                  placeholder="Dokumentera hur problemet löstes..."
                  rows={10}
                  className="font-mono text-sm min-h-[220px] resize-y leading-relaxed"
                />
                <p className="text-xs text-muted-foreground">
                  Tips: dra i hörnet för att förstora rutan.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Interna anteckningar</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Lägg till interna anteckningar..."
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={handleNavigateBack} disabled={isSaving}>
                  Avbryt
                </Button>
                <Button type="submit" disabled={isSubmitting || isUploading || isSaving}>
                  {isSubmitting ? 'Sparar...' : isEditing ? 'Spara ändringar' : 'Skapa ärende'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default TicketForm;
