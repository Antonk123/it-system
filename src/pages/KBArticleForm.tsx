import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, X, Link2, Tag } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { api, LinkedArticleRow } from '@/lib/api';
import { useKbCategories } from '@/hooks/useKbCategories';
import { useQueryClient } from '@tanstack/react-query';
import { useKbArticles, kbArticlesKeys } from '@/hooks/useKbArticles';
import { kbArticleKeys } from '@/hooks/useKbArticle';
import { useTags } from '@/hooks/useTags';
import { TagMultiSelect } from '@/components/TagMultiSelect';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

const VALID_ARTICLE_TYPES = ['how-to', 'solution'] as const;

const KBArticleForm = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const isEditing = Boolean(id);

  const [title, setTitle] = useState(() => searchParams.get('title') ?? '');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState<string>(
    () => searchParams.get('category') ?? 'none'
  );
  const [articleType, setArticleType] = useState<string>(() => {
    const param = searchParams.get('article_type');
    return param && (VALID_ARTICLE_TYPES as readonly string[]).includes(param) ? param : 'none';
  });
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const { tags: availableTags } = useTags();
  const [status, setStatus] = useState<'draft' | 'published'>('published');
  const { categories } = useKbCategories();
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; category?: string; content?: string }>({});
  const [templateDismissed, setTemplateDismissed] = useState(
    () => !!(searchParams.get('title') || searchParams.get('article_type'))
  );

  // Cross-ref state (only used in edit mode)
  const [crossRefs, setCrossRefs] = useState<LinkedArticleRow[]>([]);
  const { articles: allArticles } = useKbArticles({}, isEditing);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');

  const sourceTicketId = searchParams.get('ticket_id');

  useEffect(() => {
    if (!isEditing || !id) return;
    const fetch = async () => {
      try {
        const article = await api.getKbArticle(id);
        setTitle(article.title);
        setContent(article.content);
        setCategoryId(article.category_id ?? 'none');
        setArticleType(article.article_type || 'none');
        setSelectedTagIds((article.tags || []).map(t => t.id));
        setStatus(article.status || 'published');
        // Fetch cross-refs for the link picker
        api.getKbArticleLinks(id).then(setCrossRefs).catch(() => {});
      } catch {
        toast.error('Kunde inte ladda artikel');
        navigate('/kb');
      } finally {
        setIsLoading(false);
      }
    };
    fetch();
  }, [id, isEditing, navigate]);

  const availableLinkTargets = useMemo(
    () =>
      allArticles.filter(
        a => a.id !== id && a.status === 'published' && !crossRefs.some(r => r.id === a.id)
      ),
    [allArticles, id, crossRefs]
  );

  const filteredLinkTargets = useMemo(
    () =>
      availableLinkTargets.filter(a =>
        a.title.toLowerCase().includes(linkSearch.toLowerCase())
      ),
    [availableLinkTargets, linkSearch]
  );

  const handleAddLink = async (targetId: string) => {
    if (!id) return;
    try {
      await api.addKbArticleLink(id, targetId);
      const updated = await api.getKbArticleLinks(id);
      setCrossRefs(updated);
      setLinkPickerOpen(false);
      setLinkSearch('');
      toast.success('Se även-koppling tillagd');
    } catch {
      toast.error('Kunde inte lägga till koppling');
    }
  };

  const handleRemoveLink = async (targetId: string) => {
    if (!id) return;
    try {
      await api.removeKbArticleLink(id, targetId);
      setCrossRefs(prev => prev.filter(r => r.id !== targetId));
      toast.success('Se även-koppling borttagen');
    } catch {
      toast.error('Kunde inte ta bort koppling');
    }
  };

  // Strip HTML tags and check for visible text. TipTap renders an empty doc as
  // "<p></p>" which would otherwise pass a naive .trim() check and let users
  // save articles with no body.
  const hasVisibleContent = (html: string) =>
    html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;

  const validate = () => {
    const newErrors: { title?: string; category?: string; content?: string } = {};
    if (!title.trim()) newErrors.title = 'Titel krävs';
    if (!categoryId || categoryId === 'none') newErrors.category = 'Kategori krävs';
    if (!hasVisibleContent(content)) newErrors.content = 'Innehåll krävs';
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
        tag_ids: selectedTagIds,
        status,
      };
      if (isEditing && id) {
        await api.updateKbArticle(id, payload);
        queryClient.invalidateQueries({ queryKey: kbArticlesKeys.all });
        queryClient.invalidateQueries({ queryKey: kbArticleKeys.detail(id) });
        toast.success('Artikel uppdaterad');
        navigate(`/kb/${id}`);
      } else {
        const created = await api.createKbArticle(payload);
        if (sourceTicketId) {
          try {
            await api.linkKbArticleToTicket(sourceTicketId, created.id);
          } catch {
            // Non-fatal: article was created, link just failed
            console.warn('Could not auto-link article to source ticket');
          }
        }
        queryClient.invalidateQueries({ queryKey: kbArticlesKeys.all });
        if (sourceTicketId) {
          queryClient.invalidateQueries({ queryKey: ['ticket-kb-links', sourceTicketId] });
        }
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
              {isEditing ? 'Avbryt' : 'Kunskapsbas'}
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
              onChange={(e) => {
                setTitle(e.target.value);
                // Clear only the title error so other unaddressed errors
                // (category, content) remain visible until the user fixes them.
                setErrors(prev => { const p = { ...prev }; delete p.title; return p; });
              }}
              placeholder="Artikelns titel..."
              // Autofocus only on create — editing shouldn't yank focus on
              // mount (user may scroll to a specific section to edit).
              autoFocus={!isEditing}
              className={errors.title ? 'border-destructive' : ''}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Kategori</Label>
            <Select
              value={categoryId}
              onValueChange={(v) => {
                setCategoryId(v);
                setErrors(prev => { const p = { ...prev }; delete p.category; return p; });
              }}
            >
              <SelectTrigger id="category" className={errors.category ? 'border-destructive' : ''}>
                <SelectValue placeholder="Välj kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Välj kategori...</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.category && <p className="text-xs text-destructive">{errors.category}</p>}
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
            <Label id="kb-tags-label" className="flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              Taggar
            </Label>
            <div
              className="flex flex-wrap items-center gap-1.5 min-h-10 rounded-md border border-input bg-background px-3 py-2"
              role="group"
              aria-labelledby="kb-tags-label"
            >
              {selectedTagIds.map(tagId => {
                const tag = availableTags.find(t => t.id === tagId);
                if (!tag) return null;
                return (
                  <Badge key={tagId} variant="secondary" className="gap-1" style={{ backgroundColor: tag.color + '22', color: tag.color, borderColor: tag.color + '44' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                    <button type="button" onClick={() => setSelectedTagIds(prev => prev.filter(id => id !== tagId))} className="ml-0.5 hover:opacity-70">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
              <TagMultiSelect selectedTagIds={selectedTagIds} onChange={setSelectedTagIds} />
            </div>
          </div>

          {/* Cross-ref link picker — only shown in edit mode */}
          {isEditing && (
            <div className="space-y-2">
              <Label id="kb-crossrefs-label" className="flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                Se även-kopplingar
              </Label>
              {crossRefs.length > 0 && (
                <div className="space-y-1 mb-2" role="list" aria-labelledby="kb-crossrefs-label">
                  {crossRefs.map((ref) => (
                    <div key={ref.id} role="listitem" className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                      <span className="text-sm truncate">{ref.title}</span>
                      <Button variant="ghost" size="sm" type="button" onClick={() => handleRemoveLink(ref.id)} aria-label={`Ta bort koppling till ${ref.title}`}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Popover open={linkPickerOpen} onOpenChange={setLinkPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" type="button" aria-labelledby="kb-crossrefs-label">
                    Lägg till koppling
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Sök artikel..."
                      value={linkSearch}
                      onValueChange={setLinkSearch}
                    />
                    <CommandList>
                      <CommandEmpty>Inga artiklar hittades</CommandEmpty>
                      <CommandGroup>
                        {filteredLinkTargets.slice(0, 10).map((article) => (
                          <CommandItem
                            key={article.id}
                            onSelect={() => handleAddLink(article.id)}
                          >
                            <span className="truncate">{article.title}</span>
                            {article.article_type && (
                              <Badge variant="secondary" className="ml-auto shrink-0 text-xs">
                                {article.article_type === 'how-to' ? 'Instruktion' : article.article_type === 'solution' ? 'Lösning' : 'Felsökning'}
                              </Badge>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          <div className="space-y-2">
            <Label id="kb-content-label">
              Innehåll <span className="text-destructive">*</span>
            </Label>
            <div role="group" aria-labelledby="kb-content-label" className={errors.content ? 'rounded-md ring-2 ring-destructive ring-offset-1' : ''}>
              <RichTextEditor
                value={content}
                onChange={(html) => {
                  setContent(html);
                  setErrors(prev => { const p = { ...prev }; delete p.content; return p; });
                }}
                placeholder="Skriv artikelns innehåll..."
                minHeight="300px"
                error={!!errors.content}
              />
            </div>
            {errors.content && <p className="text-xs text-destructive">{errors.content}</p>}
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
