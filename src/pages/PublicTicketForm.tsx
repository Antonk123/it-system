import { useState, useEffect, useRef } from 'react';
import { CheckCircle, Send, AlertCircle, X, FileText, Upload, Paperclip } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, CustomFieldInput } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  const navigate = useNavigate();
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
    e.preventDefault(); setError(null); setIsSubmitting(true);
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
    } catch (err) { setError(err instanceof Error ? err.message : 'Ett oväntat fel uppstod'); }
    finally { setIsSubmitting(false); }
  };

  const handleFilesSelect = (files: File[]) => {
    setPendingFiles(prev => [...prev, ...files]);
  };

  const handleRemovePending = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      handleFilesSelect(files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFilesSelect(files);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleReset = () => { setFormData({ name: '', email: '', title: '', description: '', category: '', priority: 'medium' }); setSelectedTemplate(null); setCustomFieldValues([]); setPendingFiles([]); setIsSuccess(false); setError(null); };

  if (isSuccess) return <div className="min-h-screen bg-background flex items-center justify-center p-4"><Card className="w-full max-w-md"><CardContent className="pt-6 text-center"><CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" /><h2 className="text-2xl font-semibold mb-2">Ärendet skickat!</h2><p className="text-muted-foreground mb-6">Tack för att du kontaktar oss.</p><Button onClick={handleReset} variant="outline">Skicka ett nytt ärende</Button></CardContent></Card></div>;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg relative">
        <Button variant="ghost" size="icon" className="absolute right-2 top-2" onClick={() => navigate('/')}><X className="h-4 w-4" /></Button>
        <CardHeader><CardTitle>Skicka en supportförfrågan</CardTitle><CardDescription>Fyll i formuläret nedan så återkommer vi så snart som möjligt.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="name">Ditt namn *</Label><Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Johan Andersson" required maxLength={100} /></div><div className="space-y-2"><Label htmlFor="email">Din e-post *</Label><Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="namn@example.com" required maxLength={255} /></div></div>

            {templates.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="template">
                  <FileText className="h-4 w-4 inline mr-2" />
                  Använd mall (valfritt)
                </Label>
                <Select value={selectedTemplate?.id || ''} onValueChange={handleTemplateSelect}>
                  <SelectTrigger id="template">
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

            {selectedTemplate && selectedTemplate.fields && selectedTemplate.fields.length > 0 && (
              <DynamicFieldsForm
                fields={selectedTemplate.fields}
                onValuesChange={setCustomFieldValues}
              />
            )}

            <div className="space-y-2"><Label htmlFor="title">Ärendets titel *</Label><Input id="title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder="Kort sammanfattning" required maxLength={200} /></div>

            {(!selectedTemplate || !selectedTemplate.fields || selectedTemplate.fields.length === 0) && (
              <div className="space-y-2"><Label htmlFor="description">Beskrivning *</Label><RichTextEditor value={formData.description} onChange={(html) => setFormData({ ...formData, description: html })} placeholder="Beskriv ditt problem i detalj..." minHeight="250px" required /></div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {categories.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="category">Kategori</Label>
                  <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                    <SelectTrigger><SelectValue placeholder="Välj kategori" /></SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
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
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="priority">Prioritet</Label>
                <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low" className="data-[highlighted]:bg-primary/20 data-[highlighted]:text-foreground data-[state=checked]:bg-primary/10">Låg</SelectItem>
                    <SelectItem value="medium" className="data-[highlighted]:bg-primary/20 data-[highlighted]:text-foreground data-[state=checked]:bg-primary/10">Medium</SelectItem>
                    <SelectItem value="high" className="data-[highlighted]:bg-primary/20 data-[highlighted]:text-foreground data-[state=checked]:bg-primary/10">Hög</SelectItem>
                    <SelectItem value="urgent" className="data-[highlighted]:bg-primary/20 data-[highlighted]:text-foreground data-[state=checked]:bg-primary/10">Brådskande</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* File Attachments */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
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
                  "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
                  isDragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50",
                  "cursor-pointer"
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-foreground mb-1">
                  Klicka för att ladda upp filer, eller dra och släpp
                </p>
                <p className="text-xs text-muted-foreground">
                  Bilder, PDF, Office-dokument (max 10 MB per fil)
                </p>
              </div>

              {/* Pending Files List */}
              {pendingFiles.length > 0 && (
                <div className="space-y-1 mt-2">
                  {pendingFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 bg-muted/50 rounded border border-border"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePending(index);
                        }}
                        className="h-6 w-6 p-0"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {pendingFiles.length > 0 && (
                <p className="text-xs text-muted-foreground italic">
                  OBS: Filuppladdning för offentliga ärenden är för närvarande under utveckling. Bifogade filer kommer inte att laddas upp ännu.
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />Skickar...</> : <><Send className="h-4 w-4 mr-2" />Skicka ärende</>}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default PublicTicketForm;
