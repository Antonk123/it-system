import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BookOpen, Plus, Search, Folder, Clock, Settings2, X, Check, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, KbArticleRow, KbCategoryRow } from '@/lib/api';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const TYPE_LABELS: Record<string, string> = {
  'how-to': 'Instruktion',
  'solution': 'Lösning',
};

const KnowledgeBase = () => {
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [articles, setArticles] = useState<KbArticleRow[]>([]);
  const [categories, setCategories] = useState<KbCategoryRow[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [staleFilter, setStaleFilter] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Category management state
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  const isStale = (article: KbArticleRow): boolean => {
    const ref = article.last_reviewed_at || article.created_at;
    return (Date.now() - new Date(ref).getTime()) / (86400 * 1000) > 90;
  };

  const fetchCategories = useCallback(async () => {
    try {
      const data = await api.getKbCategories();
      setCategories(data);
    } catch {
      // non-critical
    }
  }, []);

  const fetchArticles = useCallback(async () => {
    try {
      const params: { search?: string; category_id?: string; article_type?: string; tag?: string; stale?: boolean } = {};
      if (search) params.search = search;
      if (categoryFilter !== 'all') params.category_id = categoryFilter;
      if (typeFilter !== 'all') params.article_type = typeFilter;
      if (tagFilter !== 'all') params.tag = tagFilter;
      if (staleFilter) params.stale = true;
      const data = await api.getKbArticles(params);
      setArticles(data);
    } catch {
      toast.error('Kunde inte hämta artiklar');
    }
  }, [search, categoryFilter, typeFilter, tagFilter, staleFilter]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(async () => {
      await fetchArticles();
      setIsLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchArticles]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const availableTags = useMemo(() => {
    const tagMap = new Map<string, { id: string; name: string; color: string }>();
    articles.forEach(a => a.tags?.forEach(t => tagMap.set(t.id, t)));
    return Array.from(tagMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [articles]);

  const hasActiveFilters = search || categoryFilter !== 'all' || typeFilter !== 'all' || tagFilter !== 'all' || staleFilter;

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    setIsCreatingCategory(true);
    try {
      await api.createKbCategory(newCategoryName.trim());
      await fetchCategories();
      setNewCategoryName('');
      toast.success('Kategori skapad');
    } catch {
      toast.error('Kunde inte skapa kategori');
    } finally {
      setIsCreatingCategory(false);
    }
  };

  const handleUpdateCategory = async (id: string) => {
    if (!editingCategoryName.trim()) return;
    try {
      await api.updateKbCategory(id, editingCategoryName.trim());
      await fetchCategories();
      setEditingCategoryId(null);
      toast.success('Kategori uppdaterad');
    } catch {
      toast.error('Kunde inte uppdatera kategori');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      await api.deleteKbCategory(id);
      await fetchCategories();
      if (categoryFilter === id) setCategoryFilter('all');
      toast.success('Kategori raderad');
    } catch {
      toast.error('Kunde inte radera kategori');
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });

  const getPreview = (html: string, maxLen = 120) => {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Knowledge Base</h1>
              <p className="text-sm text-muted-foreground">{articles.length} artiklar</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCategoryManager((v) => !v)}
              className={cn(showCategoryManager && 'bg-accent')}
            >
              <Settings2 className="w-4 h-4 mr-2" />
              Kategorier
            </Button>
            <Button onClick={() => navigate('/kb/new')} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Ny artikel
            </Button>
          </div>
        </div>

        {/* Category manager */}
        {showCategoryManager && (
          <div className="border border-border rounded-lg p-4 bg-card space-y-3">
            <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Folder className="w-4 h-4 text-muted-foreground" />
              Hantera kategorier
            </h2>

            {/* Existing categories */}
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground">Inga kategorier ännu.</p>
            ) : (
              <div className="space-y-1.5">
                {categories.map((cat) => (
                  <div key={cat.id} className="flex items-center gap-2 group">
                    {editingCategoryId === cat.id ? (
                      <>
                        <Input
                          value={editingCategoryName}
                          onChange={(e) => setEditingCategoryName(e.target.value)}
                          className="h-8 text-sm flex-1"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdateCategory(cat.id);
                            if (e.key === 'Escape') setEditingCategoryId(null);
                          }}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => handleUpdateCategory(cat.id)}
                        >
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => setEditingCategoryId(null)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-foreground">{cat.name}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => {
                            setEditingCategoryId(cat.id);
                            setEditingCategoryName(cat.name);
                          }}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Ta bort kategori</AlertDialogTitle>
                              <AlertDialogDescription>
                                Är du säker på att du vill ta bort kategorin "{cat.name}"? Denna åtgärd kan inte ångras.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Avbryt</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteCategory(cat.id)}>Ta bort</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Create new category */}
            <div className="flex gap-2 pt-1">
              <Input
                placeholder="Ny kategori..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="h-8 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
              />
              <Button
                size="sm"
                className="h-8"
                onClick={handleCreateCategory}
                disabled={isCreatingCategory || !newCategoryName.trim()}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Lägg till
              </Button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-col sm:flex-row flex-wrap">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Sök artiklar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded border font-mono">/</kbd>
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Alla kategorier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla kategorier</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Alla typer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla typer</SelectItem>
              <SelectItem value="how-to">Instruktion</SelectItem>
              <SelectItem value="solution">Lösning</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="Alla taggar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla taggar</SelectItem>
              {availableTags.map(tag => (
                <SelectItem key={tag.id} value={tag.id}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 shrink-0">
            <Switch id="stale-filter" checked={staleFilter} onCheckedChange={setStaleFilter} />
            <Label htmlFor="stale-filter" className="text-sm cursor-pointer whitespace-nowrap">Visa inaktuella</Label>
          </div>
        </div>

        {/* Articles list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {search || categoryFilter !== 'all' || typeFilter !== 'all' || tagFilter !== 'all'
                ? 'Inga artiklar matchar sökningen'
                : 'Inga artiklar ännu — skapa din första!'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2">
              {articles.map((article) => (
                <button
                  key={article.id}
                  onClick={() => navigate(`/kb/${article.id}`)}
                  className={cn(
                    'w-full text-left p-4 rounded-lg border border-border bg-card',
                    'hover:bg-accent/50 hover:border-primary/30 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{article.title}</p>
                      {article.snippet ? (
                        <p
                          className="text-sm text-muted-foreground mt-1 line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: article.snippet }}
                        />
                      ) : article.content ? (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {getPreview(article.content)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {article.category_name && (
                        <Badge
                          variant="secondary"
                          className="text-xs"
                          style={article.category_color ? { backgroundColor: article.category_color + '22', color: article.category_color } : undefined}
                        >
                          <Folder className="w-2.5 h-2.5 mr-1" />
                          {article.category_name}
                        </Badge>
                      )}
                      {article.article_type && (
                        <Badge variant="outline" className="text-xs">
                          {TYPE_LABELS[article.article_type]}
                        </Badge>
                      )}
                      {isStale(article) && (
                        <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600 gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Inaktuell
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(article.updated_at)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

export default KnowledgeBase;
