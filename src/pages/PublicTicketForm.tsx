import { useState, useEffect } from 'react';
import { CheckCircle, Send, AlertCircle, Loader2, ArrowLeft, FileText } from 'lucide-react';
import { Link, Navigate } from 'react-router';
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

const PublicTicketForm = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldInput[]>([]);
  const [formData, setFormData] = useState({ name: '', email: '', title: '', description: '', category: '', priority: 'medium' });

  const { user, isLoading: isAuthLoading } = useAuth();

  useEffect(() => {
    // Skip data fetch if we'll redirect a logged-in user — saves a wasted call.
    if (isAuthLoading || user) return;
    const fetchData = async () => {
      try {
        const [categoriesData, templatesData] = await Promise.all([
          api.getPublicCategories(),
          api.getPublicTemplates(),
        ]);
        setCategories(categoriesData);
        setTemplates(templatesData);
      } catch (e) { /* ignore */ }
    };
    fetchData();
  }, [isAuthLoading, user]);

  // Logged-in users go to the internal ticket form. The minimal "logged-in" branch
  // of this public form discarded most fields and didn't support attachments —
  // routing them to /tickets/new is the right experience anyway.
  if (isAuthLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (user) {
    return <Navigate to="/tickets/new" replace />;
  }

  const handleTemplateSelect = (templateId: string) => {
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
        description: template.fields && template.fields.length > 0 ? '' : template.description_template,
        category: template.category_id || '',
        priority: template.priority,
      });
    }
  };

  const usesDynamicFields = !!(selectedTemplate && selectedTemplate.fields && selectedTemplate.fields.length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.title.trim()) {
      setError('Ärenderubrik krävs.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.submitPublicTicket({
        name: formData.name,
        email: formData.email,
        title: formData.title,
        description: formData.description,
        category: formData.category || undefined,
        priority: formData.priority,
        customFields: customFieldValues.length > 0 ? customFieldValues : undefined,
        template_id: selectedTemplate?.id,
      });
      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ett oväntat fel uppstod');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormData({ name: '', email: '', title: '', description: '', category: '', priority: 'medium' });
    setSelectedTemplate(null);
    setCustomFieldValues([]);
    setIsSuccess(false);
    setError(null);
  };

  const inputClass = "h-11 rounded-md bg-input border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";
  const selectTriggerClass = "h-11 rounded-md bg-input border-border text-foreground focus:ring-2 focus:ring-ring";

  // ── Success state ─────────────────────────────────────────────
  if (isSuccess) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background p-4">
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
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Tillbaka till inloggning
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────
  return (
    <div className="min-h-dvh bg-background flex items-start justify-center p-4 py-10">
      <div className="w-full max-w-lg">
        {/* Brand header */}
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

        {/* Card */}
        <div className="bg-card border border-border rounded-lg p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Name + Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            {/* Template */}
            {templates.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="template" className="text-foreground text-sm font-medium flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  Använd mall (valfritt)
                </Label>
                <Select value={selectedTemplate?.id || ''} onValueChange={handleTemplateSelect}>
                  <SelectTrigger id="template" className={selectTriggerClass}>
                    <SelectValue placeholder="Välj en mall för att förfylla formuläret" />
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
              </div>
            )}

            {/* Dynamic fields */}
            {usesDynamicFields && (
              <DynamicFieldsForm
                fields={selectedTemplate!.fields!}
                onValuesChange={setCustomFieldValues}
              />
            )}

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title" className="text-foreground text-sm font-medium">Ärendets titel *</Label>
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
                <Label htmlFor="description" className="text-foreground text-sm font-medium">Beskrivning *</Label>
                <RichTextEditor
                  value={formData.description}
                  onChange={(html) => setFormData({ ...formData, description: html })}
                  placeholder="Beskriv ditt problem i detalj..."
                  minHeight="160px"
                  required
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
            {categories.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-foreground text-sm font-medium">Kategori</Label>
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
              </div>
            )}

            {/* Attachment hint — public form does not support direct upload */}
            <p className="text-xs text-muted-foreground text-center">
              Behöver du bifoga filer? Svara på bekräftelsemailet du får efter att ärendet skickats — bilagor läggs då till automatiskt.
            </p>

            {/* Submit */}
            <Button
              type="submit"
              className="w-full h-11 rounded-md font-semibold"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Skickar...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Skicka ärende
                </>
              )}
            </Button>
          </form>
        </div>

        {/* Back link */}
        <div className="text-center mt-6">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Tillbaka till inloggning
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PublicTicketForm;
