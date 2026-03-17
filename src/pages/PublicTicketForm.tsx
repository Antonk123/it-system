import { useState, useEffect, useRef } from 'react';
import { CheckCircle, Send, AlertCircle, X, FileText, Upload, Paperclip, Loader2, Ticket, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, CustomFieldInput } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DynamicFieldsForm } from '@/components/DynamicFieldsForm';
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
}

const PublicTicketForm = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldInput[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', title: '', description: '', category: '', priority: 'medium' });

  useEffect(() => {
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
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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

  const handleFilesSelect = (files: File[]) => setPendingFiles(prev => [...prev, ...files]);
  const handleRemovePending = (index: number) => setPendingFiles(prev => prev.filter((_, i) => i !== index));
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) handleFilesSelect(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFilesSelect(files);
  };
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const handleReset = () => {
    setFormData({ name: '', email: '', title: '', description: '', category: '', priority: 'medium' });
    setSelectedTemplate(null);
    setCustomFieldValues([]);
    setPendingFiles([]);
    setIsSuccess(false);
    setError(null);
  };

  const inputClass = "h-11 rounded-xl bg-input border-border text-foreground placeholder:text-muted-foreground hover:bg-input/80 hover:border-primary/40 focus-visible:ring-primary/30 focus-visible:border-primary/60 transition-all duration-200";
  const selectTriggerClass = "h-11 rounded-xl bg-input border-border text-foreground hover:bg-input/80 hover:border-primary/40 focus:ring-primary/30 focus:border-primary/60 transition-all duration-200";

  // ── Success state ─────────────────────────────────────────────
  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_40%_at_50%_0%,hsl(var(--primary)/0.07)_0%,transparent_100%)] pointer-events-none" />
        <div className="w-full max-w-md relative z-10 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 mb-6">
            <CheckCircle className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">Ärendet skickat!</h2>
          <p className="text-muted-foreground mb-8">Tack för att du kontaktar oss. Vi återkommer så snart som möjligt.</p>
          <div className="bg-card border border-border rounded-2xl p-6 shadow-2xl backdrop-blur-sm flex flex-col gap-3">
            <Button
              onClick={handleReset}
              className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors cursor-pointer"
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
    <div className="min-h-screen bg-background flex items-start justify-center p-4 py-10 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_40%_at_50%_0%,hsl(var(--primary)/0.07)_0%,transparent_100%)] pointer-events-none" />

      <div className="w-full max-w-lg relative z-10">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-5">
            <Ticket className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Skicka en supportförfrågan</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Fyll i formuläret så återkommer vi så snart som möjligt.</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
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
            {selectedTemplate && selectedTemplate.fields && selectedTemplate.fields.length > 0 && (
              <DynamicFieldsForm
                fields={selectedTemplate.fields}
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
            {(!selectedTemplate || !selectedTemplate.fields || selectedTemplate.fields.length === 0) && (
              <div className="space-y-1.5">
                <Label htmlFor="description" className="text-foreground text-sm font-medium">Beskrivning *</Label>
                <RichTextEditor
                  value={formData.description}
                  onChange={(html) => setFormData({ ...formData, description: html })}
                  placeholder="Beskriv ditt problem i detalj..."
                  minHeight="200px"
                  required
                />
              </div>
            )}

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

            {/* File upload */}
            <div className="space-y-2">
              <Label className="text-foreground text-sm font-medium flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                Bifoga filer (valfritt)
              </Label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
              />
              <div
                className={cn(
                  "border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer",
                  isDragging
                    ? "border-primary/60 bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-input/40"
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <Upload className="h-7 w-7 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-foreground/80 mb-1">Klicka för att ladda upp, eller dra och släpp</p>
                <p className="text-xs text-muted-foreground">Bilder, PDF, Office-dokument (max 10 MB per fil)</p>
              </div>

              {pendingFiles.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {pendingFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-input border border-border"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleRemovePending(index); }}
                        className="ml-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        aria-label={`Ta bort ${file.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Submit */}
            <Button
              type="submit"
              className="w-full h-11 rounded-xl bg-gradient-to-br from-primary via-primary to-primary/90 hover:from-primary/90 hover:via-primary hover:to-primary active:scale-[0.98] text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 font-semibold transition-all duration-200 cursor-pointer"
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
