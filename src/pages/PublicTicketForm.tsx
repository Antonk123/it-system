import { useSupportProfile, type SupportProfile } from '@/hooks/useSupportProfile';
import { FileUpload } from '@/components/FileUpload';
import { SupportSender } from '@/components/SupportSender';
import { getErrorCode } from '@/lib/apiErrorStatus';
import { useConfirmDiscard } from '@/hooks/useConfirmDiscard';
import { hasVisibleText } from '@/lib/textValidation';
import { ImageAdapterContext, useTicketImages } from '@/lib/ticketImages';
import { useTicketDraft } from '@/hooks/useTicketDraft';
import { requiredTemplateFieldErrors } from '@/lib/templateValidation';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { CheckCircle, Send, AlertCircle, Loader2, ArrowLeft, FileText, ChevronDown } from 'lucide-react';
import TicketForm from './TicketForm';
import { Link, useSearchParams } from 'react-router';
import { api, CustomFieldInput, TemplateFieldRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DynamicFieldsForm } from '@/components/DynamicFieldsForm';
import { BrandLogo } from '@/components/BrandLogo';
import { cn } from '@/lib/utils';

interface Category { id: string; label: string; }
interface Template {
  id: string;
  name: string;
  description: string | null;
  title_template: string;
  description_template: string;
  priority: string;
  category_id: string | null;
  fields?: TemplateFieldRow[];
}

