import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, PlusCircle, Pencil, ChevronDown } from 'lucide-react';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useSystemUsers } from '@/hooks/useSystemUsers';
import { useCompanies } from '@/hooks/useCompanies';
import { useCategories } from '@/hooks/useCategories';
import { useTemplates } from '@/hooks/useTemplates';
import { useTicketAttachments, TicketAttachment } from '@/hooks/useTicketAttachments';
import { useTicketChecklists } from '@/hooks/useTicketChecklists';
import { useChecklistTemplates } from '@/hooks/useChecklistTemplates';
import { Layout } from '@/components/Layout';
import { FileUpload } from '@/components/FileUpload';
import { TicketChecklist } from '@/components/TicketChecklist';
import { UserCombobox } from '@/components/UserCombobox';
import { CategoryCombobox } from '@/components/CategoryCombobox';
import { TemplateCombobox } from '@/components/TemplateCombobox';
import { DynamicFieldsForm } from '@/components/DynamicFieldsForm';
import { CustomFieldInput, api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Label } from '@/components/ui/label';
import { migrateContent } from '@/lib/contentMigration';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TicketPriority, TicketStatus, Template } from '@/types/ticket';
import { toast } from 'sonner';
import { ticketInsertSchema, ticketUpdateSchema } from '@/lib/validations';

const TicketForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { addTicket, updateTicket, getTicketById } = useTickets();
  const { users } = useUsers();
  const { user: authUser } = useAuth();
  const isAdmin = authUser?.role === 'admin';
  // Non-admins får 403 från GET /api/users, så skippa anropet helt för dem.
  const { users: systemUsers } = useSystemUsers({ enabled: isAdmin });
  const { companies } = useCompanies();
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
  const {
    templates: checklistTemplates,
    fetchTemplates: fetchChecklistTemplates,
  } = useChecklistTemplates();

  // Fetch checklist templates on mount
  useEffect(() => { fetchChecklistTemplates(); }, [fetchChecklistTemplates]);

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
    assigned_to: '' as string,
    company_id: '' as string,
  });
  const [rawContacts, setRawContacts] = useState<import('@/lib/api').ContactRow[]>([]);

  // Fetch raw contacts once to get company_id for auto-fill
  useEffect(() => {
    api.getContacts().then(setRawContacts).catch(() => {});
  }, []);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingChecklistItems, setPendingChecklistItems] = useState<{ id: string; label: string; completed: boolean }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldInput[]>([]);
  const [editInitialFieldValues, setEditInitialFieldValues] = useState<CustomFieldInput[]>([]);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);

  // Progressive disclosure state (create form)
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);

  // Hidden-until-clicked fields (edit form)
  const [showSolution, setShowSolution] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  // Stable callback for DynamicFieldsForm to prevent unnecessary re-renders
  const handleCustomFieldsChange = useCallback((values: CustomFieldInput[]) => {
    setCustomFieldValues(values);
  }, []);

  useEffect(() => {
    if (existingTicket) {
      setFormData({
        title: existingTicket.title,
        description: migrateContent(existingTicket.description),
        priority: existingTicket.priority,
        status: existingTicket.status,
        category: existingTicket.category || 'none',
        requesterId: existingTicket.requesterId,
        notes: existingTicket.notes ? migrateContent(existingTicket.notes) : '',
        solution: existingTicket.solution ? migrateContent(existingTicket.solution) : '',
        assigned_to: (existingTicket as any).assigned_to || '',
        company_id: (existingTicket as any).company_id || '',
      });
      // Show fields that already have content (Pitfall 2: existing content must always be visible)
      setShowSolution(!!existingTicket.solution);
      setShowNotes(!!(existingTicket.notes));
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
    if (!isEditing || !id) {
      return;
    }

    let isCancelled = false;

    const loadTicketAndTemplate = async () => {
      setIsLoadingTemplate(true);
      try {
        const ticketDetail = await api.getTicket(id);

        if (isCancelled) return;

        // If ticket has a template, fetch it with fields
        if (ticketDetail.template_id) {
          try {
            const freshTemplateRow = await api.getTemplate(ticketDetail.template_id);

            if (isCancelled) return;

            if (freshTemplateRow && freshTemplateRow.fields && freshTemplateRow.fields.length > 0) {
              // Map TemplateRow to Template format (snake_case to camelCase)
              const mappedTemplate: Template = {
                id: freshTemplateRow.id,
                name: freshTemplateRow.name,
                description: freshTemplateRow.description,
                titleTemplate: freshTemplateRow.title_template,
                descriptionTemplate: freshTemplateRow.description_template,
                priority: freshTemplateRow.priority as Template['priority'],
                category: freshTemplateRow.category_id,
                notesTemplate: freshTemplateRow.notes_template,
                solutionTemplate: freshTemplateRow.solution_template,
                position: freshTemplateRow.position,
                createdBy: freshTemplateRow.created_by,
                createdAt: new Date(freshTemplateRow.created_at),
                updatedAt: new Date(freshTemplateRow.updated_at),
                fields: freshTemplateRow.fields,
              };

              setSelectedTemplate(mappedTemplate);

              // Map saved field values to initialValues for DynamicFieldsForm
              if (ticketDetail.field_values && ticketDetail.field_values.length > 0) {
                const savedValues = ticketDetail.field_values.map((fv) => ({
                  fieldName: fv.field_name,
                  fieldLabel: fv.field_label,
                  fieldValue: fv.field_value || '',
                }));
                setEditInitialFieldValues(savedValues);
              }
            }
          } catch (templateError) {
            if (import.meta.env.DEV) console.error('Error loading template:', templateError);
            // Template deleted or not accessible
            // If we have field_values, show them as read-only legacy fields
            if (ticketDetail.field_values && ticketDetail.field_values.length > 0) {
              const savedValues = ticketDetail.field_values.map((fv) => ({
                fieldName: fv.field_name,
                fieldLabel: fv.field_label,
                fieldValue: fv.field_value || '',
              }));
              setEditInitialFieldValues(savedValues);
              // Show warning that template is missing
              toast.warning('Mall hittades inte - fältvärden visas som lästa från ärendet');
            }
          }
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Error loading ticket for edit:', error);
        toast.error('Kunde inte ladda ärende');
      } finally {
        if (!isCancelled) {
          setIsLoadingTemplate(false);
        }
      }
    };

    loadTicketAndTemplate();

    return () => {
      isCancelled = true;
    };
  }, [isEditing, id]);

  // Clone pre-fill: populate form from cloneData passed via location.state
  useEffect(() => {
    const cloneData = location.state?.cloneData;
    if (!cloneData || isEditing) return;

    setFormData(prev => ({
      ...prev,
      title: cloneData.title || '',
      description: cloneData.description || '',
      priority: cloneData.priority || 'medium',
      category: cloneData.category || 'none',
    }));

    // If source ticket had a template, load it so DynamicFieldsForm renders
    if (cloneData.templateId) {
      setIsLoadingTemplate(true);
      api.getTemplate(cloneData.templateId)
        .then((freshTemplate) => {
          if (freshTemplate?.fields?.length > 0) {
            // Map server response shape to Template interface (camelCase)
            const mapped: Template = {
              id: freshTemplate.id,
              name: freshTemplate.name,
              description: freshTemplate.description,
              type: freshTemplate.template_type || 'dynamic',
              titleTemplate: freshTemplate.title_template,
              descriptionTemplate: freshTemplate.description_template,
              priority: freshTemplate.priority as Template['priority'],
              category: freshTemplate.category_id,
              notesTemplate: freshTemplate.notes_template,
              solutionTemplate: freshTemplate.solution_template,
              position: freshTemplate.position,
              createdBy: freshTemplate.created_by,
              createdAt: new Date(freshTemplate.created_at),
              updatedAt: new Date(freshTemplate.updated_at),
              fields: freshTemplate.fields,
            };
            setSelectedTemplate(mapped);
            // Pre-fill template field values from cloned ticket
            if (cloneData.customFieldValues?.length) {
              const mappedFieldValues: CustomFieldInput[] = cloneData.customFieldValues.map(
                (fv: { field_name: string; field_label: string; field_value: string }) => ({
                  fieldName: fv.field_name,
                  fieldLabel: fv.field_label,
                  fieldValue: fv.field_value,
                })
              );
              setEditInitialFieldValues(mappedFieldValues);
            }
          }
        })
        .catch(() => {
          // Template may have been deleted — silently skip template fields
        })
        .finally(() => {
          setIsLoadingTemplate(false);
        });
    }
  }, [isEditing, location.state?.cloneData]);

  // Track unsaved changes
  useEffect(() => {
    if (existingTicket) {
      // Build a comparable snapshot of saved customFieldValues from the ticket
      // so a change in any dynamic field flips the dirty flag too.
      const savedFieldSnapshot = JSON.stringify(
        editInitialFieldValues
          .map((v) => ({ n: v.fieldName, v: v.fieldValue ?? '' }))
          .sort((a, b) => a.n.localeCompare(b.n))
      );
      const currentFieldSnapshot = JSON.stringify(
        customFieldValues
          .map((v) => ({ n: v.fieldName, v: v.fieldValue ?? '' }))
          .sort((a, b) => a.n.localeCompare(b.n))
      );

      const hasChanges =
        formData.title !== existingTicket.title ||
        formData.description !== existingTicket.description ||
        formData.priority !== existingTicket.priority ||
        formData.status !== existingTicket.status ||
        formData.category !== (existingTicket.category || 'none') ||
        formData.requesterId !== existingTicket.requesterId ||
        formData.notes !== (existingTicket.notes || '') ||
        formData.solution !== (existingTicket.solution || '') ||
        formData.assigned_to !== ((existingTicket as any).assigned_to || '') ||
        formData.company_id !== ((existingTicket as any).company_id || '') ||
        (customFieldValues.length > 0 && savedFieldSnapshot !== currentFieldSnapshot) ||
        pendingFiles.length > 0 ||
        pendingChecklistItems.length > 0;

      setHasUnsavedChanges(hasChanges);
    } else if (!isEditing) {
      // For new tickets, mark as unsaved if any data is entered
      const hasData = formData.title || formData.description || formData.requesterId;
      setHasUnsavedChanges(hasData);
    }
  }, [formData, existingTicket, isEditing, pendingFiles, pendingChecklistItems, customFieldValues, editInitialFieldValues]);

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

  // Badge counts for collapsible sections
  const detailsBadgeCount = useMemo(() => {
    let count = 0;
    if (formData.priority !== 'medium') count++;
    return count;
  }, [formData.priority]);

  const attachmentsBadgeCount = useMemo(() => {
    const fileCount = (attachments?.length || 0) + pendingFiles.length;
    const checkCount = checklistItems.length + pendingChecklistItems.length;
    return fileCount + checkCount;
  }, [attachments, pendingFiles, checklistItems, pendingChecklistItems]);

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

  const handleAddCategory = async (label: string) => {
    const created = await addCategory(label);
    if (created) {
      setFormData((prev) => ({ ...prev, category: created.id }));
      setErrors((prev) => { const p = { ...prev }; delete p['category']; return p; });
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
      // Open collapsed sections if errors exist there (create mode). Status
      // isn't rendered in create mode, so only auto-open on priority — opening
      // the details panel for a non-existent status field used to scroll to
      // nothing and confuse users about which field needed attention.
      if (!isEditing && fieldErrors.priority) {
        setDetailsOpen(true);
      }
      toast.error('Rätta felen i formuläret');
      // Scroll to first error field
      requestAnimationFrame(() => {
        const firstErrorEl = document.querySelector('[aria-invalid="true"]') as HTMLElement | null;
        firstErrorEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstErrorEl?.focus?.();
      });
      return;
    }

    setIsSubmitting(true);
    setIsSaving(true);

    try {
      if (isEditing && id) {
        await updateTicket(id, { ...submitFormData, assigned_to: formData.assigned_to || undefined, company_id: formData.company_id || undefined } as any, customFieldValues.length > 0 ? customFieldValues : undefined);

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
        // Navigate back to source instead of detail page
        if (location.state?.from) {
          navigate(location.state.from);
        } else {
          navigate('/tickets');
        }
      } else {
        const extraFields = { assigned_to: formData.assigned_to || undefined, company_id: formData.company_id || undefined };
        const ticketWithTemplate = selectedTemplate
          ? { ...submitFormData, templateId: selectedTemplate.id, ...extraFields }
          : { ...submitFormData, ...extraFields };
        const newTicket = await addTicket(ticketWithTemplate, customFieldValues.length > 0 ? customFieldValues : undefined);

        if (newTicket) {
          // Upload pending files to the new ticket
          let uploadErrors = 0;
          for (const file of pendingFiles) {
            try {
              await uploadAttachment(newTicket.id, file);
            } catch (error) {
              if (import.meta.env.DEV) console.error('Error uploading file:', file.name, error);
              uploadErrors++;
            }
          }

          // Add pending checklist items to the new ticket
          if (pendingChecklistItems.length > 0) {
            try {
              await bulkAddChecklistItems(newTicket.id, pendingChecklistItems.map(i => i.label));
            } catch (error) {
              if (import.meta.env.DEV) console.error('Error adding checklist items:', error);
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

  const handleNavigateBack = () => {
    const goBack = () => {
      if (location.state?.from) {
        navigate(location.state.from);
      } else {
        navigate(-1);
      }
    };

    if (hasUnsavedChanges && !isSaving) {
      if (window.confirm('Du har osparade ändringar. Är du säker på att du vill lämna sidan?')) {
        goBack();
      }
    } else {
      goBack();
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            className="gap-2"
            onClick={handleNavigateBack}
            disabled={isSaving}
          >
            <ArrowLeft className="w-4 h-4" />
            Tillbaka
          </Button>

          {/* Save status indicator */}
          {isSaving && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Sparar...
            </div>
          )}
          {!isSaving && hasUnsavedChanges && (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--status-in-progress))]/80">
              <div className="h-2 w-2 rounded-full bg-[hsl(var(--status-in-progress))]" />
              Osparade ändringar
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isEditing
                ? <><Pencil className="w-5 h-5 text-primary" />Redigera ärende</>
                : <><PlusCircle className="w-5 h-5 text-primary" />Skapa nytt ärende</>
              }
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">

              {/* Titel + Mall row */}
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
                <div className="space-y-2">
                  <Label htmlFor="title">Titel *</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => { setFormData({ ...formData, title: e.target.value }); setErrors(prev => { const p = { ...prev }; delete p['title']; return p; }); }}
                    placeholder="Kort beskrivning av problemet"
                    required
                    // Autofocus only on create — editing an existing ticket
                    // shouldn't steal focus on mount (user may be scrolling
                    // to a specific field, and autofocus jumps the viewport).
                    autoFocus={!isEditing}
                    aria-invalid={!!errors.title}
                    aria-describedby={errors.title ? 'title-error' : undefined}
                    className={errors.title ? 'border-destructive focus-visible:ring-destructive' : ''}
                  />
                  {errors.title && <p id="title-error" className="text-sm text-destructive mt-1">{errors.title}</p>}
                </div>
                {!isEditing && (
                  <div className="space-y-2 sm:w-[240px]">
                    <Label>Mall</Label>
                    <TemplateCombobox
                      templates={templates}
                      selectedTemplate={selectedTemplate}
                      onSelect={(template) => {
                        const hasFields = template.fields && template.fields.length > 0;
                        setSelectedTemplate(template);
                        setFormData({
                          ...formData,
                          title: template.titleTemplate,
                          description: hasFields ? '' : template.descriptionTemplate,
                          priority: template.priority,
                          category: template.category || 'none',
                          notes: hasFields ? '' : (template.notesTemplate || ''),
                          solution: hasFields ? '' : (template.solutionTemplate || ''),
                        });
                        toast.success(`Mall "${template.name}" laddad`);
                      }}
                      onClear={() => {
                        if (isEditing && existingTicket && !formData.description) {
                          setFormData(prev => ({ ...prev, description: existingTicket.description }));
                        }
                        setSelectedTemplate(null);
                        setCustomFieldValues([]);
                        setEditInitialFieldValues([]);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Beskrivning / DynamicFieldsForm */}
              {isLoadingTemplate ? (
                <div className="border border-dashed border-muted p-4 rounded text-center text-sm text-muted-foreground">
                  Laddar mallfält...
                </div>
              ) : selectedTemplate && selectedTemplate.fields && selectedTemplate.fields.length > 0 ? (
                <div>
                  <DynamicFieldsForm
                    fields={selectedTemplate.fields}
                    onValuesChange={handleCustomFieldsChange}
                    initialValues={editInitialFieldValues.length > 0 ? editInitialFieldValues : undefined}
                  />

                  {/* Ytterligare information section */}
                  <div className="mt-6 border-t pt-4">
                    <Label htmlFor="additional_notes" className="text-sm text-muted-foreground">
                      Ytterligare information (valfritt)
                    </Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Lägg till extra detaljer som inte passar i standardfälten ovan
                    </p>
                    <RichTextEditor
                      value={formData.notes || ''}
                      onChange={(html) => {
                        setFormData({ ...formData, notes: html });
                      }}
                      placeholder="Övrig information, kommentarer, specialfall..."
                      minHeight="100px"
                    />
                  </div>

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
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="description">
                    Beskrivning *
                  </Label>
                  <div className={errors.description ? 'rounded-md ring-2 ring-destructive ring-offset-1' : ''}>
                    <RichTextEditor
                      value={formData.description}
                      onChange={(html) => { setFormData({ ...formData, description: html }); setErrors(prev => { const p = { ...prev }; delete p['description']; return p; }); }}
                      placeholder="Detaljerad beskrivning av problemet..."
                      minHeight="150px"
                      required
                    />
                  </div>
                  {errors.description && <p className="text-sm text-destructive mt-1">{errors.description}</p>}
                </div>
              )}

              {/* Kategori + Beställare row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Kategori</Label>
                  <CategoryCombobox
                    categories={categories}
                    value={formData.category}
                    onValueChange={(v) => {
                      setFormData({ ...formData, category: v });
                      setErrors(prev => { const p = { ...prev }; delete p['category']; return p; });
                    }}
                    onAddCategory={handleAddCategory}
                  />
                  {errors.category && <p className="text-sm text-destructive mt-1">{errors.category}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Beställare *</Label>
                  <UserCombobox
                    users={users}
                    value={formData.requesterId}
                    onValueChange={(v) => {
                      const contact = rawContacts.find(c => c.id === v);
                      const autoCompany = contact?.company_id || '';
                      setFormData(prev => ({ ...prev, requesterId: v, company_id: autoCompany || prev.company_id }));
                      setErrors(prev => { const p = { ...prev }; delete p['requesterId']; return p; });
                    }}
                    placeholder="Välj användare"
                  />
                  {users.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      <a href="/users" className="text-primary hover:underline">Lägg till användare</a> för att tilldela ärenden
                    </p>
                  )}
                  {errors.requesterId && <p className="text-sm text-destructive mt-1">{errors.requesterId}</p>}
                </div>
              </div>

              {/* Tilldelad + Företag row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ticket-assigned">Tilldelad</Label>
                  {isAdmin ? (
                    <Select value={formData.assigned_to || 'none'} onValueChange={(v) => setFormData(prev => ({ ...prev, assigned_to: v === 'none' ? '' : v }))}>
                      <SelectTrigger id="ticket-assigned">
                        <SelectValue placeholder="Ingen tilldelad" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Ingen tilldelad</SelectItem>
                        {systemUsers.map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="ticket-assigned"
                      value={(existingTicket as any)?.assignedToName || 'Ingen tilldelad'}
                      disabled
                      readOnly
                      title="Endast administratörer kan ändra tilldelad användare"
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ticket-company">Företag</Label>
                  <Select value={formData.company_id || 'none'} onValueChange={(v) => setFormData(prev => ({ ...prev, company_id: v === 'none' ? '' : v }))}>
                    <SelectTrigger id="ticket-company">
                      <SelectValue placeholder="Inget företag" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Inget företag</SelectItem>
                      {companies.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Detaljer collapsible — collapsed in create mode, always open in edit mode */}
              {isEditing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ticket-priority-edit">Prioritet</Label>
                      <Select
                        value={formData.priority}
                        onValueChange={(v) => { setFormData({ ...formData, priority: v as TicketPriority }); setErrors(prev => { const p = { ...prev }; delete p['priority']; return p; }); }}
                      >
                        <SelectTrigger
                          id="ticket-priority-edit"
                          aria-invalid={!!errors.priority}
                          className={errors.priority ? 'border-destructive focus:ring-destructive' : ''}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Låg</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">Hög</SelectItem>
                          <SelectItem value="critical">Kritisk</SelectItem>
                        </SelectContent>
                      </Select>
                      {errors.priority && <p className="text-sm text-destructive mt-1">{errors.priority}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ticket-status-edit">Status</Label>
                      <Select
                        value={formData.status}
                        onValueChange={(v) => { setFormData({ ...formData, status: v as TicketStatus }); setErrors(prev => { const p = { ...prev }; delete p['status']; return p; }); }}
                      >
                        <SelectTrigger
                          id="ticket-status-edit"
                          aria-invalid={!!errors.status}
                          className={errors.status ? 'border-destructive focus:ring-destructive' : ''}
                        >
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
                      {errors.status && <p className="text-sm text-destructive mt-1">{errors.status}</p>}
                    </div>
                  </div>
                </div>
              ) : (
                <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-card px-4 h-11 text-sm font-semibold hover:bg-accent/10 transition-colors">
                    <span>Detaljer</span>
                    <div className="flex items-center gap-2">
                      {detailsBadgeCount > 0 && (
                        <span className="text-xs text-muted-foreground">{detailsBadgeCount} valt</span>
                      )}
                      <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', detailsOpen && 'rotate-180')} />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="ticket-priority-create">Prioritet</Label>
                        <Select
                          value={formData.priority}
                          onValueChange={(v) => { setFormData({ ...formData, priority: v as TicketPriority }); setErrors(prev => { const p = { ...prev }; delete p['priority']; return p; }); }}
                        >
                          <SelectTrigger
                            id="ticket-priority-create"
                            aria-invalid={!!errors.priority}
                            className={errors.priority ? 'border-destructive focus:ring-destructive' : ''}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Låg</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">Hög</SelectItem>
                            <SelectItem value="critical">Kritisk</SelectItem>
                          </SelectContent>
                        </Select>
                        {errors.priority && <p className="text-sm text-destructive mt-1">{errors.priority}</p>}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Bilagor & Checklista collapsible — collapsed in create mode, always open in edit mode */}
              {isEditing ? (
                <div className="space-y-4">
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
                        onToggle={(itemId, completed) => updateChecklistItem(itemId, { completed })}
                        onDelete={deleteChecklistItem}
                        onAdd={(label, parentId) => id ? addChecklistItem(id, label, { parent_id: parentId }) : undefined}
                        onUpdate={(itemId, updates) => updateChecklistItem(itemId, updates)}
                        onPendingAdd={handleAddPendingChecklist}
                        onPendingDelete={handleDeletePendingChecklist}
                        templates={checklistTemplates}
                        onApplyTemplate={(template) => {
                          // In create mode: add as pending items (flat)
                          if (!isEditing) {
                            template.items
                              .filter(i => !i.parent_label)
                              .forEach(i => handleAddPendingChecklist(i.label));
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <Collapsible open={attachmentsOpen} onOpenChange={setAttachmentsOpen}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-card px-4 h-11 text-sm font-semibold hover:bg-accent/10 transition-colors">
                    <span>Bilagor & Checklista</span>
                    <div className="flex items-center gap-2">
                      {attachmentsBadgeCount > 0 && (
                        <span className="text-xs text-muted-foreground">{attachmentsBadgeCount} valt</span>
                      )}
                      <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', attachmentsOpen && 'rotate-180')} />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                    <div className="space-y-4 pt-4">
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
                            onToggle={(itemId, completed) => updateChecklistItem(itemId, { completed })}
                            onDelete={deleteChecklistItem}
                            onAdd={(label, parentId) => id ? addChecklistItem(id, label, { parent_id: parentId }) : undefined}
                            onUpdate={(itemId, updates) => updateChecklistItem(itemId, updates)}
                            onPendingAdd={handleAddPendingChecklist}
                            onPendingDelete={handleDeletePendingChecklist}
                            templates={checklistTemplates}
                            onApplyTemplate={(template) => {
                              // In create mode: add as pending items (flat)
                              if (!isEditing) {
                                template.items
                                  .filter(i => !i.parent_label)
                                  .forEach(i => handleAddPendingChecklist(i.label));
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Edit form: Handläggning section with hidden-until-clicked fields */}
              {isEditing && (
                <>
                  <div className="border-t border-border/60 pt-5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Handläggning</p>
                  </div>

                  {showSolution ? (
                    <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
                      <Label htmlFor="solution">Lösning</Label>
                      <RichTextEditor
                        value={formData.solution}
                        onChange={(html) => setFormData({ ...formData, solution: html })}
                        placeholder="Dokumentera hur problemet löstes..."
                        minHeight="250px"
                      />
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setShowSolution(true)}
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      + Lösning
                    </Button>
                  )}

                  {showNotes ? (
                    <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
                      <Label htmlFor="notes">Interna anteckningar</Label>
                      <RichTextEditor
                        value={formData.notes}
                        onChange={(html) => setFormData({ ...formData, notes: html })}
                        placeholder="Lägg till interna anteckningar..."
                        minHeight="100px"
                      />
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setShowNotes(true)}
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      + Interna anteckningar
                    </Button>
                  )}
                </>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={handleNavigateBack} disabled={isSaving}>
                  Avbryt
                </Button>
                <Button type="submit" disabled={isSubmitting || isUploading || isSaving} className="gap-2">
                  {isSubmitting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Sparar...</>
                  ) : isEditing ? 'Spara ändringar' : 'Skapa ärende'}
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
