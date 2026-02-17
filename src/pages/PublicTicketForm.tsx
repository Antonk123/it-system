import { useState, useEffect } from 'react';
import { CheckCircle, Send, AlertCircle, X, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, CustomFieldInput } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DynamicFieldsForm } from '@/components/DynamicFieldsForm';

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldInput[]>([]);
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

  const handleReset = () => { setFormData({ name: '', email: '', title: '', description: '', category: '', priority: 'medium' }); setSelectedTemplate(null); setCustomFieldValues([]); setIsSuccess(false); setError(null); };

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
              <div className="space-y-2"><Label htmlFor="description">Beskrivning *</Label><Textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Beskriv ditt problem i detalj..." rows={10} required maxLength={5000} /></div>
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
            <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />Skickar...</> : <><Send className="h-4 w-4 mr-2" />Skicka ärende</>}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default PublicTicketForm;
