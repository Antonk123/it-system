import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { api, KbCategoryRow } from '@/lib/api';
import { toast } from 'sonner';

const ARTICLE_TEMPLATES = [
  {
    id: 'solution',
    label: 'Lösning',
    description: 'Problem, orsak, lösning, förebyggande',
    body: '<h2>Problem</h2><p>Beskriv problemet som artikeln löser.</p><h2>Orsak</h2><p>Varför uppstår problemet?</p><h2>Lösning</h2><p>Steg-för-steg lösning.</p><h2>Förebyggande</h2><p>Hur förhindrar man att problemet återkommer?</p>',
  },
  {
    id: 'how-to',
    label: 'Instruktion',
    description: 'Förutsättningar, steg, verifiering',
    body: '<h2>Förutsättningar</h2><p>Vad behövs innan du börjar?</p><h2>Steg</h2><ol><li>Steg ett</li><li>Steg två</li><li>Steg tre</li></ol><h2>Verifiering</h2><p>Hur vet du att det fungerade?</p>',
  },
  {
    id: 'troubleshooting',
    label: 'Felsökning',
    description: 'Symptom, diagnos, åtgärd',
    body: '<h2>Symptom</h2><p>Vad ser användaren?</p><h2>Diagnos</h2><p>Hur identifierar du grundorsaken?</p><h2>Åtgärd</h2><p>Vilka åtgärder löser problemet?</p>',
  },
] as const;

const KBArticleForm = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = Boolean(id);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState<string>('none');
  const [articleType, setArticleType] = useState<string>('none');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('published');
  const [categories, setCategories] = useState<KbCategoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ title?: string }>({});
  const [templateDismissed, setTemplateDismissed] = useState(false);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const data = await api.getKbCategories();
        setCategories(data);
      } catch {
        // non-critical
      }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    if (!isEditing || !id) return;
    const fetch = async () => {
      try {
        const article = await api.getKbArticle(id);
        setTitle(article.title);
        setContent(article.content);
        setCategoryId(article.category_id ?? 'none');
        setArticleType(article.article_type || 'none');
        setTags(article.tags || []);
        setStatus(article.status || 'published');
      } catch {
        toast.error('Kunde inte ladda artikel');
        navigate('/kb');
      } finally {
        setIsLoading(false);
      }
    };
    fetch();
  }, [id, isEditing, navigate]);

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = tagInput.trim().toLowerCase();
      if (tag && !tags.includes(tag)) {
        setTags(prev => [...prev, tag]);
      }
      setTagInput('');
    }
    if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags(prev => prev.slice(0, -1));
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(prev => prev.filter(t => t !== tagToRemove));
  };

  const validate = () => {
    const newErrors: { title?: string } = {};
    if (!title.trim()) newErrors.title = 'Titel krävs';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        content,
        category_id: categoryId === 'none' ? null : categoryId,
        article_type: articleType === 'none' ? null : articleType,
        tags,
        status,
      };
      if (isEditing && id) {
        await api.updateKbArticle(id, payload);
        toast.success('Artikel uppdaterad');
        navigate(`/kb/${id}`);
      } else {
        const created = await api.createKbArticle(payload);
        toast.success('Artikel skapad');
        navigate(`/kb/${created.id}`);
      }
    } catch {
      toast.error('Kunde inte spara artikel');
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
          <div className="h-64 bg-muted animate-pulse rounded-lg" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to={isEditing && id ? `/kb/${id}` : '/kb'}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {isEditing ? 'Avbryt' : 'Knowledge Base'}
            </Link>
          </Button>
          <h1 className="text-lg font-semibold text-foreground">
            {isEditing ? 'Redigera artikel' : 'Ny artikel'}
          </h1>
        </div>

        {/* Template picker — only for new articles */}
        {!isEditing && !templateDismissed && (
          <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/20">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Välj mall (valfritt)</p>
              <button
                type="button"
                onClick={() => setTemplateDismissed(true)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Hoppa över
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {ARTICLE_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => { setContent(tmpl.body); setTemplateDismissed(true); }}
                  className="text-left p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-accent transition-colors"
                >
                  <p className="font-medium text-sm">{tmpl.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{tmpl.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">
              Titel <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setErrors({}); }}
              placeholder="Artikelns titel..."
              className={errors.title ? 'border-destructive' : ''}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Kategori</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="category">
                <SelectValue placeholder="Välj kategori (valfritt)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ingen kategori</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3">
            <div className="space-y-2 flex-1">
              <Label htmlFor="article-type">Typ</Label>
              <Select value={articleType} onValueChange={setArticleType}>
                <SelectTrigger id="article-type">
                  <SelectValue placeholder="Välj typ (valfritt)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen typ</SelectItem>
                  <SelectItem value="how-to">Instruktion</SelectItem>
                  <SelectItem value="solution">Lösning</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status-toggle">Status</Label>
              <Select value={status} onValueChange={(val) => setStatus(val as 'draft' | 'published')}>
                <SelectTrigger id="status-toggle" className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">Publicerad</SelectItem>
                  <SelectItem value="draft">Utkast</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Taggar</Label>
            <div className="flex flex-wrap gap-1.5 min-h-[2.5rem] rounded-md border border-input bg-background px-3 py-2">
              {tags.map(tag => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="ml-0.5 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder={tags.length === 0 ? "Skriv tagg och tryck Enter..." : ""}
                className="flex-1 min-w-[120px] bg-transparent outline-none text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Innehåll</Label>
            <RichTextEditor
              value={content}
              onChange={setContent}
              placeholder="Skriv artikelns innehåll..."
              minHeight="300px"
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(isEditing && id ? `/kb/${id}` : '/kb')}
              disabled={isSubmitting}
            >
              Avbryt
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEditing ? 'Spara ändringar' : 'Skapa artikel'}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default KBArticleForm;
