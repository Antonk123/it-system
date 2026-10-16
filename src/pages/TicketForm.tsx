import { useConfirmDiscard } from '@/hooks/useConfirmDiscard';
import { hasVisibleText } from '@/lib/textValidation';
import { ImageAdapterContext, useTicketImages } from '@/lib/ticketImages';
import { useTicketDraft } from '@/hooks/useTicketDraft';
import { useSupportProfile } from '@/hooks/useSupportProfile';
import { SupportSender } from '@/components/SupportSender';
import { useAuth } from '@/contexts/AuthContext';
import { requiredTemplateFieldErrors } from '@/lib/templateValidation';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router';
import { ArrowLeft, Loader2, PlusCircle, Pencil, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ticketKeys } from '@/hooks/useTickets';
import { useTicketMutations } from '@/hooks/useTicketMutations';
import { mapTicketRow } from '@/lib/mapTicket';
import { getErrorStatus, getErrorCode } from '@/lib/apiErrorStatus';
import { TicketLoadError } from '@/components/TicketLoadError';
import { useUsers } from '@/hooks/useUsers';
import { useSystemUsers } from '@/hooks/useSystemUsers';
import { useCompanies } from '@/hooks/useCompanies';
import { useCategories } from '@/hooks/useCategories';
import { useTemplates } from '@/hooks/useTemplates';
import { useTicketAttachments, TicketAttachment } from '@/hooks/useTicketAttachments';
import { useTicketChecklists } from '@/hooks/useTicketChecklists';
import { useChecklistTemplates } from '@/hooks/useChecklistTemplates';
import { FileUpload } from '@/components/FileUpload';
import { TicketChecklist } from '@/components/TicketChecklist';
import { UserCombobox } from '@/components/UserCombobox';
import { CategoryCombobox } from '@/components/CategoryCombobox';
import { TemplateCombobox } from '@/components/TemplateCombobox';
import { DynamicFieldsForm } from '@/components/DynamicFieldsForm';
import ErrorBoundary from '@/components/ErrorBoundary';
import { CustomFieldInput, api } from '@/lib/api';
import { parseServerDate } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Label } from '@/components/ui/label';
import { migrateContent } from '@/lib/contentMigration';
import { readTicketPrefill } from '@/lib/prefillFromQuery';
import { saveTicketExtras } from '@/lib/ticketSaveExtras';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TicketPriority, TicketStatus, Template } from '@/types/ticket';
import { toast } from 'sonner';
import { ticketInsertSchema, ticketUpdateSchema } from '@/lib/validations';
import { registerUnsavedWork } from '@/registerSW';

// Legacy unscoped key: only removed on success; new drafts live in IndexedDB per user.
const NEW_TICKET_DRAFT_KEY = 'it-ticket:new-ticket-draft';

/** Shown (banner + inline) when a support ticket has no description, image or file. */
export const MISSING_CONTENT_MESSAGE = 'Skriv en kort beskrivning eller bifoga en bild.';

const LookupError = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <p role="alert" className="text-sm text-destructive">
    {message}{' '}
    <button type="button" className="underline" onClick={onRetry}>Försök igen</button>
  </p>
);

/**
 * Skapa/redigera ärende. En komponent eftersom alla fält delar samma utkast-,
 * mall- och valideringstillstånd: mallval fyller i titel/beskrivning/dynamiska
 * fält, utkastet sparas lokalt (IndexedDB) tills formuläret skickas, och
 * handleSubmit sparar fält och inbäddade bilder atomärt före övriga bilagor/checklista.
 */