const PublicTicketForm = ({ profile, embedded }: { profile: SupportProfile | null; embedded: boolean }) => {
  const { confirm, confirmationDialog } = useConfirmDiscard();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const errorBannerRef = useRef<HTMLDivElement>(null);
  const invalidFieldRef = useRef<HTMLElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Skräpfångst: botar fyller i det dolda fältet, och servern avvisar formulär
  // som skickas in direkt efter att sidan öppnats.
  const [website, setWebsite] = useState('');
  const [formStartedAt, setFormStartedAt] = useState(() => Date.now());
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldInput[]>([]);
  const [formData, setFormData] = useState({ name: '', email: '', title: '', description: '', category: '', priority: 'medium' });

  const imageState = useTicketImages(true);
  const submitLock = useRef(false);
  const [imageBusy, setImageBusy] = useState(0);
  const onImageBusyChange = useCallback((busy: boolean) => setImageBusy(count => Math.max(0, count + (busy ? 1 : -1))), []);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());
  const dirty = pendingFiles.length > 0 || !!(formData.name || formData.email || formData.title || hasVisibleText(formData.description) || /<img\b/i.test(formData.description) || customFieldValues.some(v => hasVisibleText(v.fieldValue) || /<img\b/i.test(v.fieldValue)) || imageState.images.length);
  const [initialValues, setInitialValues] = useState<CustomFieldInput[]>([]);
  const draftValue = useMemo(() => ({ pendingFiles, formData, selectedTemplate, customFieldValues, images: imageState.images, submissionKey, formStartedAt }), [pendingFiles, formData, selectedTemplate, customFieldValues, imageState.images, submissionKey, formStartedAt]);
  const draft = useTicketDraft(profile ? `public:support:${profile.email.toLowerCase()}` : embedded ? 'public:support:anonymous' : 'public:new', draftValue, dirty && !isSuccess, saved => {
    setPendingFiles(saved.pendingFiles || []);
    setFormData(saved.formData); setSelectedTemplate(saved.selectedTemplate); setCustomFieldValues(saved.customFieldValues);
    setInitialValues(saved.customFieldValues); imageState.setImages(saved.images); setSubmissionKey(saved.submissionKey); setFormStartedAt(saved.formStartedAt);
  });
  useEffect(() => {
    if (imageBusy || !draft.ready) return;
    const used = imageState.referenced({ formData, customFieldValues });
    if (used.length !== imageState.images.length) imageState.setImages(used);
  }, [formData, customFieldValues, imageBusy, imageState, draft.ready]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [categoriesData, templatesData] = await Promise.all([
          api.getPublicCategories(),
          api.getPublicTemplates(),
        ]);
        setCategories(categoriesData);
        setTemplates(templatesData);
      } catch {
        setLoadError(true);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (!error) return;
    errorBannerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    (invalidFieldRef.current ?? errorBannerRef.current)?.focus({ preventScroll: true });
    invalidFieldRef.current = null;
  }, [error, validationAttempt]);

  if (!draft.ready) return <div className="p-6 text-center"><Loader2 aria-label="Laddar formulär" className="h-6 w-6 animate-spin" /></div>;

  const handleTemplateSelect = async (templateId: string) => {
    if (templateId === selectedTemplate?.id) return;
    if ((customFieldValues.some(v => hasVisibleText(v.fieldValue) || /<img\b/i.test(v.fieldValue)) || hasVisibleText(formData.description) || /<img\b/i.test(formData.description)) && !await confirm('Dina ifyllda mallsvar och beskrivningen ersätts när du byter mall.')) return;
    setInitialValues([]); setCustomFieldValues([]); setFieldErrors({});
    if (templateId === 'none') {
      setSelectedTemplate(null);
      setCustomFieldValues([]);
      setFormData({ name: formData.name, email: formData.email, title: '', description: '', category: '', priority: 'medium' });
      return;
    }
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(template);
      setFormData({
        ...formData,
        title: template.title_template,
        description: embedded ? (template.description_template || formData.description) : template.fields && template.fields.length > 0 ? '' : template.description_template,
        category: template.category_id || '',
        priority: template.priority,
      });
    }
  };

  const usesDynamicFields = !embedded && !!(selectedTemplate && selectedTemplate.fields && selectedTemplate.fields.length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (submitLock.current || imageBusy || !draft.ready) return;
    const form = e.currentTarget as HTMLFormElement;
    const validationError = (message: string, field: HTMLElement | null) => {
      invalidFieldRef.current = field;
      setError(message);
      setValidationAttempt(attempt => attempt + 1);
    };
    const focusableField = (id: string) => {
      const field = document.getElementById(id);
      return field?.querySelector<HTMLElement>('[contenteditable="true"]') ?? field;
    };
    const badInput = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="number"], input[type="date"]'))
      .find(input => input.validity.badInput);
    if (badInput) {
      validationError(`Ange ett giltigt värde för ${badInput.labels?.[0]?.textContent?.replace(/\s*\*\s*$/, '').trim() || 'fältet'}.`, badInput);
      return;
    }

    const errors = requiredTemplateFieldErrors(embedded ? [] : selectedTemplate?.fields || [], customFieldValues);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      validationError('Fyll i obligatoriska mallfält.', focusableField(Object.keys(errors)[0]));
      return;
    }

    if (!formData.title.trim()) {
      validationError('Ärenderubrik krävs.', focusableField('title'));
      return;
    }

    if (!(profile?.name || formData.name).trim() || !(profile?.email || formData.email).trim()) {
      validationError('Fyll i namn och e-post.', focusableField(!formData.name.trim() ? 'name' : 'email'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile?.email || formData.email)) {
      validationError('Ange en giltig e-postadress.', focusableField('email'));
      return;
    }

    if (!hasVisibleText(formData.description) && !/<img\b/i.test(formData.description)
      && pendingFiles.length === 0
      && !customFieldValues.some(v => hasVisibleText(v.fieldValue) || /<img\b/i.test(v.fieldValue))) {
      validationError('Skriv en kort beskrivning eller bifoga en bild.', focusableField('description'));
      return;
    }

    submitLock.current = true;
    setIsSubmitting(true);
    try {
      await api.submitPublicTicket({
        name: profile?.name || formData.name,
        email: profile?.email || formData.email,
        title: formData.title,
        description: formData.description,
        category: embedded ? undefined : formData.category || undefined,
        priority: embedded ? 'medium' : formData.priority,
        customFields: !embedded && customFieldValues.length > 0 ? customFieldValues : undefined,
        template_id: embedded ? undefined : selectedTemplate?.id,
        website,
        formStartedAt,
      }, { images: imageState.referenced({ formData, customFieldValues }), attachments: pendingFiles, idempotencyKey: submissionKey });
      await draft.clear();
      setIsSuccess(true);
    } catch (err) {
      if (getErrorCode(err) === 'IDEMPOTENCY_CONFLICT') setSubmissionKey(crypto.randomUUID());
      setError(err instanceof Error ? err.message : 'Ett oväntat fel uppstod');
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setPendingFiles([]);
    draft.resume(); imageState.setImages([]); setInitialValues([]); setSubmissionKey(crypto.randomUUID());
    setFormData({ name: '', email: '', title: '', description: '', category: '', priority: 'medium' });
    setSelectedTemplate(null);
    setCustomFieldValues([]);
    setIsSuccess(false);
    setError(null);
    setWebsite('');
    setFormStartedAt(Date.now());
  };

  const inputClass = "h-11 rounded-md bg-input border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";
  const selectTriggerClass = "h-11 rounded-md bg-input border-border text-foreground focus:ring-2 focus:ring-ring";
  const descriptionRequired = pendingFiles.length === 0 && !/<img\b/i.test(formData.description);

  // ── Success state ─────────────────────────────────────────────
  if (isSuccess) {
    return (
      <div className={cn("flex items-center justify-center bg-background p-4", embedded ? "py-8" : "min-h-dvh")}>
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-md bg-primary/10 border border-primary/30 mb-6">
            <CheckCircle className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">Ärendet skickat!</h2>
          <p className="text-muted-foreground mb-8">Tack för att du kontaktar oss. Vi återkommer så snart som möjligt.</p>
          <div className="bg-card border border-border rounded-lg p-6 flex flex-col gap-3">
            <Button
              onClick={handleReset}
              className="w-full h-11 rounded-md font-semibold"
            >
              Skicka ett nytt ärende
            </Button>
            {!embedded && (
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Tillbaka till inloggning
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────
  return (
    <ImageAdapterContext.Provider value={imageState.adapter}>
    {confirmationDialog}
    <div className={cn("bg-background flex items-start justify-center", embedded ? "p-0" : "min-h-dvh p-4 py-10")}>
      <div className="w-full max-w-2xl">
        {/* Brand header — the host page carries it when embedded */}
        {!embedded && (
          <div className="text-center mb-8">
            <div className="inline-flex w-14 h-14 rounded-md overflow-hidden mb-5 border border-border">
              {/* Icke-tom alt: rubriken här är formulärets syfte ("Skicka en
                  supportförfrågan"), inte appnamnet — logotypen är enda varumärkesbäraren
                  på den här oinloggade sidan. */}
              <BrandLogo alt="IT-Ticket" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">Skicka en supportförfrågan</h1>
            <p className="text-sm text-muted-foreground mt-1.5">Fyll i formuläret så återkommer vi så snart som möjligt.</p>
          </div>
        )}

        {/* Card */}
        <div className="bg-card border border-border rounded-lg p-6 sm:p-8">
          <form onSubmit={handleSubmit} noValidate>
            <fieldset disabled={isSubmitting} className="min-w-0 space-y-5">
            {draft.restoreError && <p role="alert" className="text-sm text-destructive">Det sparade utkastet kunde inte återställas. Du kan fylla i ett nytt ärende.</p>}
            {draft.storageError && <p role="alert" className="text-sm text-destructive">Utkastet kan inte sparas på den här enheten. Håll sidan öppen tills ärendet skickats.</p>}


            {/* Error */}
            {error && (
              <div ref={errorBannerRef} role="alert" tabIndex={-1} className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {loadError && (
              <p role="status" className="text-sm text-muted-foreground">
                Kunde inte ladda kategorier och mallar. Du kan ändå skicka in ärendet.
              </p>
            )}

            <div aria-hidden="true" className="sr-only">
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            {/* Name + Email */}
            {!profile && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-foreground text-sm font-medium">Ditt namn *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Johan Andersson"
                  className={inputClass}
                  autoComplete="name"
                  required
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-foreground text-sm font-medium">Din e-post *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="namn@example.com"
                  className={inputClass}
                  autoComplete="email"
                  required
                  maxLength={255}
                />
                <p className="text-xs text-muted-foreground">Vi svarar till den här adressen.</p>
              </div>
            </div>

            }
            {/* Template */}
            {templates.length > 0 && (
              <details className="group space-y-2"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-primary [&::-webkit-details-marker]:hidden"><FileText aria-hidden="true" className="h-4 w-4" />Ta hjälp av en mall<ChevronDown aria-hidden="true" className="h-4 w-4 group-open:rotate-180" /></summary>
                <Label htmlFor="template" className="text-foreground text-sm font-medium flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  Mall (valfritt)
                </Label>
                <Select value={selectedTemplate?.id || ''} onValueChange={handleTemplateSelect}>
                  <SelectTrigger id="template" className={selectTriggerClass}>
                    <SelectValue placeholder="Välj en mall för att förfylla formuläret">{selectedTemplate?.name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ingen mall</SelectItem>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{template.name}</span>
                          {template.description && (
                            <span className="text-xs text-muted-foreground">{template.description}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </details>
            )}

            {/* Dynamic fields */}
            {usesDynamicFields && (
              <DynamicFieldsForm
                requester={{ name: formData.name, email: formData.email, actionLabel: 'Gäller mig' }}
                fields={selectedTemplate!.fields!}
                onValuesChange={setCustomFieldValues}
                initialValues={initialValues}
                errors={fieldErrors}
                disabled={isSubmitting || imageBusy > 0 || !draft.ready}
                onImageBusyChange={onImageBusyChange}
              />
            )}

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title" className="text-foreground text-sm font-medium">{embedded ? "Kort rubrik *" : "Ärendets titel *"}</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Kort sammanfattning av problemet"
                className={inputClass}
                required
                maxLength={200}
              />
            </div>

            {/* Description */}
            {!usesDynamicFields && (
              <div className="space-y-1.5">
                <Label htmlFor="description" className="text-foreground text-sm font-medium">{embedded ? "Berätta lite mer" : "Beskrivning"}{descriptionRequired ? ' *' : ''}</Label>
                <RichTextEditor
                  onImageBusyChange={onImageBusyChange}
                  disabled={isSubmitting || imageBusy > 0 || !draft.ready}
                  value={formData.description}
                  onChange={(html) => setFormData({ ...formData, description: html })}
                  placeholder="Beskriv ditt problem i detalj..."
                  minHeight="100px"
                  compact
                  id="description"
                  ariaLabel={embedded ? "Berätta lite mer" : "Beskrivning"}
                  required={descriptionRequired}
                />
                <p className="text-xs text-muted-foreground">Ta gärna med eventuella felmeddelanden eller vad du redan provat.</p>
              </div>
            )}

            {/* Category — chip row: whole list visible, one tap to pick, no
                open-then-choose dropdown. Structure borrowed from 21st.dev's
                recurring "category chips" pattern in support forms, redrawn
                in Forge's own flat tags (rounded-sm, not the source's pill).
                Priority is deliberately not asked here — a first-time
                reporter rarely judges urgency well, and IT sets it at
                triage in the internal tool instead; new tickets default
                to medium (or whatever a chosen template specifies). */}
            {!embedded && categories.length > 0 && (
              <div className="space-y-1.5">
                <details className="group"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">Kategori (valfritt)<ChevronDown aria-hidden="true" className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((cat) => {
                    const selected = formData.category === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setFormData({ ...formData, category: selected ? '' : cat.id })}
                        aria-pressed={selected}
                        className={cn(
                          'rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        )}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
                </details>
              </div>
            )}

            <div className="space-y-2">
              <Label>Bilagor (valfritt)</Label>
              <FileUpload compact attachments={[]} pendingFiles={pendingFiles}
                onFilesSelect={files => setPendingFiles(previous => [...previous, ...files])}
                onRemovePending={index => setPendingFiles(previous => previous.filter((_, i) => i !== index))}
                onRemoveAttachment={() => {}} disabled={isSubmitting} />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">
            {profile && <div className="mr-auto"><SupportSender name={profile.name} photo={profile.photo} /></div>}
            {/* Submit */}
            <Button
              type="submit"
              className="h-11 rounded-md font-semibold"
              disabled={isSubmitting || imageBusy > 0 || !draft.ready}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Skickar...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  {embedded ? "Skicka till IT" : "Skicka ärende"}
                </>
              )}
            </Button>
            </div>
            </fieldset>
          </form>
        </div>

        {/* Back link */}
        {!embedded && (
          <div className="text-center mt-6">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Tillbaka till inloggning
            </Link>
          </div>
        )}
      </div>
    </div>
    </ImageAdapterContext.Provider>
  );
};

const SupportEntry = () => {
  const { user, isLoading } = useAuth();
  const [params] = useSearchParams();
  const embedded = params.get('embed') === '1';
  const profile = useSupportProfile(embedded);
  if (isLoading) return <div className="p-6"><Loader2 aria-label="Laddar formulär" className="h-6 w-6 animate-spin" /></div>;
  if (user) return <div className={cn('bg-background', !embedded && 'px-4 py-6')}><TicketForm selfService embedded={embedded} /></div>;
  return <PublicTicketForm key={profile?.email.toLowerCase() || 'anonymous'} profile={profile} embedded={embedded} />;
};
export default SupportEntry;
