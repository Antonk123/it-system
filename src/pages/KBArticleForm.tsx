import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { api, KbCategoryRow } from '@/lib/api';
import { toast } from 'sonner';

const KBArticleForm = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = Boolean(id);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState<string>('none');
  const [categories, setCategories] = useState<KbCategoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ title?: string }>({});

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
      } catch {
        toast.error('Kunde inte ladda artikel');
        navigate('/kb');
      } finally {
        setIsLoading(false);
      }
    };
    fetch();
  }, [id, isEditing, navigate]);

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