const TicketForm = ({ selfService = false, embedded = false }: { selfService?: boolean; embedded?: boolean }) => {
  const { confirm, confirmationDialog } = useConfirmDiscard();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const supportMode = !id && (selfService || new URLSearchParams(location.search).get('support') === '1');
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportValidationAttempt, setSupportValidationAttempt] = useState(0);
  const supportErrorRef = useRef<HTMLDivElement>(null);
  const supportInvalidFieldRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!supportError) return;
    supportErrorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    (supportInvalidFieldRef.current ?? supportErrorRef.current)?.focus({ preventScroll: true });
    supportInvalidFieldRef.current = null;
  }, [supportError, supportValidationAttempt]);
  // M9: mutations only — does NOT mount useTickets()'s unfiltered list query
  // (which previously hit the backend's legacy LIMIT-1000 branch on every
  // form open just to reach addTicket/updateTicket).
  const { addTicket, updateTicket } = useTicketMutations();
  const { users } = useUsers();
  const { users: systemUsers } = useSystemUsers({ enabled: !supportMode });
  const { companies } = useCompanies();
  const { categories, addCategory, isError: categoriesError, refetch: refetchCategories } = useCategories();
  const { templates, isError: templatesError, refetch: refetchTemplates } = useTemplates();
  const {
    attachments,
    isUploading,
    uploadAttachment,
    deleteAttachment
  } = useTicketAttachments(id);
  const {
    items: checklistItems,
    addChecklistItem,
    updateChecklistItem,
    deleteChecklistItem,
    bulkAddChecklistItems,
  } = useTicketChecklists(id);
  const {
    templates: checklistTemplates,
    fetchTemplates: fetchChecklistTemplates,
  } = useChecklistTemplates();

  // Fetch checklist templates on mount
  useEffect(() => { if (!supportMode) fetchChecklistTemplates(); }, [fetchChecklistTemplates, supportMode]);

  const isEditing = !!id;
  const supportProfile = useSupportProfile(supportMode);
  const [supportSent, setSupportSent] = useState(false);
  // Authoritative single-ticket fetch (same pattern as TicketDetail): the
  // detail query is the sole source in edit mode. The old getTicketById
  // fallback read useTickets()'s own unfiltered list cache — a distinct cache
  // key from any filtered list view, so it was never warm once that list query
  // was removed (M9); it only ever existed as a side effect of the extra fetch.
  const { data: ticketDetailRow, error: ticketLoadError, refetch: refetchTicket } = useQuery({
    queryKey: ticketKeys.detail(id || ''),
    queryFn: () => api.getTicket(id!),
    enabled: isEditing && !!id,
    // Ett saknat ärende (404) blir inte bättre av ett nytt försök.
    retry: (failureCount, error) => getErrorStatus(error) !== 404 && failureCount < 1,
  });
  // Memoisera så referensen bara ändras när underliggande data faktiskt ändras.
  // Tidigare anropades mapTicketRow inline → NY referens varje render → populerings-
  // effekten nedan (dep [existingTicket]) kördes om vid varje render → setFormData i
  // en oändlig loop → React kapade den och formuläret frös på serverns värden
  // (man kunde inte ändra beställare m.m. — valet "snäppte tillbaka").
  const existingTicket = useMemo(
    () => (isEditing && ticketDetailRow ? mapTicketRow(ticketDetailRow) : null),
    [isEditing, ticketDetailRow]
  );

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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingChecklistItems, setPendingChecklistItems] = useState<{ id: string; label: string; completed: boolean }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Dynamic template-field errors, keyed by field_name. The ticket zod schema
  // doesn't validate template fields per-field (it submits a placeholder
  // description when dynamic fields are present), so this is a best-effort
  // required-field check computed on submit and fed to DynamicFieldsForm.
  const [dynamicFieldErrors, setDynamicFieldErrors] = useState<Record<string, string>>({});
  const [failedUploads, setFailedUploads] = useState<{ files: File[]; ticketId: string } | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
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

  const { user: currentUser } = useAuth();
  const selfContact = users.find(contact => contact.email.toLowerCase() === currentUser?.email?.toLowerCase());
  const matchingProfile = supportProfile?.email.toLowerCase() === currentUser?.email?.toLowerCase() ? supportProfile : null;
  const senderName = matchingProfile?.name || selfContact?.name || currentUser?.email || '';
  const imageState = useTicketImages();
  const submitLock = useRef(false);
  const restoredDraft = useRef(false);
  const [imageBusy, setImageBusy] = useState(0);
  const onImageBusyChange = useCallback((busy: boolean) => setImageBusy(count => Math.max(0, count + (busy ? 1 : -1))), []);
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());
  const draftValue = useMemo(() => ({ formData, selectedTemplate, customFieldValues, images: imageState.images, pendingFiles, pendingChecklistItems, submissionKey, failedUploads }), [formData, selectedTemplate, customFieldValues, imageState.images, pendingFiles, pendingChecklistItems, submissionKey, failedUploads]);
  // The missing-content error goes away as soon as a file or description content
  // satisfies the requirement; removing it again leaves the form quiet until the
  // next submit. Unrelated errors (title, server, number/date) are left alone.
  const supportContentPresent = pendingFiles.length > 0 || hasVisibleText(formData.description) || /<img\b/i.test(formData.description);
  useEffect(() => {
    if (!supportMode || !supportContentPresent) return;
    setSupportError(current => current === MISSING_CONTENT_MESSAGE ? null : current);
    setErrors(prev => {
      if (prev.description !== MISSING_CONTENT_MESSAGE) return prev;
      const next = { ...prev };
      delete next.description;
      return next;
    });
  }, [supportMode, supportContentPresent]);
  const draft = useTicketDraft(`user:${currentUser?.id}:ticket:${id || (supportMode ? 'support' : 'new')}`, draftValue, (hasUnsavedChanges || !!failedUploads), saved => {
    if (location.state?.cloneData) return;
    restoredDraft.current = true;
    populatedTicketIdRef.current = id || null;
    setFormData(saved.formData); setSelectedTemplate(saved.selectedTemplate); setCustomFieldValues(saved.customFieldValues);
    setEditInitialFieldValues(saved.customFieldValues); imageState.setImages(saved.images); setSubmissionKey(saved.submissionKey);
    setFailedUploads(saved.failedUploads || null);
    setPendingFiles(saved.pendingFiles); setPendingChecklistItems(saved.pendingChecklistItems);
  });
  useEffect(() => {
    if (imageBusy || !draft.ready) return;
    const used = imageState.referenced({ formData, customFieldValues });
    if (used.length !== imageState.images.length) imageState.setImages(used);
  }, [formData, customFieldValues, imageBusy, imageState, draft.ready]);

  // Stable callback for DynamicFieldsForm to prevent unnecessary re-renders
  const handleCustomFieldsChange = useCallback((values: CustomFieldInput[]) => {
    setCustomFieldValues(values);
  }, []);

  // Populera formuläret EN gång per laddat ärende-id. Utan denna guard skulle en
  // bakgrunds-refetch av detalj-queryn köra setFormData igen och skriva över
  // användarens osparade ändringar.
  const populatedTicketIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (existingTicket && populatedTicketIdRef.current !== (id ?? null)) {
      populatedTicketIdRef.current = id ?? null;
      setFormData({
        title: existingTicket.title,
        description: migrateContent(existingTicket.description),
        priority: existingTicket.priority,
        status: existingTicket.status,
        category: existingTicket.category || 'none',
        requesterId: existingTicket.requesterId,
        notes: existingTicket.notes ? migrateContent(existingTicket.notes) : '',
        solution: existingTicket.solution ? migrateContent(existingTicket.solution) : '',
        assigned_to: existingTicket.assignedTo || '',
        company_id: existingTicket.companyId || '',
      });
      // Show fields that already have content (Pitfall 2: existing content must always be visible)
      setShowSolution(!!existingTicket.solution);
      setShowNotes(!!(existingTicket.notes));
    }
  }, [existingTicket, id]);

  // Load dynamic field values when editing a ticket that was created from a
  // template. Keyed on the ticket id and template id (not the row object) so a
  // background refetch of the detail query never overwrites what the user typed.
  const loadedTicketId = ticketDetailRow?.id;
  const loadedTemplateId = ticketDetailRow?.template_id;
  useEffect(() => {
    if (!isEditing || !ticketDetailRow || !loadedTemplateId) return;

    let isCancelled = false;
    const savedValues = (ticketDetailRow.field_values ?? []).map((fv) => ({
      fieldName: fv.field_name,
      fieldLabel: fv.field_label,
      fieldValue: fv.field_value || '',
    }));

    const loadTemplate = async (templateId: string) => {
      setIsLoadingTemplate(true);
      try {
        const freshTemplateRow = await api.getTemplate(templateId);
        if (isCancelled || restoredDraft.current) return;

        if (freshTemplateRow && freshTemplateRow.fields && freshTemplateRow.fields.length > 0) {
          // Map TemplateRow to Template format (snake_case to camelCase)
          const mappedTemplate: Template = {
            id: freshTemplateRow.id,
            name: freshTemplateRow.name,
            description: freshTemplateRow.description,
            type: (freshTemplateRow.template_type as Template['type']) || 'dynamic',
            titleTemplate: freshTemplateRow.title_template,
            descriptionTemplate: freshTemplateRow.description_template,
            priority: freshTemplateRow.priority as Template['priority'],
            category: freshTemplateRow.category_id,
            notesTemplate: freshTemplateRow.notes_template,
            solutionTemplate: freshTemplateRow.solution_template,
            position: freshTemplateRow.position,
            createdBy: freshTemplateRow.created_by,
            createdAt: parseServerDate(freshTemplateRow.created_at),
            updatedAt: parseServerDate(freshTemplateRow.updated_at),
            fields: freshTemplateRow.fields,
          };

          setSelectedTemplate(mappedTemplate);
          // Map saved field values to initialValues for DynamicFieldsForm
          if (savedValues.length > 0) setEditInitialFieldValues(savedValues);
        }
      } catch (templateError) {
        if (isCancelled || restoredDraft.current) return;
        if (import.meta.env.DEV) console.error('Error loading template:', templateError);
        // Template deleted or not accessible — show saved values as read-only legacy fields
        if (savedValues.length > 0) {
          setEditInitialFieldValues(savedValues);
          toast.warning('Mall hittades inte - fältvärden visas som lästa från ärendet');
        }
      } finally {
        if (!isCancelled) setIsLoadingTemplate(false);
      }
    };

    void loadTemplate(loadedTemplateId);

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, loadedTicketId, loadedTemplateId]);

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
              type: (freshTemplate.template_type as Template['type']) || 'dynamic',
              titleTemplate: freshTemplate.title_template,
              descriptionTemplate: freshTemplate.description_template,
              priority: freshTemplate.priority as Template['priority'],
              category: freshTemplate.category_id,
              notesTemplate: freshTemplate.notes_template,
              solutionTemplate: freshTemplate.solution_template,
              position: freshTemplate.position,
              createdBy: freshTemplate.created_by,
              createdAt: parseServerDate(freshTemplate.created_at),
              updatedAt: parseServerDate(freshTemplate.updated_at),
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

  // Prefill from ?title=&description= (deep link, e.g. from Navet). Only when
  // creating, not cloning, and no saved draft exists — the draft always wins.
  useEffect(() => {
    if (isEditing || location.state?.cloneData) return;
    const prefill = readTicketPrefill(location.search);
    if (!prefill) return;
    setFormData((prev) => (prev.title || prev.description ? prev : { ...prev, ...prefill }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

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
        formData.assigned_to !== (existingTicket.assignedTo || '') ||
        formData.company_id !== (existingTicket.companyId || '') ||
        (customFieldValues.length > 0 && savedFieldSnapshot !== currentFieldSnapshot) ||
        pendingFiles.length > 0 ||
        pendingChecklistItems.length > 0;

      setHasUnsavedChanges(hasChanges);
    } else if (!isEditing) {
      // For new tickets, mark as unsaved if any data is entered
      const hasData = formData.title || formData.description.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() || /<img\b/i.test(formData.description) || formData.requesterId || pendingFiles.length || pendingChecklistItems.length || customFieldValues.some(v => v.fieldValue) || formData.notes || formData.solution || imageState.images.length;
      setHasUnsavedChanges(!!hasData);
    }
  }, [formData, existingTicket, isEditing, pendingFiles, pendingChecklistItems, customFieldValues, editInitialFieldValues, imageState.images.length]);

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

  // Mirror dirty state to the SW registrar so an auto-update defers its reload
  // until the user has saved/left, instead of discarding an in-progress ticket.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    return registerUnsavedWork();
  }, [hasUnsavedChanges]);

  // Badge counts for collapsible sections
  const detailsBadgeCount = useMemo(() => {
    let count = 0;
    if (formData.priority !== 'medium') count++;
    if (formData.company_id) count++;
    if (formData.assigned_to) count++;
    if (formData.category !== 'none') count++;
    return count;
  }, [formData.priority, formData.company_id, formData.assigned_to, formData.category]);

  const attachmentsBadgeCount = useMemo(() => {
    const checkCount = checklistItems.length + pendingChecklistItems.length;
    return checkCount;
  }, [checklistItems, pendingChecklistItems]);

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

  const saveExtras = useCallback((ticketId: string, files: File[], checklistLabels: string[] = []) =>
    saveTicketExtras({
      ticketId,
      files,
      checklistLabels,
      uploadAttachment,
      addChecklistItems: bulkAddChecklistItems,
      onUploadProgress: (current, total) => setUploadProgress(current ? `Laddar upp fil ${current} av ${total}...` : null),
    }), [uploadAttachment, bulkAddChecklistItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current || imageBusy || !draft.ready) return;
    setSupportError(null);

    if (failedUploads) {
      toast.error('Hantera de misslyckade bilagorna innan du sparar igen');
      return;
    }

    if (!supportMode && !formData.requesterId) {
      toast.error('Välj en beställare');
      return;
    }

    if (supportMode && !hasVisibleText(formData.description) && !/<img\b/i.test(formData.description) && pendingFiles.length === 0) {
      setErrors({ description: MISSING_CONTENT_MESSAGE });
      supportInvalidFieldRef.current = document.querySelector<HTMLElement>('#description [contenteditable="true"]') ?? document.getElementById('description');
      setSupportError(MISSING_CONTENT_MESSAGE);
      setSupportValidationAttempt(attempt => attempt + 1);
      return;
    }

    // Best-effort validation of required dynamic template fields. The ticket
    // zod schema can't see these (placeholder description), so check required
    // fields here and surface inline errors via DynamicFieldsForm's `errors`.
    if (!supportMode && selectedTemplate?.fields && selectedTemplate.fields.length > 0) {
      const dynErrors = requiredTemplateFieldErrors(selectedTemplate.fields, customFieldValues);
      setDynamicFieldErrors(dynErrors);
      if (Object.keys(dynErrors).length > 0) {
        toast.error('Rätta felen i formuläret');
        requestAnimationFrame(() => {
          const firstErrorEl = document.querySelector('[aria-invalid="true"]') as HTMLElement | null;
          firstErrorEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstErrorEl?.focus?.();
        });
        return;
      }
    } else if (Object.keys(dynamicFieldErrors).length > 0) {
      setDynamicFieldErrors({});
    }

    // If dynamic fields are used, use a placeholder so Zod validation passes.
    // The backend composes the real description from customFields.
    let submitFormData = supportMode ? { ...formData, requesterId: '', company_id: '', priority: 'medium' as TicketPriority, category: 'none', assigned_to: '', notes: '', solution: '' } : { ...formData };
    if (!supportMode && customFieldValues.length > 0) {
      submitFormData = { ...submitFormData, description: 'Fältdata' };
    }

    // Validate with Zod and show inline errors
    const schema = isEditing ? ticketUpdateSchema : ticketInsertSchema;
    const validation = schema.safeParse(submitFormData);
    if (!validation.success) {
      const fieldErrors: Record<string, string> = {};
      validation.error.issues.forEach((err) => {
        const key = err.path[0] ? String(err.path[0]) : '_form';
        fieldErrors[key] = supportMode && key === 'title' && err.code === 'too_small'
          ? 'Ärenderubrik krävs.'
          : supportMode && key === 'title' && err.code === 'too_big'
            ? `Ärenderubriken får vara högst ${err.maximum} tecken.`
            : err.message;
      });
      setErrors(fieldErrors);
      if (supportMode) {
        supportInvalidFieldRef.current = document.getElementById(Object.keys(fieldErrors)[0]);
        setSupportError(fieldErrors[Object.keys(fieldErrors)[0]]);
        setSupportValidationAttempt(attempt => attempt + 1);
        return;
      }
      // Open collapsed sections if an errored field lives inside them (create
      // mode) BEFORE scrolling — otherwise the field is unmounted and scroll
      // targets nothing. Status isn't rendered in create mode, so only
      // priority (inside the Detaljer collapsible) needs auto-opening here.
      const needDetailsOpen = !isEditing && !!fieldErrors.priority;
      if (needDetailsOpen) {
        setDetailsOpen(true);
      }
      toast.error('Rätta felen i formuläret');
      // Scroll to first error field. Defer two frames when we just opened a
      // collapsible so its content mounts before we try to scroll to it.
      const scrollToFirstError = () => {
        const firstErrorEl = document.querySelector('[aria-invalid="true"]') as HTMLElement | null;
        firstErrorEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstErrorEl?.focus?.();
      };
      if (needDetailsOpen) {
        requestAnimationFrame(() => requestAnimationFrame(scrollToFirstError));
      } else {
        requestAnimationFrame(scrollToFirstError);
      }
      return;
    }

    submitLock.current = true;
    setIsSubmitting(true);
    setIsSaving(true);

    try {
      if (isEditing && id) {
        await updateTicket(id, { ...submitFormData, submission: { images: imageState.referenced({ formData, customFieldValues }) }, assigned_to: formData.assigned_to || undefined, company_id: formData.company_id || undefined }, customFieldValues.length > 0 ? customFieldValues : undefined);

        const { failedFiles, checklistFailed } = await saveExtras(id, pendingFiles, pendingChecklistItems.map(i => i.label));

        setHasUnsavedChanges(false);

        if (failedFiles.length > 0) {
          // Ticket itself saved; some attachments didn't. Show the retry banner
          // (same UX as create mode) rather than navigating away and losing them.
          setFailedUploads({ files: failedFiles, ticketId: id });
          toast.warning(`Ärendet uppdaterades, men ${failedFiles.length} fil(er) kunde inte laddas upp`);
          if (checklistFailed) toast.warning('Checklistan kunde inte läggas till');
          return;
        }

        await draft.clear();
        if (checklistFailed) toast.warning('Ärendet uppdaterades, men checklistan kunde inte läggas till');
        else toast.success('Ärendet uppdaterades');
        // Navigate back to source instead of detail page
        if (location.state?.from) {
          navigate(location.state.from);
        } else {
          navigate('/tickets');
        }
      } else {
        const extraFields = { submission: { images: imageState.referenced({ formData, customFieldValues }), attachments: supportMode ? pendingFiles : undefined, idempotencyKey: submissionKey }, selfService: supportMode, assigned_to: submitFormData.assigned_to || undefined, company_id: submitFormData.company_id || undefined };
        const ticketWithTemplate = !supportMode && selectedTemplate
          ? { ...submitFormData, templateId: selectedTemplate.id, ...extraFields }
          : { ...submitFormData, ...extraFields };
        const newTicket = await addTicket(ticketWithTemplate, !supportMode && customFieldValues.length > 0 ? customFieldValues : undefined);

        if (newTicket) {
          const { failedFiles, checklistFailed } = await saveExtras(newTicket.id, supportMode ? [] : pendingFiles, supportMode ? [] : pendingChecklistItems.map(i => i.label));

          setHasUnsavedChanges(false);
          try { localStorage.removeItem(NEW_TICKET_DRAFT_KEY); } catch { /* draft cleared */ }

          if (failedFiles.length > 0) {
            setFailedUploads({ files: failedFiles, ticketId: newTicket.id });
            toast.warning(`Ärendet skapades, men ${failedFiles.length} fil(er) kunde inte laddas upp`);
            if (checklistFailed) toast.warning('Checklistan kunde inte läggas till');
            // Don't navigate — show retry UI instead
            return;
          }

          await draft.clear();
          if (checklistFailed) toast.warning('Ärendet skapades, men checklistan kunde inte läggas till');
          else toast.success('Ärendet skapades');
          if (supportMode) setSupportSent(true);
          else navigate(`/tickets/${newTicket.id}`);
          return;
        }
      }
    } catch (error) {
      if (getErrorCode(error) === 'IDEMPOTENCY_CONFLICT') setSubmissionKey(crypto.randomUUID());
      // Mutationen har redan visat felet som toast.
      if (import.meta.env.DEV) console.error('Error submitting ticket:', error);
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
      setIsSaving(false);
    }
  };

  const clearDraft = draft.clear;
  const handleRetryUploads = useCallback(async () => {
    if (!failedUploads) return;
    setIsRetrying(true);
    const { failedFiles: stillFailed } = await saveExtras(failedUploads.ticketId, failedUploads.files);
    setIsRetrying(false);
    if (stillFailed.length > 0) {
      setFailedUploads({ ...failedUploads, files: stillFailed });
      toast.error(`${stillFailed.length} fil(er) misslyckades igen`);
    } else {
      toast.success('Alla filer uppladdade!');
      const ticketId = failedUploads.ticketId;
      await clearDraft();
      setFailedUploads(null);
      if (supportMode) setSupportSent(true);
      else navigate(`/tickets/${ticketId}`);
    }
  }, [failedUploads, saveExtras, navigate, clearDraft, supportMode]);

  const handleSkipFailedUploads = useCallback(async () => {
    // Guard against skipping mid-retry: a retry in flight may still resolve and
    // navigate, so ignore the skip until the retry settles (button is also
    // disabled, this is belt-and-suspenders against a queued click).
    if (!failedUploads || isRetrying) return;
    const ticketId = failedUploads.ticketId;
    await clearDraft();
    setFailedUploads(null);
    if (supportMode) setSupportSent(true);
    else navigate(`/tickets/${ticketId}`);
  }, [failedUploads, isRetrying, navigate, clearDraft, supportMode]);

  const handleNavigateBack = async () => {
    const goBack = () => {
      if (location.state?.from) {
        navigate(location.state.from);
      } else {
        navigate(-1);
      }
    };

    if (hasUnsavedChanges && !isSaving) {
      if (await confirm('Du har osparade ändringar. Vill du lämna sidan?', 'Lämna sidan')) {
        goBack();
      }
    } else {
      goBack();
    }
  };

  if (isEditing && ticketLoadError && !ticketDetailRow) {
    return (
      <TicketLoadError error={ticketLoadError} onRetry={() => void refetchTicket()} />
    );
  }

  if (!draft.ready) return <p role="status">Laddar utkast…</p>;

  const requester = users.find(contact => contact.id === formData.requesterId);
  const companyName = companies.find(company => company.id === formData.company_id)?.name
    || (requester?.company_id === formData.company_id ? requester?.company_name : undefined)
    || 'Valt företag';
  const companyField = (
    <div className="space-y-2">
      <Label htmlFor="ticket-company">Företag</Label>
      <Select value={formData.company_id || 'none'} onValueChange={(v) => setFormData(prev => ({ ...prev, company_id: v === 'none' ? '' : v }))} disabled={isSubmitting}>
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
  );

  const routingFields = (
    <>
        <div className="space-y-2">
          <Label id="label-category">Kategori</Label>
          <div aria-labelledby="label-category">
          <CategoryCombobox
            categories={categories}
            value={formData.category}
            onValueChange={(v) => {
              setFormData({ ...formData, category: v });
              setErrors(prev => { const p = { ...prev }; delete p['category']; return p; });
            }}
            onAddCategory={handleAddCategory}
            disabled={isSubmitting}
            aria-invalid={!!errors.category}
            aria-describedby={errors.category ? 'category-error' : undefined}
          />
          </div>
          {categoriesError && <LookupError message="Kunde inte hämta kategorier." onRetry={() => void refetchCategories()} />}
          {errors.category && <p id="category-error" role="alert" className="text-sm text-destructive mt-1">{errors.category}</p>}
        </div>

      {/* Tilldelad */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ticket-assigned">Tilldelad</Label>
          <Select value={formData.assigned_to || 'none'} onValueChange={(v) => setFormData(prev => ({ ...prev, assigned_to: v === 'none' ? '' : v }))} disabled={isSubmitting}>
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
        </div>

      </div>
    </>
  );

  if (supportSent) return <Card className="mx-auto max-w-xl"><CardContent className="space-y-4 pt-6 text-center"><h1 className="text-xl font-semibold">Ärendet skickat!</h1><p className="text-muted-foreground">Vi återkommer så snart som möjligt.</p><Button onClick={() => window.location.reload()}>Skicka ett nytt ärende</Button></CardContent></Card>;

  return (
    <ImageAdapterContext.Provider value={imageState.adapter}>
    {confirmationDialog}
    <div className="max-w-2xl mx-auto space-y-6">
      <div className={cn("flex items-center justify-between", supportMode && "hidden")}>
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

      {/* Failed upload retry banner */}
      {failedUploads && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center">
                <ArrowLeft className="w-4 h-4 text-destructive rotate-135" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Ärendet sparades, men {failedUploads.files.length} fil(er) kunde inte laddas upp
                </p>
                <ul className="mt-1 space-y-0.5">
                  {failedUploads.files.map((file, i) => (
                    <li key={i} className="text-xs text-muted-foreground truncate">
                      {file.name} ({(file.size / 1024).toFixed(0)} KB)
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-11">
              <Button
                size="sm"
                onClick={handleRetryUploads}
                disabled={isRetrying}
                className="gap-2"
              >
                {isRetrying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PlusCircle className="w-3.5 h-3.5" />
                )}
                {isRetrying ? 'Laddar upp...' : 'Försök igen'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleSkipFailedUploads}
                disabled={isRetrying}
              >
                Hoppa över
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        {!(supportMode && embedded) && <CardHeader>
          <h1 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
            {isEditing
              ? <><Pencil className="w-5 h-5 text-primary" />Redigera ärende</>
              : supportMode ? <>Vad behöver du hjälp med?</> : <><PlusCircle className="w-5 h-5 text-primary" />Skapa nytt ärende</>
            }
          </h1>
          {supportMode && <p className="text-sm text-muted-foreground">Beskriv kort vad du behöver. Vi hjälper dig vidare.</p>}
        </CardHeader>}
        <CardContent className={supportMode && embedded ? 'pt-4' : undefined}>
          <form onSubmit={handleSubmit} noValidate={supportMode}>
            <fieldset disabled={isSubmitting} className="min-w-0 space-y-4">
            {supportError && <div ref={supportErrorRef} role="alert" tabIndex={-1} className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{supportError}</div>}
            {draft.restoreError && <p role="alert" className="text-sm text-destructive">Det sparade utkastet kunde inte återställas. Du kan fylla i ett nytt ärende.</p>}
            {draft.storageError && <p role="alert" className="text-sm text-destructive">Utkastet kan inte sparas på den här enheten. Håll sidan öppen tills ärendet sparats.</p>}

            {/* Titel + Mall row */}
            <div className="flex flex-col gap-4">
              {!isEditing && (
                <details className="group space-y-2" open={selectedTemplate ? true : undefined}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-sm text-primary [&::-webkit-details-marker]:hidden">Ta hjälp av en mall<ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
                  <Label id="label-template">Mall</Label>
                  <div aria-labelledby="label-template">
                  <TemplateCombobox
                    templates={templates}
                    selectedTemplate={selectedTemplate}
                    onSelect={async (template) => {
                      if ((customFieldValues.some(v => hasVisibleText(v.fieldValue) || /<img\b/i.test(v.fieldValue)) || hasVisibleText(formData.notes) || hasVisibleText(formData.solution) || /<img\b/i.test(formData.notes + formData.solution) || hasVisibleText(formData.description) || /<img\b/i.test(formData.description)) && !await confirm('Dina ifyllda mallsvar och beskrivningen ersätts när du byter mall.')) return;
                      setEditInitialFieldValues([]);
                      const hasFields = template.fields && template.fields.length > 0;
                      setSelectedTemplate(template);
                      setFormData({
                        ...formData,
                        title: template.titleTemplate,
                        description: supportMode ? (template.descriptionTemplate || formData.description) : hasFields ? '' : (template.descriptionTemplate ?? ''),
                        priority: template.priority,
                        category: template.category || 'none',
                        notes: hasFields ? '' : (template.notesTemplate || ''),
                        solution: hasFields ? '' : (template.solutionTemplate || ''),
                      });
                      toast.success(`Mall "${template.name}" laddad`);
                    }}
                    onClear={async () => {
                      if (customFieldValues.some(v => hasVisibleText(v.fieldValue) || /<img\b/i.test(v.fieldValue)) && !await confirm('Dina ifyllda mallsvar tas bort när du rensar mallen.', 'Rensa mall')) return;
                      if (isEditing && existingTicket && !formData.description) {
                        setFormData(prev => ({ ...prev, description: existingTicket.description }));
                      }
                      setSelectedTemplate(null);
                      setCustomFieldValues([]);
                      setEditInitialFieldValues([]);
                    }}
                  />
                  </div>
                  {templatesError && <LookupError message="Kunde inte hämta mallar." onRetry={() => void refetchTemplates()} />}
                </details>
              )}
              <div className="space-y-2">
                <Label htmlFor="title">{supportMode ? "Kort rubrik *" : "Titel *"}</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => { setFormData({ ...formData, title: e.target.value }); setErrors(prev => { const p = { ...prev }; delete p['title']; return p; }); }}
                  placeholder="Kort beskrivning av problemet"
                  required
                  maxLength={ticketInsertSchema.shape.title.maxLength ?? undefined}
                  disabled={isSubmitting}
                  // Autofocus only on create — editing an existing ticket
                  // shouldn't steal focus on mount (user may be scrolling
                  // to a specific field, and autofocus jumps the viewport).
                  autoFocus={!isEditing}
                  aria-required="true"
                  aria-invalid={!!errors.title}
                  aria-describedby={errors.title ? 'title-error' : undefined}
                  className={errors.title ? 'border-destructive focus-visible:ring-destructive' : ''}
                />
                {errors.title && <p id="title-error" role={supportMode ? undefined : 'alert'} className="text-sm text-destructive mt-1">{errors.title}</p>}
              </div>

            </div>

              {!supportMode && <div className="space-y-2">
                <Label id="label-requester">Beställare *</Label>
                <div aria-labelledby="label-requester">
                <UserCombobox
                  users={users}
                  value={formData.requesterId}
                  onValueChange={(v) => {
                    const contact = users.find(u => u.id === v);
                    const autoCompany = contact?.company_id || '';
                    setFormData(prev => ({ ...prev, requesterId: v, company_id: autoCompany }));
                    setErrors(prev => { const p = { ...prev }; delete p['requesterId']; return p; });
                  }}
                  placeholder="Sök kontakt"
                  aria-required={true}
                  aria-invalid={!!errors.requesterId}
                  aria-describedby={errors.requesterId ? 'requester-error' : undefined}
                />
                </div>
                {users.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    <a href="/users" className="text-primary hover:underline">Lägg till kontakt</a> för att tilldela ärenden
                  </p>
                )}
                {formData.company_id && (
                  <p className="text-sm text-muted-foreground">Företag: {companyName} — kan ändras under Fler uppgifter.</p>
                )}
                {errors.requesterId && <p id="requester-error" role="alert" className="text-sm text-destructive mt-1">{errors.requesterId}</p>}
              </div>}
            {/* Beskrivning / DynamicFieldsForm */}
            {isLoadingTemplate ? (
              <div className="border border-dashed border-muted p-4 rounded text-center text-sm text-muted-foreground">
                Laddar mallfält...
              </div>
            ) : !supportMode && selectedTemplate && selectedTemplate.fields && selectedTemplate.fields.length > 0 ? (
              <div>
                <ErrorBoundary
                  fallback={
                    <p className="text-sm text-destructive border border-destructive/30 rounded-md p-3">
                      Kunde inte visa mallfälten. Rensa mallen och skriv en fri beskrivning istället.
                    </p>
                  }
                >
                  <DynamicFieldsForm
                    requester={requester ? { name: requester.name, email: requester.email, actionLabel: 'Samma som beställaren' } : undefined}
                    disabled={isSubmitting}
                    onImageBusyChange={onImageBusyChange}
                    fields={selectedTemplate.fields}
                    onValuesChange={handleCustomFieldsChange}
                    initialValues={editInitialFieldValues.length > 0 ? editInitialFieldValues : undefined}
                    errors={dynamicFieldErrors}
                  />
                </ErrorBoundary>

                {/* Ytterligare information section */}
                <div className="mt-6 border-t pt-4">
                  <Label htmlFor="additional_notes" className="text-sm text-muted-foreground">
                    Ytterligare information (valfritt)
                  </Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Lägg till extra detaljer som inte passar i standardfälten ovan
                  </p>
                  <ErrorBoundary
                    fallback={
                      <p className="text-sm text-destructive">Textredigeraren kunde inte laddas.</p>
                    }
                  >
                    <RichTextEditor
                      disabled={isSubmitting}
                      onImageBusyChange={onImageBusyChange}
                      value={formData.notes || ''}
                      onChange={(html) => {
                        setFormData({ ...formData, notes: html });
                      }}
                      placeholder="Övrig information, kommentarer, specialfall..."
                      minHeight="100px"
                    />
                  </ErrorBoundary>
                </div>

                <button
                  type="button"
                  className="mt-2 text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={async () => {
                    if (customFieldValues.some(v => hasVisibleText(v.fieldValue) || /<img\b/i.test(v.fieldValue)) && !await confirm('Dina ifyllda mallsvar tas bort när du rensar mallen.', 'Rensa mall')) return;
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
                  {supportMode ? `Berätta lite mer${pendingFiles.length === 0 && !/<img\b/i.test(formData.description) ? ' *' : ''}` : "Beskrivning (valfritt)"}
                </Label>
                <div className={errors.description ? 'rounded-md ring-2 ring-destructive ring-offset-1' : ''}>
                  <ErrorBoundary
                    fallback={
                      <p className="text-sm text-destructive border border-destructive/30 rounded-md p-3">
                        Textredigeraren kunde inte laddas. Ladda om sidan och försök igen.
                      </p>
                    }
                  >
                    <RichTextEditor
                      disabled={isSubmitting}
                      onImageBusyChange={onImageBusyChange}
                      value={formData.description}
                      onChange={(html) => { setFormData({ ...formData, description: html }); setErrors(prev => { const p = { ...prev }; delete p['description']; return p; }); }}
                      placeholder="Vad vill du kunna göra, eller vad händer när du försöker?"
                      minHeight="90px"
                      compact
                      id="description"
                      ariaLabel={supportMode ? "Berätta lite mer" : "Beskrivning (valfritt)"}
                      ariaRequired={supportMode && pendingFiles.length === 0 && !/<img\b/i.test(formData.description)}
                      error={!!errors.description}
                      describedBy="description-error"
                    />
                  </ErrorBoundary>
                </div>
                {errors.description && <p id="description-error" role={supportMode ? undefined : 'alert'} className="text-sm text-destructive mt-1">{errors.description}</p>}
              </div>
            )}

            {/* Detaljer collapsible — collapsed in create mode, always open in edit mode */}
            {isEditing ? (
              <div className="space-y-4">
                <h2 className="font-medium">Detaljer</h2>
                                {routingFields}
                {companyField}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ticket-priority-edit">Prioritet</Label>
                    <Select
                      value={formData.priority}
                      onValueChange={(v) => { setFormData({ ...formData, priority: v as TicketPriority }); setErrors(prev => { const p = { ...prev }; delete p['priority']; return p; }); }}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger
                        id="ticket-priority-edit"
                        aria-invalid={!!errors.priority}
                        aria-describedby={errors.priority ? 'priority-error-edit' : undefined}
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
                    {errors.priority && <p id="priority-error-edit" role="alert" className="text-sm text-destructive mt-1">{errors.priority}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ticket-status-edit">Status</Label>
                    <Select
                      value={formData.status}
                      onValueChange={(v) => { setFormData({ ...formData, status: v as TicketStatus }); setErrors(prev => { const p = { ...prev }; delete p['status']; return p; }); }}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger
                        id="ticket-status-edit"
                        aria-invalid={!!errors.status}
                        aria-describedby={errors.status ? 'status-error' : undefined}
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
                    {errors.status && <p id="status-error" role="alert" className="text-sm text-destructive mt-1">{errors.status}</p>}
                  </div>
                </div>
              </div>
            ) : !supportMode ? (
              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-card px-4 h-11 text-sm font-semibold hover:bg-accent/10 transition-colors">
                  <span>Fler uppgifter</span>
                  <div className="flex items-center gap-2">
                    {detailsBadgeCount > 0 && (
                      <span className="text-xs text-muted-foreground">{detailsBadgeCount} valt</span>
                    )}
                    <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', detailsOpen && 'rotate-180')} />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                  <div className="space-y-4 pt-4">
                                    {routingFields}
                {companyField}
                    <div className="space-y-2">
                      <Label htmlFor="ticket-priority-create">Prioritet</Label>
                      <Select
                        value={formData.priority}
                        onValueChange={(v) => { setFormData({ ...formData, priority: v as TicketPriority }); setErrors(prev => { const p = { ...prev }; delete p['priority']; return p; }); }}
                        disabled={isSubmitting}
                      >
                        <SelectTrigger
                          id="ticket-priority-create"
                          aria-invalid={!!errors.priority}
                          aria-describedby={errors.priority ? 'priority-error-create' : undefined}
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
                      {errors.priority && <p id="priority-error-create" role="alert" className="text-sm text-destructive mt-1">{errors.priority}</p>}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : null}

            {!isEditing && (<>
                    {/* File Attachments */}
                    <div className="space-y-2">
                      <Label>Bilagor (valfritt)</Label>
                      <FileUpload
                    compact={!isEditing}
                        attachments={attachments}
                        pendingFiles={pendingFiles}
                        onFilesSelect={handleFilesSelect}
                        onRemovePending={handleRemovePending}
                        onRemoveAttachment={handleRemoveAttachment}
                        isUploading={isUploading}
                        disabled={isSubmitting}
                      />
                    </div>

            </>)}
            {/* Bilagor & Checklista collapsible — collapsed in create mode, always open in edit mode */}
            {isEditing ? (
              <div className="space-y-4">
                {/* File Attachments */}
                <div className="space-y-2">
                  <Label>Bilagor (valfritt)</Label>
                  <FileUpload
                    compact={!isEditing}
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
            ) : !supportMode ? (
              <Collapsible open={attachmentsOpen} onOpenChange={setAttachmentsOpen}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-card px-4 h-11 text-sm font-semibold hover:bg-accent/10 transition-colors">
                  <span>Checklista</span>
                  <div className="flex items-center gap-2">
                    {attachmentsBadgeCount > 0 && (
                      <span className="text-xs text-muted-foreground">{attachmentsBadgeCount} valt</span>
                    )}
                    <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', attachmentsOpen && 'rotate-180')} />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                  <div className="space-y-4 pt-4">
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
            ) : null}

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
                      disabled={isSubmitting}
                      onImageBusyChange={onImageBusyChange}
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
                      disabled={isSubmitting}
                      onImageBusyChange={onImageBusyChange}
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

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">
              {supportMode && <div className="mr-auto"><SupportSender name={senderName} photo={matchingProfile?.photo} /></div>}
              <span aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground flex items-center gap-2">
                {uploadProgress && (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {uploadProgress}
                  </>
                )}
              </span>
              <Button type="button" variant="outline" onClick={handleNavigateBack} disabled={isSaving} className={supportMode ? "hidden" : undefined}>
                Avbryt
              </Button>
              <Button type="submit" disabled={isSubmitting || isUploading || isSaving || !!failedUploads || imageBusy > 0 || !draft.ready} className="gap-2">
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Sparar...</>
                ) : isEditing ? 'Spara ändringar' : supportMode ? 'Skicka till IT' : 'Skapa ärende'}
              </Button>
            </div>
            </fieldset>
          </form>
        </CardContent>
      </Card>
    </div>
    </ImageAdapterContext.Provider>
  );
};

// Remount when draft ownership or edited ticket changes; state must never cross scopes.
const ScopedTicketForm = ({ selfService = false, embedded = false }: { selfService?: boolean; embedded?: boolean }) => {
  const { id } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const supportMode = new URLSearchParams(location.search).get('support') === '1';
  return <TicketForm selfService={selfService} embedded={embedded} key={`${user?.id}:${id || 'new'}:${selfService || supportMode}`} />;
};
export default ScopedTicketForm;
