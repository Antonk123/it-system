import { useState, useEffect } from 'react';
import { CheckCircle, Send, AlertCircle, Loader2, ArrowLeft, Sparkles, ThumbsUp, ArrowRight, FileText, Check } from 'lucide-react';
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

const STEPS = [
  { id: 1, label: 'Beskriv problemet' },
  { id: 2, label: 'Dina uppgifter' },
] as const;

const PublicTicketForm = () => {
  const [step, setStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldInput[]>([]);
  const [formData, setFormData] = useState({ name: '', email: '', title: '', description: '', category: '', priority: 'medium' });
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{
    deflectionId: string;
    hasSolution: boolean;
    solution: string | null;
    kbReferences: { id: string; title: string }[];
  } | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiSolved, setAiSolved] = useState(false);

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

  const descriptionText = formData.description.replace(/<[^>]*>/g, '').trim();
  const usesDynamicFields = !!(selectedTemplate && selectedTemplate.fields && selectedTemplate.fields.length > 0);

  const handleContinue = () => {
    if (!formData.title.trim()) {
      setStep1Error('Ärenderubrik krävs.');
      return;
    }
    if (!usesDynamicFields && descriptionText.length === 0) {
      setStep1Error('Beskrivning krävs.');
      return;
    }
    setStep1Error(null);
    setStep(2);
  };

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

  const handleAiSuggest = async () => {
    if (descriptionText.length < 20) return;
    setIsAiLoading(true);
    try {
      const result = await api.requestAiSuggestion(descriptionText, formData.email || undefined);
      setAiSuggestion(result);
    } catch {
      setAiSuggestion(null);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAiSolved = async () => {
    if (aiSuggestion) {
      await api.reportDeflectionOutcome(aiSuggestion.deflectionId, 'solved').catch(() => {});
    }
    setAiSolved(true);
  };

  const handleAiRejected = async () => {
    if (aiSuggestion) {
      await api.reportDeflectionOutcome(aiSuggestion.deflectionId, 'rejected').catch(() => {});
    }
    setAiSuggestion(null);
  };

  const handleReset = () => {
    setFormData({ name: '', email: '', title: '', description: '', category: '', priority: 'medium' });
    setSelectedTemplate(null);
    setCustomFieldValues([]);
    setIsSuccess(false);
    setError(null);
    setAiSuggestion(null);
    setStep1Error(null);
    setStep(1);
  };

  const inputClass = "h-11 rounded-md bg-input border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";
  const selectTriggerClass = "h-11 rounded-md bg-input border-border text-foreground focus:ring-2 focus:ring-ring";

  // ── AI solved — deflection success ────────────────────────────
  if (aiSolved) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-md bg-success/10 border border-success/30 mb-6">
            <ThumbsUp className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">Glad att det löste sig!</h2>
          <p className="text-muted-foreground mb-8">Inget ärende behövde skapas. Kontakta oss gärna igen om du behöver mer hjälp.</p>
          <div className="bg-card border border-border rounded-lg p-6 flex flex-col gap-3">
            <Button
              onClick={() => { handleReset(); setAiSolved(false); setAiSuggestion(null); }}
              className="w-full h-11 rounded-md font-semibold"
            >
              Tillbaka till formuläret
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

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6" aria-label={`Steg ${step} av ${STEPS.length}`}>
          {STEPS.map((s, i) => {
            const isDone = s.id < step;
            const isActive = s.id === step;
            return (
              <div key={s.id} className="flex items-center gap-2 flex-1 last:flex-none">
                <div
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-xs font-medium whitespace-nowrap',
                    isActive && 'border-primary text-primary bg-primary/5',
                    isDone && 'border-success text-success bg-success/5',
                    !isActive && !isDone && 'border-border text-muted-foreground'
                  )}
                >
                  {isDone ? <Check className="w-3 h-3" /> : <span className="font-mono">{s.id}</span>}
                  {s.label}
                </div>
                {i < STEPS.length - 1 && <div className={cn('h-px flex-1', isDone ? 'bg-success/50' : 'bg-border')} />}
              </div>
            );
          })}
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

            {step === 1 && (
              <>
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
                      minHeight="200px"
                    />
                  </div>
                )}

                {/* AI Deflection — suggest solution before submitting */}
                {!aiSuggestion && descriptionText.length >= 20 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAiSuggest}
                    disabled={isAiLoading}
                    className="w-full h-11 rounded-md gap-2 border-[hsl(var(--ai))]/40 text-[hsl(var(--ai))] hover:bg-[hsl(var(--ai))]/5"
                  >
                    {isAiLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {isAiLoading ? 'Söker efter lösning...' : 'Få hjälp direkt'}
                  </Button>
                )}

                {/* AI Suggestion result */}
                {aiSuggestion && (
                  <div className="rounded-md border border-[hsl(var(--ai))]/40 bg-[hsl(var(--ai))]/5 p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[hsl(var(--ai))]" />
                      <span className="text-sm font-medium text-[hsl(var(--ai))]">
                        {aiSuggestion.hasSolution ? 'Vi hittade en möjlig lösning' : 'Ingen lösning hittades'}
                      </span>
                    </div>

                    {aiSuggestion.hasSolution && aiSuggestion.solution ? (
                      <>
                        <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed bg-background rounded-md p-4 border border-border">
                          {aiSuggestion.solution}
                        </div>
                        {aiSuggestion.kbReferences.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Baserat på: {aiSuggestion.kbReferences.map(r => r.title).join(', ')}
                          </p>
                        )}
                        <div className="flex gap-3">
                          <Button
                            type="button"
                            onClick={handleAiSolved}
                            className="flex-1 h-10 rounded-md gap-2 bg-success hover:bg-success/90 text-success-foreground"
                          >
                            <ThumbsUp className="h-4 w-4" />
                            Det löste problemet
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleAiRejected}
                            className="flex-1 h-10 rounded-md gap-2"
                          >
                            <ArrowRight className="h-4 w-4" />
                            Behöver fortfarande hjälp
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Vi hittade tyvärr inget i kunskapsbasen som matchar ditt problem. Beskriv det i formuläret så hjälper vi dig personligen.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setAiSuggestion(null)}
                          className="h-10 rounded-md gap-2"
                        >
                          <ArrowRight className="h-4 w-4" />
                          Fortsätt till ärende
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {step1Error && (
                  <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{step1Error}</span>
                  </div>
                )}

                <Button
                  type="button"
                  onClick={handleContinue}
                  className="w-full h-11 rounded-md font-semibold gap-2"
                >
                  Nästa: Dina uppgifter
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}

            {step === 2 && (
              <>
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
                  </div>
                </div>

                {/* Category + Priority */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {categories.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-foreground text-sm font-medium">Kategori</Label>
                      <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                        <SelectTrigger className={selectTriggerClass}>
                          <SelectValue placeholder="Välj kategori" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-foreground text-sm font-medium">Prioritet</Label>
                    <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
                      <SelectTrigger className={selectTriggerClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Låg</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">Hög</SelectItem>
                        <SelectItem value="urgent">Brådskande</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Attachment hint — public form does not support direct upload */}
                <p className="text-xs text-muted-foreground text-center">
                  Behöver du bifoga filer? Svara på bekräftelsemailet du får efter att ärendet skickats — bilagor läggs då till automatiskt.
                </p>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                    className="h-11 rounded-md gap-2"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Tillbaka
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 h-11 rounded-md font-semibold"
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
                </div>
              </>
            )}
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
